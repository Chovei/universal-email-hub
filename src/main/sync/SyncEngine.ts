import type { BrowserWindow } from 'electron'
import type { ProviderKind } from '@shared/constants/providers'
import type { SyncStatus, ThreadRow, ParticipantAddress } from '@shared/types/db'
import type { BasicCredentials, RawMessage, ProviderFolder, RemoteMessageRef } from '@shared/types/provider'
import type { ThreadSelect, FolderSelect, MessageInsert, ThreadInsert } from '../db/schema'
import { GmailProvider } from './providers/GmailProvider'
import { GraphProvider } from './providers/GraphProvider'
import { ImapProvider } from './providers/ImapProvider'
import type { BaseProvider } from './providers/BaseProvider'
import { normalizeMessage } from './normalizer'
import { describeSyncError } from './syncErrors'
import { computeBackoffMs } from './backoff'
import { IdleWatcher } from './IdleWatcher'
import { Semaphore } from './semaphore'

// Cap concurrent account syncs: with many accounts, an unbounded sync storm
// saturates network, DB, and provider rate limits simultaneously
const syncSemaphore = new Semaphore(4)
import { indexMessageBatch } from '../db/queries/search'
import { NotificationService } from '../notifications/NotificationService'
import {
  getThreadByRemoteId,
  upsertThread,
  updateThreadCounts,
  deleteThread,
  getTotalUnreadCount,
} from '../db/queries/threads'
import {
  getMessageByRemoteId,
  upsertMessage,
  deleteMessages as dbDeleteMessages,
  getMessagesByThread,
  upsertAttachment,
  getMessageRemoteIdsByFolder,
  countMessagesByFolder,
  getMinUidByFolder,
} from '../db/queries/messages'
import { parseCursor, computeGhostRemoteIds } from './providers/imapHelpers'
import { getFolderByRemoteId, upsertFolder, updateFolderSyncCursor } from '../db/queries/folders'
import { getAccountById, updateAccount } from '../db/queries/accounts'
import { IPC } from '@shared/constants/ipc-channels'
import { monotonicFactory } from 'ulid'
import { isVerificationEmail, extractVerification, detectServiceName } from './VerificationExtractor'
import { insertVerificationCode, hasRecentDuplicate } from '../db/queries/verificationCodes'

const ulid = monotonicFactory()

// ── DB serialization helpers ───────────────────────────────────────────────
// ThreadRow / MessageRow use parsed arrays; DB columns store JSON strings.

function toThreadInsert(
  t: Omit<ThreadRow, 'messageCount' | 'unreadCount'>,
  messageCount: number,
  unreadCount: number
): ThreadInsert {
  return {
    id: t.id,
    accountId: t.accountId,
    remoteId: t.remoteId ?? null,
    subject: t.subject,
    snippet: t.snippet,
    lastMessageAt: t.lastMessageAt,
    unreadCount,
    messageCount,
    isStarred: t.isStarred,
    hasAttachment: t.hasAttachment,
    labels: JSON.stringify(t.labels),
    participantAddresses: JSON.stringify(t.participantAddresses),
  }
}

function toMessageInsert(
  m: ReturnType<typeof normalizeMessage>['message'],
  threadId: string
): MessageInsert {
  return {
    id: m.id,
    threadId,
    accountId: m.accountId,
    folderId: m.folderId,
    remoteId: m.remoteId,
    fromAddress: m.fromAddress,
    fromName: m.fromName ?? null,
    toAddresses: JSON.stringify(m.toAddresses),
    ccAddresses: JSON.stringify(m.ccAddresses),
    bccAddresses: JSON.stringify(m.bccAddresses),
    replyToAddresses: JSON.stringify(m.replyToAddresses),
    subject: m.subject,
    bodyHtml: m.bodyHtml ?? null,
    bodyText: m.bodyText ?? null,
    date: m.date,
    isRead: m.isRead,
    isStarred: m.isStarred,
    isDraft: m.isDraft,
    hasAttachment: m.hasAttachment,
    labels: JSON.stringify(m.labels),
    headers: JSON.stringify(m.headers),
    sizeBytes: m.sizeBytes ?? null,
    fetchedAt: m.fetchedAt,
  }
}

