import { google } from 'googleapis'
import type { gmail_v1 } from 'googleapis'
import type { OAuth2Client } from 'google-auth-library'
import http from 'http'
import net from 'net'
import { shell } from 'electron'
import Store from 'electron-store'
import { BaseProvider } from './BaseProvider'
import { credentialStore } from '../../security/keychain'
import type {
  OAuthTokens,
  ProviderFolder,
  SyncResult,
  RawMessage,
  RawAttachment,
  AddressObject,
  Draft,
  PushConfig,
  FolderType,
  RemoteMessageRef,
} from '@shared/types/provider'
import type { ProviderKind } from '@shared/constants/providers'

// ── Constants ──────────────────────────────────────────────────────────────

const GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.compose',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
]

const SYSTEM_FOLDER_LABELS = new Set(['INBOX', 'SENT', 'DRAFTS', 'TRASH', 'SPAM', 'ALLMAIL'])

// These system labels are markers, not folders — exclude from folder list
const NON_FOLDER_LABELS = new Set([
  'UNREAD', 'STARRED', 'IMPORTANT', 'CHAT',
  'CATEGORY_PERSONAL', 'CATEGORY_SOCIAL', 'CATEGORY_PROMOTIONS',
  'CATEGORY_UPDATES', 'CATEGORY_FORUMS',
])

function mapLabelType(labelId: string): FolderType {
  const map: Record<string, FolderType> = {
    INBOX: 'inbox',
    SENT: 'sent',
    DRAFTS: 'drafts',
    TRASH: 'trash',
    SPAM: 'spam',
    ALLMAIL: 'archive',
  }
  return map[labelId] ?? 'custom'
}

// ── Settings store for OAuth credentials ──────────────────────────────────

const appStore = new Store<{ gmailClientId?: string; gmailClientSecret?: string }>({
  name: 'settings',
})

export function getGmailOAuthCredentials(): { clientId: string; clientSecret: string } {
  const clientId =
    (appStore.get('gmailClientId') as string | undefined) ||
    process.env.GMAIL_CLIENT_ID ||
    ''
  const clientSecret =
    (appStore.get('gmailClientSecret') as string | undefined) ||
    process.env.GMAIL_CLIENT_SECRET ||
    ''
  if (!clientId || !clientSecret) {
    throw new Error(
      'Gmail OAuth credentials not configured.\n' +
        'Set GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET as environment variables, ' +
        'or configure them in Settings → Accounts → Gmail credentials.'
    )
  }
  return { clientId, clientSecret }
}

// ── OAuth loopback helpers ─────────────────────────────────────────────────

async function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.listen(0, '127.0.0.1', () => {
      const port = (srv.address() as net.AddressInfo).port
      srv.close(() => resolve(port))
    })
    srv.on('error', reject)
  })
}

