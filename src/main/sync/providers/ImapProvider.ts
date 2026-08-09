import { ImapFlow } from 'imapflow'
import type { ListTreeResponse, FetchMessageObject } from 'imapflow'
import { simpleParser } from 'mailparser'
import nodemailer from 'nodemailer'
import { credentialStore } from '../../security/keychain'
import { BaseProvider } from './BaseProvider'
import type {
  OAuthTokens,
  BasicCredentials,
  ProviderFolder,
  SyncResult,
  RawMessage,
  RawAttachment,
  AddressObject,
  Draft,
  PushConfig,
  RemoteMessageRef,
} from '@shared/types/provider'
import type { ProviderKind } from '@shared/constants/providers'
import {
  mapFolderType,
  parseCursor,
  encodeCursor,
  normalizeUidValidity,
  groupRefsByFolder,
  parseAttachmentRef,
  findAttachmentByKey,
} from './imapHelpers'

// ── Credential storage ────────────────────────────────────────────────────

export function storeImapCredentials(accountId: string, creds: BasicCredentials): void {
  credentialStore.set(`account:${accountId}:credentials`, JSON.stringify(creds))
}

function loadImapCredentials(accountId: string): BasicCredentials {
  const raw = credentialStore.get(`account:${accountId}:credentials`)
  if (!raw) throw new Error('IMAP credentials not found. Please reconnect this account.')
  return JSON.parse(raw) as BasicCredentials
}

/** How many recently-synced messages to re-check flags for each cycle. */
const FLAG_WINDOW = 500

// ── Address helpers ────────────────────────────────────────────────────────

function toAddressObjects(
  addrs: { name?: string | null; address?: string | null }[] | undefined | null
): AddressObject[] {
  if (!addrs) return []
  return addrs
    .filter((a): a is { name?: string; address: string } => !!a.address)
    .map((a) => ({ name: a.name ?? undefined, address: a.address! }))
}

// ── ImapProvider ──────────────────────────────────────────────────────────

export class ImapProvider extends BaseProvider {
  readonly kind: ProviderKind
  readonly accountId: string
  private _credentials: BasicCredentials

  constructor(accountId: string, providerKind: ProviderKind, credentials: BasicCredentials) {
    super()
    this.accountId = accountId
    this.kind = providerKind
    this._credentials = credentials
  }

  // ── Client factory ─────────────────────────────────────────────────────

  private makeClient(): ImapFlow {
    const creds = this._credentials
    // App passwords (Gmail, Outlook) are displayed with spaces; strip them before auth
    const password = creds.password.replace(/\s/g, '')
    const client = new ImapFlow({
      host: creds.host,
      port: creds.port,
      secure: creds.security === 'TLS',
      tls: { rejectUnauthorized: true },
      auth: { user: creds.username, pass: password },
      logger: false,
      // Restart IDLE well under the 29-minute RFC 2177 limit — some servers
      // silently drop connections that idle too long
      maxIdleTime: 10 * 60 * 1000,
    })
    // ImapFlow is an EventEmitter: a socket error with no 'error' listener
    // becomes an unhandled exception that bypasses the operation's own error
    // handling. In-flight commands still reject through their promises.
    client.on('error', (err: Error) => {
      console.warn(`[ImapProvider:${this.accountId}] connection error:`, err.message)
    })
    return client
  }

  /** A fresh connection for long-lived use (IDLE watching). Caller owns lifecycle. */
  makeDedicatedClient(): ImapFlow {
    return this.makeClient()
  }

  private makeTransport(): nodemailer.Transporter {
    const creds = this._credentials
    return nodemailer.createTransport({
      host: creds.smtpHost,
      port: creds.smtpPort,
      secure: creds.smtpSecurity === 'TLS',
      auth: { user: creds.username, pass: creds.password },
      tls: { rejectUnauthorized: true },
    })
  }