function toThreadRow(t: ThreadSelect): ThreadRow {
  return {
    id: t.id,
    accountId: t.accountId,
    remoteId: t.remoteId ?? null,
    subject: t.subject,
    snippet: t.snippet,
    lastMessageAt: t.lastMessageAt,
    unreadCount: t.unreadCount,
    messageCount: t.messageCount,
    isStarred: Boolean(t.isStarred),
    hasAttachment: Boolean(t.hasAttachment),
    labels: JSON.parse(t.labels as string) as string[],
    participantAddresses: JSON.parse(t.participantAddresses as string) as ParticipantAddress[],
  }
}

// ── Worker state ───────────────────────────────────────────────────────────

interface AccountWorker {
  provider: BaseProvider
  status: SyncStatus
  intervalMs: number
  timer: ReturnType<typeof setTimeout> | null
  syncing: boolean
  consecutiveFailures: number
  idleWatcher: IdleWatcher | null
}

// ── SyncEngine singleton ───────────────────────────────────────────────────

export class SyncEngine {
  private static instance: SyncEngine
  private workers = new Map<string, AccountWorker>()
  private win: BrowserWindow | null = null

  static getInstance(): SyncEngine {
    if (!SyncEngine.instance) SyncEngine.instance = new SyncEngine()
    return SyncEngine.instance
  }

  setWindow(win: BrowserWindow): void {
    this.win = win
  }

  async addAccount(
    accountId: string,
    providerKind: string,
    _credentials?: BasicCredentials
  ): Promise<void> {
    if (this.workers.has(accountId)) return

    let provider: BaseProvider

    switch (providerKind as ProviderKind) {
      case 'gmail':
        // Use IMAP when credentials are provided (App Password flow).
        // Fall back to OAuth GmailProvider for accounts created before v0.1.1.
        if (_credentials) {
          provider = new ImapProvider(accountId, 'gmail', _credentials)
        } else {
          try {
            provider = ImapProvider.fromStore(accountId, 'gmail')
          } catch {
            provider = new GmailProvider(accountId)
          }
        }
        break
      case 'graph':
        provider = new GraphProvider(accountId)
        break
      case 'imap':
      case 'outlook':
      case 'yahoo':
      case 'icloud':
      case 'zoho':
      case 'fastmail':
      case 'aol':
      case 'gmx':
      case 'rambler': {
        try {
          provider = _credentials
            ? new ImapProvider(accountId, providerKind as ProviderKind, _credentials)
            : ImapProvider.fromStore(accountId, providerKind as ProviderKind)
        } catch {
          console.warn(`[SyncEngine] No IMAP credentials for account ${accountId}`)
          return
        }
        break
      }
      default:
        console.warn(`[SyncEngine] Unsupported provider kind: ${providerKind}`)
        return
    }

    const account = getAccountById(accountId)
    const intervalMs = (account?.syncIntervalSeconds ?? 60) * 1000

    const worker: AccountWorker = {
      provider,
      status: { state: 'idle' },
      intervalMs,
      timer: null,
      syncing: false,
      consecutiveFailures: 0,
      idleWatcher: null,
    }
    this.workers.set(accountId, worker)

    // Real-time push for IMAP accounts: a dedicated IDLE connection triggers
    // the normal sync pipeline the moment the server reports new mail.
    // Polling stays on as the reconciliation safety net.
    if (provider instanceof ImapProvider) {
      const watcher = new IdleWatcher(
        accountId,
        () => provider.makeDedicatedClient(),
        () => void this.runSync(accountId),
        (connected) => {
          const w = this.workers.get(accountId)
          if (!w) return
          w.status = { ...w.status, realtime: connected }
          this.broadcastStatus(accountId, w.status)
        }
      )
      worker.idleWatcher = watcher
      watcher.start()
    }

    // Initial sync fires immediately; polling timer is set after it completes
    void this.runSync(accountId)
  }

  removeAccount(accountId: string): void {
    const worker = this.workers.get(accountId)
    if (worker?.timer) clearTimeout(worker.timer)
    worker?.idleWatcher?.stop()
    this.workers.delete(accountId)
  }

  async reconnect(accountId: string): Promise<void> {
    const worker = this.workers.get(accountId)
    if (!worker) return
    if (worker.timer) { clearTimeout(worker.timer); worker.timer = null }
    worker.status = { state: 'idle' }
    // Restart the IDLE watcher so it drops any backoff loop from the old
    // connection state and reconnects immediately
    if (worker.idleWatcher) {
      worker.idleWatcher.stop()
      worker.idleWatcher.start()
    }
    void this.runSync(accountId)
  }

