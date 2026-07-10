import type { BrowserWindow } from 'electron'
import type { ProviderKind } from '@shared/constants/providers'
import type { SyncStatus, ThreadRow, ParticipantAddress } from '@shared/types/db'
import type { BasicCredentials, RawMessage, ProviderFolder } from '@shared/types/provider'
import type { ThreadSelect, FolderSelect, MessageInsert, ThreadInsert } from '../db/schema'
import { GmailProvider } from './providers/GmailProvider'
import { GraphProvider } from './providers/GraphProvider'
import { ImapProvider } from './providers/ImapProvider'
import type { BaseProvider } from './providers/BaseProvider'
import { normalizeMessage } from './normalizer'
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
} from '../db/queries/messages'
import { getFolderByRemoteId, upsertFolder, updateFolderSyncCursor } from '../db/queries/folders'
import { getAccountById, updateAccount } from '../db/queries/accounts'
import { IPC } from '@shared/constants/ipc-channels'
import { monotonicFactory } from 'ulid'
import { isVerificationEmail, extractCode, detectServiceName } from './VerificationExtractor'
import { insertVerificationCode } from '../db/queries/verificationCodes'

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
      case 'gmx': {
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
    }
    this.workers.set(accountId, worker)

    // Initial sync fires immediately; polling timer is set after it completes
    void this.runSync(accountId)
  }

  removeAccount(accountId: string): void {
    const worker = this.workers.get(accountId)
    if (worker?.timer) clearTimeout(worker.timer)
    this.workers.delete(accountId)
  }

  async reconnect(accountId: string): Promise<void> {
    const worker = this.workers.get(accountId)
    if (!worker) return
    if (worker.timer) { clearTimeout(worker.timer); worker.timer = null }
    worker.status = { state: 'idle' }
    void this.runSync(accountId)
  }

  pauseAccount(accountId: string): void {
    const worker = this.workers.get(accountId)
    if (!worker) return
    if (worker.timer) { clearTimeout(worker.timer); worker.timer = null }
    worker.status = { state: 'paused' }
    this.broadcastStatus(accountId, worker.status)
  }

  resumeAccount(accountId: string): void {
    const worker = this.workers.get(accountId)
    if (!worker || worker.status.state !== 'paused') return
    worker.status = { state: 'idle' }
    this.broadcastStatus(accountId, worker.status)
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

  async downloadAttachment(accountId: string, remoteRef: string): Promise<Buffer> {
    return this.requireWorker(accountId).provider.fetchAttachment(remoteRef)
  }

  async markMessagesRead(accountId: string, remoteIds: string[], read: boolean): Promise<void> {
    const w = this.workers.get(accountId)
    if (!w || remoteIds.length === 0) return
    await w.provider.markRead(remoteIds, read).catch(() => {})
  }

  async starMessages(accountId: string, remoteIds: string[], starred: boolean): Promise<void> {
    const w = this.workers.get(accountId)
    if (!w || remoteIds.length === 0) return
    await w.provider.star(remoteIds, starred).catch(() => {})
  }

  async moveMessages(accountId: string, remoteIds: string[], targetFolderRemoteId: string): Promise<void> {
    const w = this.workers.get(accountId)
    if (!w) return
    if (remoteIds.length > 0) {
      await w.provider.moveMessages(remoteIds, targetFolderRemoteId).catch(() => {})
    }
  }

  async deleteRemoteMessages(accountId: string, remoteIds: string[]): Promise<void> {
    const w = this.workers.get(accountId)
    if (!w) return
    if (remoteIds.length > 0) {
      await w.provider.deleteMessages(remoteIds).catch(() => {})
    }
  }

  shutdown(): void {
    for (const [, worker] of this.workers) {
      if (worker.timer) clearTimeout(worker.timer)
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
    worker.timer = setTimeout(() => void this.runSync(accountId), worker.intervalMs)
  }

  private async runSync(accountId: string): Promise<void> {
    const worker = this.workers.get(accountId)
    if (!worker || worker.syncing || worker.status.state === 'paused') return

    worker.syncing = true
    worker.status = { state: 'syncing', progress: 0 }
    this.broadcastStatus(accountId, worker.status)

    try {
      const providerFolders = await worker.provider.listFolders()
      const dbFolders = this.persistFolders(accountId, providerFolders)

      const priorityOrder = ['inbox', 'sent', 'drafts', 'trash', 'spam', 'custom']
      const sorted = [...dbFolders].sort(
        (a, b) => priorityOrder.indexOf(a.type) - priorityOrder.indexOf(b.type)
      )

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
        }

        worker.status = {
          state: 'syncing',
          progress: Math.round(((i + 1) / sorted.length) * 100),
        }
        this.broadcastStatus(accountId, worker.status)
      }

      updateAccount(accountId, { lastSyncAt: Date.now() })
      worker.status = { state: 'idle', lastSyncAt: Date.now() }
      this.broadcastStatus(accountId, worker.status)

      const unread = getTotalUnreadCount()
      this.win?.webContents.send(IPC.WINDOW_SET_BADGE, unread)
    } catch (err: unknown) {
      console.error(`[SyncEngine] account ${accountId} failed:`, err)
      worker.status = { state: 'error', lastError: String(err) }
      this.broadcastStatus(accountId, worker.status)
    } finally {
      worker.syncing = false
      this.scheduleNextSync(accountId)
    }
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
    deletedRemoteIds: string[]
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
            const code = extractCode(subject, bodyText)
            if (code) {
              try {
                const vcRow = insertVerificationCode({
                  accountId,
                  messageId: msgRow.id,
                  serviceName: detectServiceName(msgRow.fromAddress, msgRow.fromName),
                  senderEmail: msgRow.fromAddress,
                  senderName: msgRow.fromName,
                  code,
                  subject,
                  receivedAt: msgRow.date,
                })
                this.win?.webContents.send(IPC.VERIFICATION_CODES_NEW, vcRow)
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
        this.win?.webContents.send(IPC.MESSAGES_DELETED, localIds)
      }
    }

    if (newThreadRows.length > 0) {
      this.win?.webContents.send(IPC.MESSAGES_NEW, { threads: newThreadRows, accountId })
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

  private broadcastStatus(accountId: string, status: SyncStatus): void {
    this.win?.webContents.send(IPC.ACCOUNTS_SYNC_STATUS_CHANGED, { accountId, status })
  }
}
