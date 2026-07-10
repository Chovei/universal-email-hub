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
  FolderType,
} from '@shared/types/provider'
import type { ProviderKind } from '@shared/constants/providers'

// ── Credential storage ────────────────────────────────────────────────────

export function storeImapCredentials(accountId: string, creds: BasicCredentials): void {
  credentialStore.set(`account:${accountId}:credentials`, JSON.stringify(creds))
}

function loadImapCredentials(accountId: string): BasicCredentials {
  const raw = credentialStore.get(`account:${accountId}:credentials`)
  if (!raw) throw new Error('IMAP credentials not found. Please reconnect this account.')
  return JSON.parse(raw) as BasicCredentials
}

// ── Folder type mapping ───────────────────────────────────────────────────

function mapFolderType(name: string, specialUse?: string): FolderType {
  const n = name.toUpperCase()
  if (n === 'INBOX') return 'inbox'

  const su = (specialUse ?? '').toLowerCase()
  if (su.includes('sent')) return 'sent'
  if (su.includes('draft')) return 'drafts'
  if (su.includes('trash') || su.includes('deleted')) return 'trash'
  if (su.includes('junk') || su.includes('spam')) return 'spam'
  if (su.includes('archive')) return 'archive'
  if (su.includes('all')) return 'archive'

  // Fall back to name matching
  if (n.includes('SENT')) return 'sent'
  if (n.includes('DRAFT')) return 'drafts'
  if (n.includes('TRASH') || n.includes('DELETED')) return 'trash'
  if (n.includes('JUNK') || n.includes('SPAM')) return 'spam'
  if (n.includes('ARCHIVE')) return 'archive'

  return 'custom'
}

// ── Address helpers ────────────────────────────────────────────────────────

function toAddressObjects(
  addrs: { name?: string | null; address?: string | null }[] | undefined | null
): AddressObject[] {
  if (!addrs) return []
  return addrs
    .filter((a): a is { name?: string; address: string } => !!a.address)
    .map((a) => ({ name: a.name ?? undefined, address: a.address! }))
}

// ── IMAP cursor ────────────────────────────────────────────────────────────
// Format: "{uidvalidity}:{highestUid}"

interface ImapCursor {
  uidvalidity: number
  highestUid: number
}

function parseCursor(cursor: string | null): ImapCursor | null {
  if (!cursor) return null
  const [v, u] = cursor.split(':').map(Number)
  if (!v || !u || isNaN(v) || isNaN(u)) return null
  return { uidvalidity: v, highestUid: u }
}