  pauseAccount(accountId: string): void {
    const worker = this.workers.get(accountId)
    if (!worker) return
    if (worker.timer) { clearTimeout(worker.timer); worker.timer = null }
    worker.idleWatcher?.stop()
    worker.status = { state: 'paused' }
    this.broadcastStatus(accountId, worker.status)
  }

  resumeAccount(accountId: string): void {
    const worker = this.workers.get(accountId)
    if (!worker || worker.status.state !== 'paused') return
    worker.status = { state: 'idle' }
    this.broadcastStatus(accountId, worker.status)
    worker.idleWatcher?.start()
    void this.runSync(accountId)
  }

  async forceSync(accountId?: string): Promise<void> {
    const ids = accountId ? [accountId] : [...this.workers.keys()]
    await Promise.all(ids.map((id) => this.runSync(id)))
  }

  getAllStatus(): Record<string, SyncStatus> {
    const result: Record<string, SyncStatus> = {}
    for (const [id, worker] of this.workers) result[id] = worker.status
    return result
  }

  // ── Provider-delegating operations ─────────────────────────────────────

  async sendMessage(accountId: string, draft: unknown): Promise<string> {
    const w = this.requireWorker(accountId)
    const res = await w.provider.sendMessage(
      draft as Parameters<typeof w.provider.sendMessage>[0]
    )
    return res.remoteId
  }

  async saveDraft(accountId: string, draft: unknown): Promise<string> {
    const w = this.requireWorker(accountId)
    const res = await w.provider.createDraft(
      draft as Parameters<typeof w.provider.createDraft>[0]
    )
    return res.remoteId
  }

  async deleteDraft(accountId: string, remoteId: string): Promise<void> {
    await this.requireWorker(accountId).provider.deleteDraft(remoteId)
  }

  async downloadAttachment(
    accountId: string,
    remoteRef: string,
    folderRemoteId?: string | null
  ): Promise<Buffer> {
    return this.requireWorker(accountId).provider.fetchAttachment(remoteRef, folderRemoteId)
  }

  async markMessagesRead(accountId: string, refs: RemoteMessageRef[], read: boolean): Promise<void> {
    const w = this.workers.get(accountId)
    if (!w || refs.length === 0) return
    await w.provider.markRead(refs, read).catch((err: unknown) => {
      console.warn(`[SyncEngine] markRead propagation failed for ${accountId}:`, err)
    })
  }

  async starMessages(accountId: string, refs: RemoteMessageRef[], starred: boolean): Promise<void> {
    const w = this.workers.get(accountId)
    if (!w || refs.length === 0) return
    await w.provider.star(refs, starred).catch((err: unknown) => {
      console.warn(`[SyncEngine] star propagation failed for ${accountId}:`, err)
    })
  }

  async moveMessages(accountId: string, refs: RemoteMessageRef[], targetFolderRemoteId: string): Promise<void> {
    const w = this.workers.get(accountId)
    if (!w || refs.length === 0) return
    await w.provider.moveMessages(refs, targetFolderRemoteId).catch((err: unknown) => {
      console.warn(`[SyncEngine] move propagation failed for ${accountId}:`, err)
    })
  }

  async deleteRemoteMessages(accountId: string, refs: RemoteMessageRef[]): Promise<void> {
    const w = this.workers.get(accountId)
    if (!w || refs.length === 0) return
    await w.provider.deleteMessages(refs).catch((err: unknown) => {
      console.warn(`[SyncEngine] delete propagation failed for ${accountId}:`, err)
    })
  }

  shutdown(): void {
    for (const [, worker] of this.workers) {
      if (worker.timer) clearTimeout(worker.timer)
      worker.idleWatcher?.stop()
    }
    this.workers.clear()
  }

  // ── Core sync loop ─────────────────────────────────────────────────────

  private requireWorker(accountId: string): AccountWorker {
    const w = this.workers.get(accountId)
    if (!w) throw new Error(`No worker for account ${accountId}`)
    return w
  }

  private scheduleNextSync(accountId: string): void {
    const worker = this.workers.get(accountId)
    if (!worker || worker.status.state === 'paused') return
    if (worker.timer) clearTimeout(worker.timer)
    // Healthy accounts poll at their configured interval; failing accounts
    // back off exponentially (with jitter) so a broken server or revoked
    // credential doesn't get hammered every cycle.
    const delay = computeBackoffMs(worker.intervalMs, worker.consecutiveFailures)
    worker.timer = setTimeout(() => void this.runSync(accountId), delay)
  }