async function waitForOAuthCode(port: number, timeoutMs = 300_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const srv = http.createServer((req, res) => {
      const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`)
      const code = url.searchParams.get('code')
      const error = url.searchParams.get('error')

      const ok = !!code
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(
        `<html><head><meta charset="utf-8"></head><body style="font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">` +
          `<div style="text-align:center"><h2 style="font-size:20px">${ok ? '✅' : '❌'} ${ok ? 'Authorization complete' : 'Authorization failed'}</h2>` +
          `<p style="color:#666">${ok ? 'You can close this tab and return to Universal Email Hub.' : error ?? 'Unknown error'}</p>` +
          `<script>setTimeout(()=>window.close(),1500)</script></div></body></html>`
      )

      srv.close()
      if (error) reject(new Error(`OAuth denied: ${error}`))
      else if (code) resolve(code)
      else reject(new Error('No authorization code received'))
    })

    const timer = setTimeout(() => {
      srv.close()
      reject(new Error('Authorization timed out (5 minutes). Please try again.'))
    }, timeoutMs)

    srv.listen(port, '127.0.0.1')
    srv.on('error', (e) => { clearTimeout(timer); reject(e) })
    srv.on('close', () => clearTimeout(timer))
  })
}

// ── Address parsing ────────────────────────────────────────────────────────

function parseAddress(str: string): AddressObject {
  const s = str.trim()
  const m = s.match(/^"?([^"<>]*?)"?\s*<([^>]+)>$/)
  if (m) {
    const name = m[1].trim()
    return name ? { name, address: m[2].trim() } : { address: m[2].trim() }
  }
  return { address: s }
}

function parseAddressList(str: string | undefined): AddressObject[] {
  if (!str) return []
  const parts: string[] = []
  let depth = 0, inQuote = false, start = 0
  for (let i = 0; i < str.length; i++) {
    const c = str[i]
    if (c === '"') inQuote = !inQuote
    else if (!inQuote && c === '<') depth++
    else if (!inQuote && c === '>') depth--
    else if (!inQuote && depth === 0 && c === ',') {
      parts.push(str.slice(start, i).trim())
      start = i + 1
    }
  }
  parts.push(str.slice(start).trim())
  return parts.filter(Boolean).map(parseAddress)
}

// ── MIME body extraction ───────────────────────────────────────────────────

function decodeBase64Url(data: string): string {
  return Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8')
}

function decodeBase64UrlBuffer(data: string): Buffer {
  return Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
}

interface ExtractedBody {
  html: string
  text: string
  attachments: RawAttachment[]
}

function extractBodyParts(
  part: gmail_v1.Schema$MessagePart,
  messageId: string,
  result: ExtractedBody
): void {
  const mimeType = part.mimeType ?? ''
  const headers = part.headers ?? []

  const header = (name: string): string =>
    headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? ''

  if (mimeType === 'text/plain' && !part.filename && part.body?.data) {
    if (!result.text) result.text = decodeBase64Url(part.body.data)
  } else if (mimeType === 'text/html' && !part.filename && part.body?.data) {
    if (!result.html) result.html = decodeBase64Url(part.body.data)
  } else if (mimeType.startsWith('multipart/')) {
    for (const child of part.parts ?? []) {
      extractBodyParts(child, messageId, result)
    }
  } else if (part.filename && part.filename.length > 0) {
    const attachmentId = part.body?.attachmentId ?? ''
    const contentId = header('Content-ID').replace(/^<|>$/g, '') || undefined
    const isInline =
      header('Content-Disposition').toLowerCase().startsWith('inline') && !!contentId

    result.attachments.push({
      filename: part.filename,
      mimeType: mimeType || 'application/octet-stream',
      size: part.body?.size ?? 0,
      remoteRef: `${messageId}:${attachmentId}`,
      contentId,
      isInline,
    })
  }
}

// ── RFC 2822 message builder ───────────────────────────────────────────────

function fmtAddr(a: AddressObject): string {
  return a.name ? `"${a.name.replace(/"/g, '\\"')}" <${a.address}>` : a.address
}