function encodeCursor(uidvalidity: number, highestUid: number): string {
  return `${uidvalidity}:${highestUid}`
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
    return new ImapFlow({
      host: creds.host,
      port: creds.port,
      secure: creds.security === 'TLS',
      tls: { rejectUnauthorized: true },
      auth: { user: creds.username, pass: password },
      logger: false,
    })
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
        const { uidValidity, uidNext } = client.mailbox as unknown as {
          uidValidity?: number
          uidNext?: number
        }

        const parsed = parseCursor(cursor)

        // UIDVALIDITY changed → full re-sync required
        if (parsed && uidValidity && parsed.uidvalidity !== uidValidity) {
          return await this.doFullSync(client, folderId, uidValidity ?? 0, uidNext ?? 1)
        }

        if (parsed && parsed.highestUid > 0) {
          return await this.doIncrementalSync(
            client,
            folderId,
            parsed.highestUid,
            uidValidity ?? 0,
            uidNext ?? 1
          )
        }

        return await this.doFullSync(client, folderId, uidValidity ?? 0, uidNext ?? 1)
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
      nextCursor: encodeCursor(uidValidity, highestUid || uidNext - 1),
      hasMore: total > fetchCount,
    }
  }

  private async doIncrementalSync(
    client: ImapFlow,
    folderId: string,
    lastUid: number,
    uidValidity: number,
    uidNext: number
  ): Promise<SyncResult> {
    if (uidNext <= lastUid + 1) {
      // Nothing new since last sync
      return {
        messages: [],
        deletedRemoteIds: [],
        nextCursor: encodeCursor(uidValidity, lastUid),
        hasMore: false,
      }
    }

    const messages: RawMessage[] = []
    let highestUid = lastUid

    for await (const msg of client.fetch(
      { uid: `${lastUid + 1}:*` },
      { envelope: true, source: true, flags: true, uid: true },
      { uid: true }
    )) {
      const parsed = await this.parseFetchMessage(msg, folderId)
      if (parsed) {
        messages.push(parsed)
        if ((msg.uid ?? 0) > highestUid) highestUid = msg.uid ?? 0
      }
    }

    return {
      messages,
      deletedRemoteIds: [],
      nextCursor: encodeCursor(uidValidity, highestUid),
      hasMore: false,
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

  async fetchMessage(remoteId: string): Promise<RawMessage> {
    const client = this.makeClient()
    try {
      await client.connect()
      const lock = await client.getMailboxLock('INBOX')
      try {
        for await (const msg of client.fetch(
          { uid: remoteId },
          { envelope: true, source: true, flags: true, uid: true },
          { uid: true }
        )) {
          const parsed = await this.parseFetchMessage(msg, 'INBOX')
          if (parsed) return parsed
        }
        throw new Error(`Message ${remoteId} not found`)
      } finally {
        lock.release()
      }
    } finally {
      await client.logout().catch(() => {})
    }
  }

  async fetchAttachment(remoteRef: string): Promise<Buffer> {
    // IMAP attachments are fetched by re-downloading the full message
    // and extracting the specific attachment by checksum/filename
    const [uidStr] = remoteRef.split(':')
    const client = this.makeClient()
    try {
      await client.connect()
      const lock = await client.getMailboxLock('INBOX')
      try {
        for await (const msg of client.fetch(
          { uid: uidStr },
          { source: true, uid: true },
          { uid: true }
        )) {
          if (!msg.source) continue
          const parsed = await simpleParser(msg.source)
          // Find first attachment (simplistic — good enough for Phase 2)
          const att = parsed.attachments?.[0]
          if (att?.content) return att.content
        }
        throw new Error('Attachment not found')
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

  async markRead(remoteIds: string[], read: boolean): Promise<void> {
    if (remoteIds.length === 0) return
    const client = this.makeClient()
    try {
      await client.connect()
      const lock = await client.getMailboxLock('INBOX')
      try {
        const uidSet = remoteIds.join(',')
        if (read) {
          await client.messageFlagsAdd({ uid: uidSet }, ['\\Seen'], { uid: true })
        } else {
          await client.messageFlagsRemove({ uid: uidSet }, ['\\Seen'], { uid: true })
        }
      } finally {
        lock.release()
      }
    } finally {
      await client.logout().catch(() => {})
    }
  }

  async star(remoteIds: string[], starred: boolean): Promise<void> {
    if (remoteIds.length === 0) return
    const client = this.makeClient()
    try {
      await client.connect()
      const lock = await client.getMailboxLock('INBOX')
      try {
        const uidSet = remoteIds.join(',')
        if (starred) {
          await client.messageFlagsAdd({ uid: uidSet }, ['\\Flagged'], { uid: true })
        } else {
          await client.messageFlagsRemove({ uid: uidSet }, ['\\Flagged'], { uid: true })
        }
      } finally {
        lock.release()
      }
    } finally {
      await client.logout().catch(() => {})
    }
  }

  async moveMessages(remoteIds: string[], targetFolderRemoteId: string): Promise<void> {
    if (remoteIds.length === 0) return
    const client = this.makeClient()
    try {
      await client.connect()
      const lock = await client.getMailboxLock('INBOX')
      try {
        await client.messageMove({ uid: remoteIds.join(',') }, targetFolderRemoteId, { uid: true })
      } finally {
        lock.release()
      }
    } finally {
      await client.logout().catch(() => {})
    }
  }

  async deleteMessages(remoteIds: string[]): Promise<void> {
    if (remoteIds.length === 0) return
    const client = this.makeClient()
    try {
      await client.connect()
      const lock = await client.getMailboxLock('INBOX')
      try {
        await client.messageDelete({ uid: remoteIds.join(',') }, { uid: true })
      } finally {
        lock.release()
      }
    } finally {
      await client.logout().catch(() => {})
    }
  }

  async addLabels(remoteIds: string[], labels: string[]): Promise<void> {
    if (remoteIds.length === 0 || labels.length === 0) return
    const client = this.makeClient()
    try {
      await client.connect()
      const lock = await client.getMailboxLock('INBOX')
      try {
        await client.messageFlagsAdd(
          { uid: remoteIds.join(',') },
          labels.map((l) => `$${l}`),
          { uid: true }
        )
      } finally {
        lock.release()
      }
    } finally {
      await client.logout().catch(() => {})
    }
  }

  async removeLabels(remoteIds: string[], labels: string[]): Promise<void> {
    if (remoteIds.length === 0 || labels.length === 0) return
    const client = this.makeClient()
    try {
      await client.connect()
      const lock = await client.getMailboxLock('INBOX')
      try {
        await client.messageFlagsRemove(
          { uid: remoteIds.join(',') },
          labels.map((l) => `$${l}`),
          { uid: true }
        )
      } finally {
        lock.release()
      }
    } finally {
      await client.logout().catch(() => {})
    }
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