  private async runSync(accountId: string): Promise<void> {
    const worker = this.workers.get(accountId)
    if (!worker || worker.syncing || worker.status.state === 'paused') return

    // Mark syncing BEFORE queueing on the semaphore so duplicate triggers
    // (IDLE events, forceSync) are dropped instead of piling up in the queue
    worker.syncing = true
    const release = await syncSemaphore.acquire()

    // Re-check after the wait — the account may have been paused or removed
    // while this sync sat in the queue
    const current = this.workers.get(accountId)
    if (!current || current.status.state === 'paused') {
      release()
      worker.syncing = false
      return
    }

    worker.status = { state: 'syncing', progress: 0, realtime: worker.status.realtime }
    this.broadcastStatus(accountId, worker.status)
    const syncStart = Date.now()

    try {
      const providerFolders = await worker.provider.listFolders()
      const dbFolders = this.persistFolders(accountId, providerFolders)

      const priorityOrder = ['inbox', 'sent', 'drafts', 'trash', 'spam', 'custom']
      const sorted = [...dbFolders].sort(
        (a, b) => priorityOrder.indexOf(a.type) - priorityOrder.indexOf(b.type)
      )

      // Folders eligible for history backfill this cycle (IMAP only)
      const backfillCandidates: Array<{ folderId: string; remoteId: string; serverCount: number }> = []

      for (let i = 0; i < sorted.length; i++) {
        const folder = sorted[i]
        const cursor = (folder.syncCursor as string | null) ?? null

        const result = await worker.provider
          .syncFolder(folder.remoteId, cursor)
          .catch((err: unknown) => {
            console.error(`[SyncEngine] syncFolder ${folder.remoteId}:`, err)
            return null
          })

        if (result) {
          this.persistSyncResult(accountId, folder.id, result.messages, result.deletedRemoteIds)
          if (result.nextCursor) updateFolderSyncCursor(folder.id, result.nextCursor)

          // Ghost reconciliation: messages deleted in another client vanish
          // from the server but linger locally. Only for IMAP (Gmail/Graph
          // report deletions natively), only when UIDVALIDITY is stable
          // across this sync, and only when the server holds fewer messages
          // than we do — the cheap signal that something was deleted.
          if (
            worker.provider instanceof ImapProvider &&
            result.serverMessageCount !== undefined &&
            this.cursorUidValidityStable(cursor, result.nextCursor)
          ) {
            await this.reconcileFolderGhosts(
              accountId,
              worker.provider,
              folder.id,
              folder.remoteId,
              result.serverMessageCount
            )
            backfillCandidates.push({
              folderId: folder.id,
              remoteId: folder.remoteId,
              serverCount: result.serverMessageCount,
            })
          }
        }

        worker.status = {
          state: 'syncing',
          progress: Math.round(((i + 1) / sorted.length) * 100),
        }
        this.broadcastStatus(accountId, worker.status)
      }

      // One page of history per cycle: fills folders beyond the initial 500
      // in the background, resumable by construction (the DB's lowest UID is
      // the state), without blocking or delaying the live sync above.
      let backfillRemaining = 0
      if (worker.provider instanceof ImapProvider && backfillCandidates.length > 0) {
        backfillRemaining = await this.backfillOnePage(accountId, worker.provider, backfillCandidates)
      }

      updateAccount(accountId, { lastSyncAt: Date.now() })
      worker.consecutiveFailures = 0
      worker.status = {
        state: 'idle',
        lastSyncAt: Date.now(),
        lastSyncDurationMs: Date.now() - syncStart,
        realtime: worker.status.realtime,
        ...(backfillRemaining > 0 ? { backfillRemaining } : {}),
      }
      this.broadcastStatus(accountId, worker.status)

      const unread = getTotalUnreadCount()
      this.send(IPC.WINDOW_SET_BADGE, unread)
    } catch (err: unknown) {
      console.error(`[SyncEngine] account ${accountId} failed:`, err)
      worker.consecutiveFailures++
      const { message, category } = describeSyncError(err)
      worker.status = {
        state: 'error',
        lastError: message,
        errorCategory: category,
        consecutiveFailures: worker.consecutiveFailures,
        realtime: worker.status.realtime,
      }
      this.broadcastStatus(accountId, worker.status)
    } finally {
      worker.syncing = false
      release()
      this.scheduleNextSync(accountId)
    }
  }

  // ── Ghost reconciliation (IMAP server-side deletions) ──────────────────