  // ── Folder-scoped mutation plumbing ────────────────────────────────────
  // IMAP UIDs are only unique within a mailbox. Refs missing folder context
  // are skipped (and logged) rather than guessed: operating on a UID in the
  // wrong mailbox can silently mutate an unrelated message.

  /** Open one connection, run `op` once per folder group with the mailbox locked. */
  private async withFolderGroups(
    refs: RemoteMessageRef[],
    op: (client: ImapFlow, uidSet: string) => Promise<void>
  ): Promise<void> {
    const { byFolder, skipped } = groupRefsByFolder(refs)
    if (skipped > 0) {
      console.warn(
        `[ImapProvider:${this.accountId}] Skipped ${skipped} message ref(s) without folder context — remote state will reconcile on next sync`
      )
    }
    if (byFolder.size === 0) return

    const client = this.makeClient()
    const failures: string[] = []
    try {
      await client.connect()
      for (const [folderPath, uids] of byFolder) {
        // Lock acquisition can itself fail (folder deleted/renamed server-side);
        // record it and continue with the remaining folder groups
        try {
          const lock = await client.getMailboxLock(folderPath)
          try {
            await op(client, uids.join(','))
          } finally {
            lock.release()
          }
        } catch (err) {
          failures.push(`${folderPath}: ${err instanceof Error ? err.message : String(err)}`)
        }
      }
    } finally {
      await client.logout().catch(() => {})
    }

    if (failures.length > 0) {
      throw new Error(`IMAP operation failed for ${failures.length} folder(s): ${failures.join('; ')}`)
    }
  }

  // ── Auth (IMAP uses stored credentials, no OAuth dance) ────────────────