function stripTags(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function buildRfc2822(draft: Draft): string {
  const boundary = `----=_Part_${Date.now()}_${Math.random().toString(36).slice(2)}`
  const lines: string[] = []

  lines.push(`To: ${draft.to.map(fmtAddr).join(', ')}`)
  if (draft.cc?.length) lines.push(`Cc: ${draft.cc.map(fmtAddr).join(', ')}`)
  if (draft.bcc?.length) lines.push(`Bcc: ${draft.bcc.map(fmtAddr).join(', ')}`)
  lines.push(`Subject: ${draft.subject}`)
  lines.push('MIME-Version: 1.0')
  if (draft.inReplyToRemoteId) {
    lines.push(`In-Reply-To: <${draft.inReplyToRemoteId}>`)
    lines.push(`References: <${draft.inReplyToRemoteId}>`)
  }
  lines.push(`Content-Type: multipart/alternative; boundary="${boundary}"`)
  lines.push('')
  lines.push(`--${boundary}`)
  lines.push('Content-Type: text/plain; charset=UTF-8')
  lines.push('Content-Transfer-Encoding: base64')
  lines.push('')
  lines.push(Buffer.from(draft.bodyText ?? stripTags(draft.bodyHtml)).toString('base64'))
  lines.push(`--${boundary}`)
  lines.push('Content-Type: text/html; charset=UTF-8')
  lines.push('Content-Transfer-Encoding: base64')
  lines.push('')
  lines.push(Buffer.from(draft.bodyHtml).toString('base64'))
  lines.push(`--${boundary}--`)

  return lines.join('\r\n')
}

// ── GmailProvider ─────────────────────────────────────────────────────────

export interface GmailUserProfile {
  email: string
  name: string
  picture?: string
}

export class GmailProvider extends BaseProvider {
  readonly kind: ProviderKind = 'gmail'
  readonly accountId: string

  constructor(accountId: string) {
    super()
    this.accountId = accountId
  }

  // ── OAuth client helpers ────────────────────────────────────────────────

  private makeClient(redirectUri?: string): OAuth2Client {
    const { clientId, clientSecret } = getGmailOAuthCredentials()
    return new google.auth.OAuth2(clientId, clientSecret, redirectUri) as OAuth2Client
  }

  private storeTokens(tokens: OAuthTokens): void {
    credentialStore.set(`account:${this.accountId}:tokens`, JSON.stringify(tokens))
  }

  private loadTokens(): OAuthTokens | null {
    const raw = credentialStore.get(`account:${this.accountId}:tokens`)
    if (!raw) return null
    try { return JSON.parse(raw) as OAuthTokens } catch { return null }
  }

  private async getClient(): Promise<OAuth2Client> {
    let tokens = this.loadTokens()
    if (!tokens) throw new Error('Not authenticated. Please re-connect this account.')

    if (tokens.expiresAt - Date.now() < 5 * 60_000) {
      tokens = await this.refreshTokens(tokens)
    }

    const client = this.makeClient()
    client.setCredentials({
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
      expiry_date: tokens.expiresAt,
      token_type: tokens.tokenType,
    })
    return client
  }

  // ── IEmailProvider: Auth ────────────────────────────────────────────────

  async authenticate(): Promise<OAuthTokens> {
    const port = await findFreePort()
    const redirectUri = `http://127.0.0.1:${port}`
    const client = this.makeClient(redirectUri)

    const authUrl = client.generateAuthUrl({
      access_type: 'offline',
      scope: GMAIL_SCOPES,
      prompt: 'consent select_account',
      redirect_uri: redirectUri,
    })

    await shell.openExternal(authUrl)
    const code = await waitForOAuthCode(port)

    const { tokens } = await client.getToken({ code, redirect_uri: redirectUri })

    const oauthTokens: OAuthTokens = {
      accessToken: tokens.access_token!,
      refreshToken: tokens.refresh_token!,
      expiresAt: tokens.expiry_date ?? Date.now() + 3_600_000,
      scope: tokens.scope ?? GMAIL_SCOPES.join(' '),
      tokenType: tokens.token_type ?? 'Bearer',
    }
    this.storeTokens(oauthTokens)
    return oauthTokens
  }

  async getUserProfile(): Promise<GmailUserProfile> {
    const client = await this.getClient()
    const oauth2 = google.oauth2({ version: 'v2', auth: client })
    const res = await oauth2.userinfo.get()
    return {
      email: res.data.email!,
      name: res.data.name ?? res.data.email!,
      picture: res.data.picture ?? undefined,
    }
  }

  async refreshTokens(current: OAuthTokens): Promise<OAuthTokens> {
    const client = this.makeClient()
    client.setCredentials({ refresh_token: current.refreshToken })
    const { credentials } = await client.refreshAccessToken()
    const refreshed: OAuthTokens = {
      accessToken: credentials.access_token!,
      refreshToken: credentials.refresh_token ?? current.refreshToken,
      expiresAt: credentials.expiry_date ?? Date.now() + 3_600_000,
      scope: credentials.scope ?? current.scope,
      tokenType: credentials.token_type ?? current.tokenType,
    }
    this.storeTokens(refreshed)
    return refreshed
  }

  async revokeAccess(): Promise<void> {
    const tokens = this.loadTokens()
    if (tokens) {
      const client = this.makeClient()
      client.setCredentials({ access_token: tokens.accessToken })
      await client.revokeCredentials().catch(() => {})
    }
    credentialStore.delete(`account:${this.accountId}:tokens`)
  }

  async testConnection(): Promise<{ success: boolean; error?: string }> {
    try {
      const client = await this.getClient()
      const gmail = google.gmail({ version: 'v1', auth: client })
      await gmail.users.getProfile({ userId: 'me' })
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  }

  // ── IEmailProvider: Folders ─────────────────────────────────────────────

  async listFolders(): Promise<ProviderFolder[]> {
    const client = await this.getClient()
    const gmail = google.gmail({ version: 'v1', auth: client })
    const res = await gmail.users.labels.list({ userId: 'me' })

    return (res.data.labels ?? [])
      .filter((l) => {
        if (!l.id || !l.name) return false
        if (NON_FOLDER_LABELS.has(l.id)) return false
        // Keep system folder labels and all user labels
        if (l.type === 'system' && !SYSTEM_FOLDER_LABELS.has(l.id)) return false
        return true
      })
      .map((l) => ({
        remoteId: l.id!,
        name: l.name!,
        type: mapLabelType(l.id!),
        totalCount: l.messagesTotal ?? 0,
        unreadCount: l.messagesUnread ?? 0,
      }))
  }

  async getFolder(remoteId: string): Promise<ProviderFolder> {
    const client = await this.getClient()
    const gmail = google.gmail({ version: 'v1', auth: client })
    const res = await gmail.users.labels.get({ userId: 'me', id: remoteId })
    return {
      remoteId: res.data.id!,
      name: res.data.name!,
      type: mapLabelType(res.data.id!),
      totalCount: res.data.messagesTotal ?? 0,
      unreadCount: res.data.messagesUnread ?? 0,
    }
  }

  // ── IEmailProvider: Sync ────────────────────────────────────────────────

  async syncFolder(folderId: string, cursor: string | null): Promise<SyncResult> {
    const client = await this.getClient()
    const gmail = google.gmail({ version: 'v1', auth: client })

    if (cursor) {
      try {
        return await this.syncIncremental(gmail, folderId, cursor)
      } catch (err: unknown) {
        const code =
          (err as { code?: number })?.code ??
          (err as { status?: number })?.status
        // 404/410 = historyId expired (~7 days); fall back to full sync
        if (code === 404 || code === 410) {
          return await this.syncFull(gmail, folderId)
        }
        throw err
      }
    }

    return await this.syncFull(gmail, folderId)
  }

  private async syncFull(gmail: gmail_v1.Gmail, folderId: string): Promise<SyncResult> {
    // Snapshot historyId before fetching so incremental sync can resume from here
    const profileRes = await gmail.users.getProfile({ userId: 'me' })
    const nextCursor = profileRes.data.historyId ?? null

    const messages: RawMessage[] = []
    let pageToken: string | undefined

    do {
      const listRes = await gmail.users.messages.list({
        userId: 'me',
        labelIds: [folderId],
        maxResults: 100,
        pageToken,
      })

      const ids = (listRes.data.messages ?? []).map((m) => m.id!)
      const batch = await this.batchFetch(gmail, ids, folderId)
      messages.push(...batch)

      pageToken = listRes.data.nextPageToken ?? undefined
    } while (pageToken && messages.length < 500)

    return { messages, deletedRemoteIds: [], nextCursor, hasMore: !!pageToken }
  }

  private async syncIncremental(
    gmail: gmail_v1.Gmail,
    folderId: string,
    cursor: string
  ): Promise<SyncResult> {
    const addedIds = new Set<string>()
    const deletedIds: string[] = []
    let pageToken: string | undefined
    let nextCursor = cursor

    do {
      const histRes = await gmail.users.history.list({
        userId: 'me',
        startHistoryId: cursor,
        labelId: folderId,
        maxResults: 500,
        pageToken,
      })

      nextCursor = histRes.data.historyId ?? cursor

      for (const rec of histRes.data.history ?? []) {
        for (const a of rec.messagesAdded ?? []) {
          if (a.message?.id) addedIds.add(a.message.id)
        }
        for (const d of rec.messagesDeleted ?? []) {
          if (d.message?.id) { deletedIds.push(d.message.id); addedIds.delete(d.message.id) }
        }
        for (const lr of rec.labelsRemoved ?? []) {
          if ((lr.labelIds ?? []).includes(folderId) && lr.message?.id) {
            deletedIds.push(lr.message.id); addedIds.delete(lr.message.id)
          }
        }
        for (const la of rec.labelsAdded ?? []) {
          if ((la.labelIds ?? []).includes(folderId) && la.message?.id) {
            addedIds.add(la.message.id)
          }
        }
      }

      pageToken = histRes.data.nextPageToken ?? undefined
    } while (pageToken)

    const messages = await this.batchFetch(gmail, [...addedIds], folderId)
    return { messages, deletedRemoteIds: deletedIds, nextCursor, hasMore: false }
  }

  private async batchFetch(
    gmail: gmail_v1.Gmail,
    ids: string[],
    defaultFolderId: string
  ): Promise<RawMessage[]> {
    const CONCURRENCY = 5
    const results: RawMessage[] = []

    for (let i = 0; i < ids.length; i += CONCURRENCY) {
      const slice = ids.slice(i, i + CONCURRENCY)
      const fetched = await Promise.all(
        slice.map((id) => this.fetchById(gmail, id, defaultFolderId).catch(() => null))
      )
      results.push(...(fetched.filter(Boolean) as RawMessage[]))
      if (i + CONCURRENCY < ids.length) await this.sleep(100)
    }

    return results
  }

  private async fetchById(
    gmail: gmail_v1.Gmail,
    id: string,
    defaultFolderId: string
  ): Promise<RawMessage> {
    const res = await gmail.users.messages.get({ userId: 'me', id, format: 'full' })
    return this.parseMessage(res.data, defaultFolderId)
  }

  async fetchMessage(remoteId: string): Promise<RawMessage> {
    const client = await this.getClient()
    const gmail = google.gmail({ version: 'v1', auth: client })
    const res = await gmail.users.messages.get({ userId: 'me', id: remoteId, format: 'full' })
    return this.parseMessage(res.data, 'INBOX')
  }

  private parseMessage(msg: gmail_v1.Schema$Message, defaultFolderId: string): RawMessage {
    const payload = msg.payload ?? {}
    const rawHeaders = payload.headers ?? []
    const hdr = (name: string) =>
      rawHeaders.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? ''

    const body: ExtractedBody = { html: '', text: '', attachments: [] }
    if (payload.mimeType) {
      extractBodyParts(payload, msg.id!, body)
    } else if (payload.body?.data) {
      body.text = decodeBase64Url(payload.body.data)
    }

    const labels = msg.labelIds ?? []
    const folderId = labels.find((l) => SYSTEM_FOLDER_LABELS.has(l)) ?? defaultFolderId
    const dateStr = hdr('Date')
    const date = dateStr ? new Date(dateStr) : new Date(Number(msg.internalDate))

    return {
      remoteId: msg.id!,
      threadRemoteId: msg.threadId!,
      folderId,
      from: parseAddress(hdr('From')),
      to: parseAddressList(hdr('To')),
      cc: parseAddressList(hdr('Cc')),
      bcc: parseAddressList(hdr('Bcc')),
      replyTo: parseAddressList(hdr('Reply-To')),
      subject: hdr('Subject') || '(No Subject)',
      bodyHtml: body.html,
      bodyText: body.text,
      date,
      isRead: !labels.includes('UNREAD'),
      isStarred: labels.includes('STARRED'),
      isDraft: labels.includes('DRAFT'),
      labels,
      attachments: body.attachments,
      headers: Object.fromEntries(rawHeaders.map((h) => [h.name ?? '', h.value ?? ''])),
      sizeBytes: msg.sizeEstimate ?? 0,
      inReplyTo: hdr('In-Reply-To').replace(/^<|>$/g, '') || undefined,
      references: hdr('References').split(/\s+/).map((r) => r.replace(/^<|>$/g, '')).filter(Boolean),
    }
  }

  async fetchAttachment(remoteRef: string): Promise<Buffer> {
    const sep = remoteRef.lastIndexOf(':')
    const messageId = remoteRef.slice(0, sep)
    const attachmentId = remoteRef.slice(sep + 1)

    const client = await this.getClient()
    const gmail = google.gmail({ version: 'v1', auth: client })
    const res = await gmail.users.messages.attachments.get({
      userId: 'me',
      messageId,
      id: attachmentId,
    })
    return decodeBase64UrlBuffer(res.data.data!)
  }

  // ── IEmailProvider: Mutations ───────────────────────────────────────────

  async sendMessage(draft: Draft): Promise<{ remoteId: string }> {
    const client = await this.getClient()
    const gmail = google.gmail({ version: 'v1', auth: client })
    const raw = Buffer.from(buildRfc2822(draft)).toString('base64url')
    const res = await gmail.users.messages.send({
      userId: 'me',
      requestBody: {
        raw,
        ...(draft.threadRemoteId ? { threadId: draft.threadRemoteId } : {}),
      },
    })
    return { remoteId: res.data.id! }
  }

  async createDraft(draft: Draft): Promise<{ remoteId: string }> {
    const client = await this.getClient()
    const gmail = google.gmail({ version: 'v1', auth: client })
    const raw = Buffer.from(buildRfc2822(draft)).toString('base64url')
    const res = await gmail.users.drafts.create({
      userId: 'me',
      requestBody: {
        message: {
          raw,
          ...(draft.threadRemoteId ? { threadId: draft.threadRemoteId } : {}),
        },
      },
    })
    return { remoteId: res.data.id! }
  }

  async updateDraft(remoteId: string, draft: Draft): Promise<void> {
    const client = await this.getClient()
    const gmail = google.gmail({ version: 'v1', auth: client })
    const raw = Buffer.from(buildRfc2822(draft)).toString('base64url')
    await gmail.users.drafts.update({
      userId: 'me',
      id: remoteId,
      requestBody: { message: { raw } },
    })
  }

  async deleteDraft(remoteId: string): Promise<void> {
    const client = await this.getClient()
    const gmail = google.gmail({ version: 'v1', auth: client })
    await gmail.users.drafts.delete({ userId: 'me', id: remoteId })
  }

  async markRead(refs: RemoteMessageRef[], read: boolean): Promise<void> {
    const client = await this.getClient()
    const gmail = google.gmail({ version: 'v1', auth: client })
    await Promise.all(
      refs.map(({ remoteId: id }) =>
        gmail.users.messages.modify({
          userId: 'me',
          id,
          requestBody: {
            addLabelIds: read ? [] : ['UNREAD'],
            removeLabelIds: read ? ['UNREAD'] : [],
          },
        })
      )
    )
  }

  async star(refs: RemoteMessageRef[], starred: boolean): Promise<void> {
    const client = await this.getClient()
    const gmail = google.gmail({ version: 'v1', auth: client })
    await Promise.all(
      refs.map(({ remoteId: id }) =>
        gmail.users.messages.modify({
          userId: 'me',
          id,
          requestBody: {
            addLabelIds: starred ? ['STARRED'] : [],
            removeLabelIds: starred ? [] : ['STARRED'],
          },
        })
      )
    )
  }

  async moveMessages(refs: RemoteMessageRef[], targetFolderRemoteId: string): Promise<void> {
    const client = await this.getClient()
    const gmail = google.gmail({ version: 'v1', auth: client })
    await Promise.all(
      refs.map(({ remoteId: id }) =>
        gmail.users.messages.modify({
          userId: 'me',
          id,
          requestBody: {
            addLabelIds: [targetFolderRemoteId],
            removeLabelIds: [...SYSTEM_FOLDER_LABELS].filter((l) => l !== targetFolderRemoteId),
          },
        })
      )
    )
  }

  async deleteMessages(refs: RemoteMessageRef[]): Promise<void> {
    const client = await this.getClient()
    const gmail = google.gmail({ version: 'v1', auth: client })
    await Promise.all(refs.map(({ remoteId: id }) => gmail.users.messages.trash({ userId: 'me', id })))
  }

  async addLabels(refs: RemoteMessageRef[], labels: string[]): Promise<void> {
    const client = await this.getClient()
    const gmail = google.gmail({ version: 'v1', auth: client })
    await Promise.all(
      refs.map(({ remoteId: id }) =>
        gmail.users.messages.modify({ userId: 'me', id, requestBody: { addLabelIds: labels } })
      )
    )
  }

  async removeLabels(refs: RemoteMessageRef[], labels: string[]): Promise<void> {
    const client = await this.getClient()
    const gmail = google.gmail({ version: 'v1', auth: client })
    await Promise.all(
      refs.map(({ remoteId: id }) =>
        gmail.users.messages.modify({ userId: 'me', id, requestBody: { removeLabelIds: labels } })
      )
    )
  }

  // ── IEmailProvider: Remote search ───────────────────────────────────────

  async searchRemote(query: string): Promise<RawMessage[]> {
    const client = await this.getClient()
    const gmail = google.gmail({ version: 'v1', auth: client })
    const listRes = await gmail.users.messages.list({ userId: 'me', q: query, maxResults: 50 })
    const ids = (listRes.data.messages ?? []).map((m) => m.id!)
    return await this.batchFetch(gmail, ids, 'INBOX')
  }

  // ── IEmailProvider: Push ────────────────────────────────────────────────

  async setupPush(): Promise<PushConfig> {
    // Gmail push requires Cloud Pub/Sub — not viable for desktop app without a server.
    // Polling mode is used instead; SyncWorker drives the interval.
    return { type: 'polling' }
  }

  async teardownPush(): Promise<void> {}

  async handlePushEvent(): Promise<SyncResult> {
    return { messages: [], deletedRemoteIds: [], nextCursor: null, hasMore: false }
  }
}