  /** True when both cursors parse and carry the same UIDVALIDITY. */
  private cursorUidValidityStable(before: string | null, after: string | null): boolean {
    const a = parseCursor(before)
    const b = parseCursor(after)
    return a !== null && b !== null && a.uidvalidity === b.uidvalidity
  }

  private async reconcileFolderGhosts(
    accountId: string,
    provider: ImapProvider,
    folderId: string,
    folderRemoteId: string,
    serverMessageCount: number
  ): Promise<void> {
    try {
      const localRemoteIds = getMessageRemoteIdsByFolder(folderId)
      // Cheap gate: the expensive UID listing only runs when the server has
      // fewer messages than we hold — the signature of a deletion elsewhere
      if (localRemoteIds.length <= serverMessageCount) return

      const { uids, count } = await provider.listFolderUids(folderRemoteId)
      const ghosts = computeGhostRemoteIds(localRemoteIds, uids, count)
      if (ghosts.length === 0) return

      console.info(
        `[SyncEngine] Reconciling ${ghosts.length} server-deleted message(s) in folder ${folderRemoteId} (${accountId})`
      )
      // Route through the normal deletion path: threads, counts, and the
      // search index all update exactly like a provider-reported deletion
      this.persistSyncResult(accountId, folderId, [], ghosts)
    } catch (err) {
      // Reconciliation is best-effort — never let it break the sync cycle
      console.warn(`[SyncEngine] ghost reconciliation failed for ${folderRemoteId}:`, err)
    }
  }

  // ── History backfill ─────────────────────────────────────────────────────

  /**
   * Fetch ONE page of history for the highest-priority folder that has more
   * messages on the server than locally. Returns the total number of
   * messages still missing across all candidate folders (for the UI).
   */
  private async backfillOnePage(
    accountId: string,
    provider: ImapProvider,
    candidates: Array<{ folderId: string; remoteId: string; serverCount: number }>
  ): Promise<number> {
    const PAGE_SIZE = 300
    let remaining = 0
    let pageDone = false

    for (const c of candidates) {
      const localCount = countMessagesByFolder(c.folderId)
      const deficit = c.serverCount - localCount
      if (deficit <= 0) continue
      remaining += deficit
      if (pageDone) continue

      const minUid = getMinUidByFolder(c.folderId)
      if (!minUid || minUid <= 1) continue

      try {
        const { messages } = await provider.backfillFolder(c.remoteId, minUid, PAGE_SIZE)
        if (messages.length > 0) {
          this.persistSyncResult(accountId, c.folderId, messages, [], {
            suppressNotifications: true,
          })
          remaining = Math.max(0, remaining - messages.length)
        }
      } catch (err) {
        console.warn(`[SyncEngine] backfill failed for ${c.remoteId}:`, err)
      }
      // One page per account per cycle keeps background load bounded
      pageDone = true
    }
    return remaining
  }

  // ── DB persistence helpers ─────────────────────────────────────────────

  private persistFolders(accountId: string, folders: ProviderFolder[]): FolderSelect[] {
    return folders.map((pf) =>
      upsertFolder({
        id: getFolderByRemoteId(accountId, pf.remoteId)?.id ?? ulid(),
        accountId,
        remoteId: pf.remoteId,
        name: pf.name,
        type: pf.type,
        totalCount: pf.totalCount,
        unreadCount: pf.unreadCount,
        updatedAt: Date.now(),
      })
    )
  }