  async authenticate(): Promise<BasicCredentials> {
    await this.testConnection()
    storeImapCredentials(this.accountId, this._credentials)
    return this._credentials
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async refreshTokens(_current: OAuthTokens): Promise<OAuthTokens> {
    throw new Error('IMAP does not use OAuth tokens')
  }

  async revokeAccess(): Promise<void> {
    credentialStore.delete(`account:${this.accountId}:credentials`)
  }

  async testConnection(): Promise<{ success: boolean; error?: string }> {
    const client = this.makeClient()
    let connected = false
    try {
      await client.connect()
      connected = true
      await client.logout()
      return { success: true }
    } catch (err) {
      // If connect() succeeded but logout() failed, the credentials are valid
      if (connected) return { success: true }
      // Extract the server's response text when available (richer than the generic message)
      const detail =
        (err as { responseText?: string }).responseText ??
        (err instanceof Error ? err.message : String(err))
      return { success: false, error: detail }
    }
  }

  // ── Folders ────────────────────────────────────────────────────────────

  async listFolders(): Promise<ProviderFolder[]> {
    const client = this.makeClient()
    try {
      await client.connect()
      const tree = await client.listTree()
      const folders: ProviderFolder[] = []

      const walk = (items: ListTreeResponse[]): void => {
        for (const item of items) {
          if (item.flags?.has('\\Noselect')) {
            if (item.folders) walk(item.folders)
            continue
          }
          const name = item.name ?? item.path ?? ''
          folders.push({
            remoteId: item.path ?? name,
            name,
            type: mapFolderType(name, item.specialUse ?? ''),
            totalCount: 0,
            unreadCount: 0,
          })
          if (item.folders) walk(item.folders)
        }
      }

      walk(tree.folders ?? [])
      return folders
    } finally {
      await client.logout().catch(() => {})
    }
  }

  async getFolder(remoteId: string): Promise<ProviderFolder> {
    const client = this.makeClient()
    try {
      await client.connect()
      const status = await client.status(remoteId, { messages: true, unseen: true })
      return {
        remoteId,
        name: remoteId.split('/').pop() ?? remoteId,
        type: mapFolderType(remoteId),
        totalCount: status.messages ?? 0,
        unreadCount: status.unseen ?? 0,
      }
    } finally {
      await client.logout().catch(() => {})
    }
  }

  // ── Sync ───────────────────────────────────────────────────────────────

  async syncFolder(folderId: string, cursor: string | null): Promise<SyncResult> {
    const client = this.makeClient()
    try {
      await client.connect()
      const lock = await client.getMailboxLock(folderId)
      try {
        const mailbox = client.mailbox as unknown as {
          uidValidity?: bigint | number
          uidNext?: number
          exists?: number
        }
        // imapflow reports uidValidity as a BigInt. Comparing it to the
        // Number parsed from our cursor with !== is ALWAYS true (JS never
        // considers a Number and a BigInt strictly equal), which made every
        // sync believe UIDVALIDITY had changed and re-download the whole
        // folder, forever. Normalise to Number — UIDVALIDITY is a 32-bit
        // value, so it always fits.
        const uidValidity = normalizeUidValidity(mailbox.uidValidity)
        const uidNext = mailbox.uidNext
        const exists = mailbox.exists

        const parsed = parseCursor(cursor)

        // UIDVALIDITY changed → the server reassigned UIDs, full re-sync
        if (parsed && uidValidity && parsed.uidvalidity !== uidValidity) {
          return await this.doFullSync(client, folderId, uidValidity, uidNext ?? 1)
        }

        if (parsed && parsed.highestUid > 0) {
          // uidNext is passed raw: RFC 3501 lets a server omit [UIDNEXT] from
          // SELECT, and defaulting the unknown to 1 would make the
          // "nothing new" shortcut below always fire — the folder would
          // silently stop receiving mail forever.
          return await this.doIncrementalSync(
            client,
            folderId,
            parsed.highestUid,
            uidValidity,
            uidNext,
            exists ?? 0
          )
        }

        return await this.doFullSync(client, folderId, uidValidity, uidNext ?? 1)
      } finally {
        lock.release()
      }
    } finally {
      await client.logout().catch(() => {})
    }
  }

  private async doFullSync(
    client: ImapFlow,
    folderId: string,
    uidValidity: number,
    uidNext: number
  ): Promise<SyncResult> {
    const messages: RawMessage[] = []
    const status = await client.status(folderId, { messages: true })
    const total = status.messages ?? 0

    if (total === 0) {
      return {
        messages: [],
        deletedRemoteIds: [],
        nextCursor: encodeCursor(uidValidity, 0),
        hasMore: false,
        serverMessageCount: 0,
      }
    }

    // Fetch last 500 messages (most recent first via reverse seq range)
    const fetchCount = Math.min(total, 500)
    const startSeq = Math.max(1, total - fetchCount + 1)

    let highestUid = 0
    for await (const msg of client.fetch(`${startSeq}:*`, {
      envelope: true,
      source: true,
      flags: true,
      uid: true,
    })) {
      const parsed = await this.parseFetchMessage(msg, folderId)
      if (parsed) {
        messages.push(parsed)
        if ((msg.uid ?? 0) > highestUid) highestUid = msg.uid ?? 0
      }
    }

    return {
      messages,
      deletedRemoteIds: [],
      // Advance only to what actually parsed. Falling back to uidNext-1 when
      // nothing parsed would skip those messages permanently; a "V:0" cursor
      // instead fails parseCursor next cycle and retries the full sync.
      nextCursor: encodeCursor(uidValidity, highestUid),
      hasMore: total > fetchCount,
      serverMessageCount: total,
    }
  }

  private async doIncrementalSync(
    client: ImapFlow,
    folderId: string,
    lastUid: number,
    uidValidity: number,
    uidNext: number | undefined,
    serverMessageCount: number
  ): Promise<SyncResult> {
    // Only trust the shortcut when the server actually told us UIDNEXT.
    // When it is unknown, fall through and let UID FETCH answer the
    // question — the uid <= lastUid guard below discards the message the
    // normalised range returns when there is genuinely nothing new.
    if (typeof uidNext === 'number' && uidNext > 0 && uidNext <= lastUid + 1) {
      return {
        messages: [],
        deletedRemoteIds: [],
        nextCursor: encodeCursor(uidValidity, lastUid),
        hasMore: false,
        serverMessageCount,
        flagUpdates: await this.fetchFlagWindow(client, lastUid),
      }
    }

    const messages: RawMessage[] = []
    let highestUid = lastUid

    for await (const msg of client.fetch(
      { uid: `${lastUid + 1}:*` },
      { envelope: true, source: true, flags: true, uid: true },
      { uid: true }
    )) {
      // RFC 3501 ranges are inclusive and normalised, so "501:*" against a
      // mailbox whose highest UID is 400 still returns UID 400. Without this
      // guard every incremental sync re-downloads the newest message.
      const uid = msg.uid ?? 0
      if (uid <= lastUid) continue

      const parsed = await this.parseFetchMessage(msg, folderId)
      if (parsed) {
        messages.push(parsed)
        if (uid > highestUid) highestUid = uid
      }
    }

    return {
      messages,
      deletedRemoteIds: [],
      nextCursor: encodeCursor(uidValidity, highestUid),
      hasMore: false,
      serverMessageCount,
      flagUpdates: await this.fetchFlagWindow(client, lastUid),
    }
  }

  /**
   * Read/starred state for the most recent already-synced messages. Fetches
   * flags only — no envelopes, no bodies — so it stays cheap enough to run
   * every cycle. Bounded to a window because reconciling an entire mailbox
   * on every poll would undo the point of incremental sync.
   */
  private async fetchFlagWindow(
    client: ImapFlow,
    lastUid: number
  ): Promise<SyncResult['flagUpdates']> {
    if (lastUid <= 0) return []
    const floor = Math.max(1, lastUid - FLAG_WINDOW + 1)
    const updates: NonNullable<SyncResult['flagUpdates']> = []
    try {
      for await (const msg of client.fetch(
        { uid: `${floor}:${lastUid}` },
        { uid: true, flags: true },
        { uid: true }
      )) {
        const uid = msg.uid ?? 0
        // Inclusive-range normalisation can hand back a UID outside the window
        if (uid < floor || uid > lastUid) continue
        const flags = msg.flags ?? new Set<string>()
        updates.push({
          remoteId: String(uid),
          isRead: flags.has('\\Seen'),
          isStarred: flags.has('\\Flagged'),
        })
      }
    } catch (err) {
      // Best effort: never fail a sync because flag reconciliation stumbled
      console.warn(`[ImapProvider:${this.accountId}] flag refresh failed:`, err)
      return []
    }
    return updates
  }

  /**
   * Fetch one page of history older than `belowUid`. SEARCH finds the
   * actual existing UIDs below the floor (expunged gaps can't stall the
   * pagination), then the newest `pageSize` of those are fetched.
   */
  async backfillFolder(
    folderRemoteId: string,
    belowUid: number,
    pageSize: number
  ): Promise<{ messages: RawMessage[]; exhausted: boolean }> {
    if (belowUid <= 1) return { messages: [], exhausted: true }
    const client = this.makeClient()
    try {
      await client.connect()
      const lock = await client.getMailboxLock(folderRemoteId)
      try {
        const uids = await client.search({ uid: `1:${belowUid - 1}` }, { uid: true })
        if (!uids || uids.length === 0) return { messages: [], exhausted: true }

        const page = uids.sort((a, b) => a - b).slice(-pageSize)
        const messages: RawMessage[] = []
        for await (const msg of client.fetch(
          { uid: page.join(',') },
          { envelope: true, source: true, flags: true, uid: true },
          { uid: true }
        )) {
          const parsed = await this.parseFetchMessage(msg, folderRemoteId)
          if (parsed) messages.push(parsed)
        }
        return { messages, exhausted: uids.length <= page.length }
      } finally {
        lock.release()
      }
    } finally {
      await client.logout().catch(() => {})
    }
  }

  /**
   * Full UID listing for a folder — used by the engine to reconcile
   * server-side deletions when the server reports fewer messages than we
   * hold locally. Returns UIDs plus the mailbox's message count so the
   * caller can validate the listing wasn't truncated.
   */
  async listFolderUids(folderRemoteId: string): Promise<{ uids: string[]; count: number }> {
    const client = this.makeClient()
    try {
      await client.connect()
      const lock = await client.getMailboxLock(folderRemoteId)
      try {
        const { exists } = client.mailbox as unknown as { exists?: number }
        const uids = await client.search({ all: true }, { uid: true })
        return {
          uids: (uids || []).map((u) => String(u)),
          count: exists ?? 0,
        }
      } finally {
        lock.release()
      }
    } finally {
      await client.logout().catch(() => {})
    }
  }

  private async parseFetchMessage(
    msg: FetchMessageObject,
    folderId: string
  ): Promise<RawMessage | null> {
    try {
      if (!msg.source) return null
      const parsed = await simpleParser(msg.source)

      const flags = msg.flags ?? new Set<string>()
      const isRead = flags.has('\\Seen')
      const isStarred = flags.has('\\Flagged')
      const isDraft = flags.has('\\Draft')

      const remoteId = String(msg.uid ?? msg.seq)
      const threadRemoteId =
        parsed.headers.get('thread-index')?.toString() ??
        parsed.messageId?.replace(/^<|>$/g, '') ??
        remoteId

      const attachments: RawAttachment[] = (parsed.attachments ?? []).map((att) => ({
        filename: att.filename ?? 'attachment',
        mimeType: att.contentType,
        size: att.size,
        remoteRef: `${remoteId}:${att.checksum ?? att.filename ?? 'att'}`,
        contentId: att.cid ?? undefined,
        isInline: att.related ?? false,
      }))

      const labels: string[] = [...flags]
        .filter((f) => !f.startsWith('\\'))
        .map((f) => f.replace(/^\$/, ''))

      const normalizeAddr = (
        field: import('mailparser').AddressObject | import('mailparser').AddressObject[] | undefined
      ) => (Array.isArray(field) ? field[0] : field)

      const refs = parsed.references
      const refsArray: string[] = Array.isArray(refs) ? refs : refs ? [refs] : []

      return {
        remoteId,
        threadRemoteId,
        folderId,
        from: toAddressObjects(normalizeAddr(parsed.from)?.value)[0] ?? { address: 'unknown@unknown.com' },
        to: toAddressObjects(normalizeAddr(parsed.to)?.value),
        cc: toAddressObjects(normalizeAddr(parsed.cc)?.value),
        bcc: toAddressObjects(normalizeAddr(parsed.bcc)?.value),
        replyTo: toAddressObjects(normalizeAddr(parsed.replyTo)?.value),
        subject: parsed.subject ?? '(No Subject)',
        bodyHtml: parsed.html || '',
        bodyText: parsed.text || '',
        date: parsed.date ?? new Date(),
        isRead,
        isStarred,
        isDraft,
        labels,
        attachments,
        headers: Object.fromEntries(
          [...parsed.headers.entries()].map(([k, v]) => [k, String(v)])
        ),
        sizeBytes: msg.size ?? 0,
        inReplyTo: parsed.inReplyTo?.replace(/^<|>$/g, '') ?? undefined,
        references: refsArray.map((r) => r.replace(/^<|>$/g, '')),
      }
    } catch {
      return null
    }
  }

  async fetchMessage(remoteId: string, folderRemoteId?: string | null): Promise<RawMessage> {
    const mailbox = folderRemoteId ?? 'INBOX'
    const client = this.makeClient()
    try {
      await client.connect()
      const lock = await client.getMailboxLock(mailbox)
      try {
        for await (const msg of client.fetch(
          { uid: remoteId },
          { envelope: true, source: true, flags: true, uid: true },
          { uid: true }
        )) {
          const parsed = await this.parseFetchMessage(msg, mailbox)
          if (parsed) return parsed
        }
        throw new Error(`Message ${remoteId} not found in ${mailbox}`)
      } finally {
        lock.release()
      }
    } finally {
      await client.logout().catch(() => {})
    }
  }

  async fetchAttachment(remoteRef: string, folderRemoteId?: string | null): Promise<Buffer> {
    // IMAP attachments are fetched by re-downloading the full message and
    // extracting the requested part. remoteRef format: "{uid}:{key}" where
    // key is the same checksum/filename used when the ref was generated
    // during sync (see parseFetchMessage).
    const { uid: uidStr, key: attKey } = parseAttachmentRef(remoteRef)
    const mailbox = folderRemoteId ?? 'INBOX'
    const client = this.makeClient()
    try {
      await client.connect()
      const lock = await client.getMailboxLock(mailbox)
      try {
        for await (const msg of client.fetch(
          { uid: uidStr },
          { source: true, uid: true },
          { uid: true }
        )) {
          if (!msg.source) continue
          const parsed = await simpleParser(msg.source)
          const attachments = parsed.attachments ?? []

          const match = findAttachmentByKey(attachments, attKey)
          if (match?.content) return match.content

          throw new Error(
            `Attachment "${attKey}" not found in message ${uidStr} (${attachments.length} attachment(s) present)`
          )
        }
        throw new Error(`Message ${uidStr} not found in ${mailbox}`)
      } finally {
        lock.release()
      }
    } finally {
      await client.logout().catch(() => {})
    }
  }

  // ── Mutations ──────────────────────────────────────────────────────────

  async sendMessage(draft: Draft): Promise<{ remoteId: string }> {
    const transport = this.makeTransport()

    const info = await transport.sendMail({
      from: `"${draft.to[0]?.name ?? ''}" <${this._credentials.username}>`,
      to: draft.to.map((a) => (a.name ? `"${a.name}" <${a.address}>` : a.address)).join(', '),
      cc: draft.cc?.map((a) => a.address).join(', '),
      bcc: draft.bcc?.map((a) => a.address).join(', '),
      subject: draft.subject,
      html: draft.bodyHtml,
      text: draft.bodyText,
      inReplyTo: draft.inReplyToRemoteId ? `<${draft.inReplyToRemoteId}>` : undefined,
      references: draft.inReplyToRemoteId ? `<${draft.inReplyToRemoteId}>` : undefined,
    })

    return { remoteId: info.messageId ?? `sent_${Date.now()}` }
  }

  async createDraft(draft: Draft): Promise<{ remoteId: string }> {
    const client = this.makeClient()
    try {
      await client.connect()

      // Build a minimal RFC 2822 MIME message for IMAP APPEND
      const subject = draft.subject ?? ''
      const body = draft.bodyHtml ?? draft.bodyText ?? ''
      const isHtml = Boolean(draft.bodyHtml)
      const raw = [
        `From: ${this._credentials.username}`,
        `Subject: ${subject}`,
        `MIME-Version: 1.0`,
        `Content-Type: ${isHtml ? 'text/html' : 'text/plain'}; charset=utf-8`,
        `Content-Transfer-Encoding: base64`,
        ``,
        Buffer.from(body, 'utf8').toString('base64'),
      ].join('\r\n')

      const folders = await this.listFolders()
      const draftsFolder = folders.find((f) => f.type === 'drafts')?.remoteId ?? 'Drafts'

      const appendResult = await client.append(draftsFolder, raw, ['\\Draft', '\\Seen'])
      return {
        remoteId: String(appendResult !== false ? appendResult.uid : Date.now()),
      }
    } finally {
      await client.logout().catch(() => {})
    }
  }

  async updateDraft(remoteId: string, draft: Draft): Promise<void> {
    await this.deleteDraft(remoteId)
    await this.createDraft(draft)
  }

  async deleteDraft(remoteId: string): Promise<void> {
    const client = this.makeClient()
    try {
      await client.connect()
      const folders = await this.listFolders()
      const draftsFolder = folders.find((f) => f.type === 'drafts')?.remoteId ?? 'Drafts'
      const lock = await client.getMailboxLock(draftsFolder)
      try {
        await client.messageDelete({ uid: remoteId }, { uid: true })
      } finally {
        lock.release()
      }
    } finally {
      await client.logout().catch(() => {})
    }
  }

  async markRead(refs: RemoteMessageRef[], read: boolean): Promise<void> {
    if (refs.length === 0) return
    await this.withFolderGroups(refs, async (client, uidSet) => {
      if (read) {
        await client.messageFlagsAdd({ uid: uidSet }, ['\\Seen'], { uid: true })
      } else {
        await client.messageFlagsRemove({ uid: uidSet }, ['\\Seen'], { uid: true })
      }
    })
  }

  async star(refs: RemoteMessageRef[], starred: boolean): Promise<void> {
    if (refs.length === 0) return
    await this.withFolderGroups(refs, async (client, uidSet) => {
      if (starred) {
        await client.messageFlagsAdd({ uid: uidSet }, ['\\Flagged'], { uid: true })
      } else {
        await client.messageFlagsRemove({ uid: uidSet }, ['\\Flagged'], { uid: true })
      }
    })
  }

  async moveMessages(refs: RemoteMessageRef[], targetFolderRemoteId: string): Promise<void> {
    if (refs.length === 0) return
    await this.withFolderGroups(refs, async (client, uidSet) => {
      await client.messageMove({ uid: uidSet }, targetFolderRemoteId, { uid: true })
    })
  }

  async deleteMessages(refs: RemoteMessageRef[]): Promise<void> {
    if (refs.length === 0) return
    await this.withFolderGroups(refs, async (client, uidSet) => {
      await client.messageDelete({ uid: uidSet }, { uid: true })
    })
  }

  async addLabels(refs: RemoteMessageRef[], labels: string[]): Promise<void> {
    if (refs.length === 0 || labels.length === 0) return
    await this.withFolderGroups(refs, async (client, uidSet) => {
      await client.messageFlagsAdd({ uid: uidSet }, labels.map((l) => `$${l}`), { uid: true })
    })
  }

  async removeLabels(refs: RemoteMessageRef[], labels: string[]): Promise<void> {
    if (refs.length === 0 || labels.length === 0) return
    await this.withFolderGroups(refs, async (client, uidSet) => {
      await client.messageFlagsRemove({ uid: uidSet }, labels.map((l) => `$${l}`), { uid: true })
    })
  }

  async searchRemote(query: string, folderId = 'INBOX'): Promise<RawMessage[]> {
    const client = this.makeClient()
    try {
      await client.connect()
      const lock = await client.getMailboxLock(folderId)
      try {
        const uids = await client.search({ text: query }, { uid: true })
        if (!uids || uids.length === 0) return []

        const results: RawMessage[] = []
        const slice = uids.slice(-50) // most recent 50
        for await (const msg of client.fetch(
          { uid: slice.join(',') },
          { envelope: true, source: true, flags: true, uid: true },
          { uid: true }
        )) {
          const parsed = await this.parseFetchMessage(msg, folderId)
          if (parsed) results.push(parsed)
        }
        return results
      } finally {
        lock.release()
      }
    } finally {
      await client.logout().catch(() => {})
    }
  }

  // ── Push (IMAP uses polling; IDLE can be added later) ──────────────────

  async setupPush(): Promise<PushConfig> {
    return { type: 'polling' }
  }

  async teardownPush(): Promise<void> {}

  async handlePushEvent(): Promise<SyncResult> {
    return { messages: [], deletedRemoteIds: [], nextCursor: null, hasMore: false }
  }

  // ── Factory ────────────────────────────────────────────────────────────

  static fromStore(accountId: string, providerKind: ProviderKind): ImapProvider {
    const creds = loadImapCredentials(accountId)
    return new ImapProvider(accountId, providerKind, creds)
  }
}