  private persistSyncResult(
    accountId: string,
    folderId: string,
    messages: RawMessage[],
    deletedRemoteIds: string[],
    // Backfilled history must not fire desktop notifications — the mail is
    // old, the user has already seen it elsewhere
    opts: { suppressNotifications?: boolean } = {}
  ): void {
    const newThreadRows: ThreadRow[] = []
    const indexItems: Parameters<typeof indexMessageBatch>[0] = []

    for (const raw of messages) {
      const existingThread = raw.threadRemoteId
        ? getThreadByRemoteId(accountId, raw.threadRemoteId)
        : undefined

      const { thread: nt, message: nm } = normalizeMessage(
        raw,
        accountId,
        folderId,
        existingThread?.id
      )

      const existingMsg = getMessageByRemoteId(accountId, raw.remoteId)

      if (!existingMsg) {
        const siblings = existingThread ? getMessagesByThread(existingThread.id) : []
        const prevUnread = existingThread?.unreadCount ?? 0
        const newUnread = prevUnread + (raw.isRead ? 0 : 1)

        const threadRow = upsertThread(toThreadInsert(nt, siblings.length + 1, newUnread))
        const msgRow = upsertMessage(toMessageInsert(nm, threadRow.id))

        for (const att of raw.attachments) {
          upsertAttachment({
            id: ulid(),
            messageId: msgRow.id,
            filename: att.filename,
            mimeType: att.mimeType,
            size: att.size,
            remoteRef: att.remoteRef,
            localPath: null,
            isDownloaded: false,
            isInline: att.isInline,
            contentId: att.contentId ?? null,
          })
        }

        indexItems.push({
          messageId: msgRow.id,
          accountId,
          threadId: threadRow.id,
          subject: raw.subject,
          bodyText: raw.bodyText || '',
          fromAddress: raw.from.address,
          fromName: raw.from.name ?? null,
          toAddresses: raw.to.map((a) => a.address).join(' '),
        })

        // Extract verification / 2FA codes from incoming messages
        if (!msgRow.isDraft) {
          const subject = msgRow.subject ?? ''
          const bodyText = msgRow.bodyText ?? ''
          if (isVerificationEmail(subject, bodyText)) {
            const extracted = extractVerification(subject, bodyText)
            if (extracted && !hasRecentDuplicate(accountId, extracted.code, msgRow.date, msgRow.id)) {
              try {
                const vcRow = insertVerificationCode({
                  accountId,
                  messageId: msgRow.id,
                  serviceName: detectServiceName(msgRow.fromAddress, msgRow.fromName),
                  senderEmail: msgRow.fromAddress,
                  senderName: msgRow.fromName,
                  code: extracted.code,
                  subject,
                  receivedAt: msgRow.date,
                })
                this.send(IPC.VERIFICATION_CODES_NEW, vcRow)
                if (!opts.suppressNotifications) {
                  NotificationService.getInstance().notifyVerificationCode({
                    serviceName: vcRow.serviceName,
                    code: vcRow.code,
                    accountEmail: getAccountById(accountId)?.email ?? '',
                    accountId,
                  })
                }
              } catch { /* non-fatal — never break sync */ }
            }
          }
        }

        if (!existingThread) newThreadRows.push(toThreadRow(threadRow))
      } else {
        const siblings = existingThread ? getMessagesByThread(existingThread.id) : []
        const unread = siblings.filter((m) => !m.isRead).length
        upsertThread(toThreadInsert(nt, siblings.length, unread))
        upsertMessage(toMessageInsert(nm, existingMsg.threadId))
      }
    }

    if (indexItems.length > 0) indexMessageBatch(indexItems)

    if (deletedRemoteIds.length > 0) {
      const localIds: string[] = []
      for (const remoteId of deletedRemoteIds) {
        const msg = getMessageByRemoteId(accountId, remoteId)
        if (!msg) continue
        localIds.push(msg.id)
        const remaining = getMessagesByThread(msg.threadId).filter((m) => m.id !== msg.id)
        if (remaining.length === 0) {
          deleteThread(msg.threadId)
        } else {
          updateThreadCounts(
            msg.threadId,
            remaining.filter((m) => !m.isRead).length,
            remaining.length
          )
        }
      }
      if (localIds.length > 0) {
        dbDeleteMessages(localIds)
        this.send(IPC.MESSAGES_DELETED, localIds)
      }
    }

    if (newThreadRows.length > 0) {
      this.send(IPC.MESSAGES_NEW, { threads: newThreadRows, accountId })
      if (!opts.suppressNotifications) {
        const notifItems = messages
          .filter((raw) => !raw.isRead)
          .slice(0, 5)
          .map((raw) => ({
            subject: raw.subject,
            fromName: raw.from.name ?? null,
            fromAddress: raw.from.address,
            accountId,
          }))
        if (notifItems.length > 0) {
          NotificationService.getInstance().notifyNewMessages(notifItems)
        }
      }
    }
  }

  /**
   * Push to the renderer. `this.win?.` guards null but NOT a destroyed
   * window: on quit, shutdown() stops the IDLE watchers, whose state
   * callbacks fire after the BrowserWindow is gone — sending there throws
   * "Object has been destroyed" as an uncaught exception.
   */
  private send(channel: string, payload: unknown): void {
    const win = this.win
    if (!win || win.isDestroyed()) return
    win.webContents.send(channel, payload)
  }

  private broadcastStatus(accountId: string, status: SyncStatus): void {
    this.send(IPC.ACCOUNTS_SYNC_STATUS_CHANGED, { accountId, status })
  }
}
