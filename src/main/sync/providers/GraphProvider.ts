import * as net from 'net'
import * as http from 'http'
import { shell } from 'electron'
import { credentialStore } from '../../security/keychain'
import { getSetting } from '../../settings'
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
  RemoteMessageRef,
} from '@shared/types/provider'
import type { ProviderKind } from '@shared/constants/providers'

// ── Credential helpers ────────────────────────────────────────────────────

function tokenKey(accountId: string) {
  return `account:${accountId}:tokens`
}

function getGraphCredentials(): { clientId: string } {
  const clientId =
    (getSetting('graphClientId') as string) || process.env['GRAPH_CLIENT_ID'] || ''
  if (!clientId) {
    throw new Error(
      'Microsoft Client ID not configured. ' +
        'Go to Settings → OAuth Credentials, paste your Azure app Client ID, and save.'
    )
  }
  return { clientId }
}

// ── OAuth loopback helpers ────────────────────────────────────────────────

function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address()
      srv.close(() => {
        if (addr && typeof addr === 'object') resolve(addr.port)
        else reject(new Error('Could not determine free port'))
      })
    })
    srv.on('error', reject)
  })
}

function waitForOAuthCode(port: number, timeoutMs = 300_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      server.close()
      reject(new Error('OAuth timed out after 5 minutes'))
    }, timeoutMs)

    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? '/', `http://localhost:${port}`)
      const code = url.searchParams.get('code')
      const errorParam = url.searchParams.get('error')
      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end('<html><body><h2>Authorization complete. You can close this tab.</h2></body></html>')
      server.close()
      clearTimeout(timer)
      if (code) resolve(code)
      else reject(new Error(errorParam ?? 'No authorization code received'))
    })
    server.listen(port, '127.0.0.1')
    server.on('error', (err) => { clearTimeout(timer); reject(err) })
  })
}

// ── Graph REST helpers ────────────────────────────────────────────────────

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0'
const TOKEN_URL = 'https://login.microsoftonline.com/consumers/oauth2/v2.0/token'

async function graphGet(urlOrPath: string, accessToken: string): Promise<unknown> {
  const url = urlOrPath.startsWith('http') ? urlOrPath : `${GRAPH_BASE}${urlOrPath}`
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    const err = Object.assign(new Error(`Graph GET ${res.status}: ${text}`), { status: res.status })
    throw err
  }
  return res.json()
}

async function graphPost(path: string, accessToken: string, body: unknown): Promise<unknown> {
  const res = await fetch(`${GRAPH_BASE}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Graph POST ${res.status}: ${text}`)
  }
  if (res.status === 204) return null
  return res.headers.get('content-type')?.includes('json') ? res.json() : null
}

async function graphPatch(path: string, accessToken: string, body: unknown): Promise<void> {
  const res = await fetch(`${GRAPH_BASE}${path}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Graph PATCH ${res.status}: ${text}`)
  }
}

async function graphDelete(path: string, accessToken: string): Promise<void> {
  const res = await fetch(`${GRAPH_BASE}${path}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok && res.status !== 404) {
    const text = await res.text().catch(() => '')
    throw new Error(`Graph DELETE ${res.status}: ${text}`)
  }
}

// ── Graph types ───────────────────────────────────────────────────────────

interface GraphEmailAddress { name?: string; address: string }
interface GraphRecipient { emailAddress: GraphEmailAddress }
interface GraphAttachment {
  id: string; name?: string; contentType?: string
  size?: number; isInline?: boolean; contentId?: string; contentBytes?: string
}
interface GraphMessage {
  id: string
  subject?: string
  bodyPreview?: string
  from?: GraphRecipient
  toRecipients?: GraphRecipient[]
  ccRecipients?: GraphRecipient[]
  bccRecipients?: GraphRecipient[]
  replyTo?: GraphRecipient[]
  body?: { contentType: string; content: string }
  receivedDateTime?: string
  isRead?: boolean
  flag?: { flagStatus: string }
  hasAttachments?: boolean
  isDraft?: boolean
  conversationId?: string
  categories?: string[]
  internetMessageHeaders?: { name: string; value: string }[]
  attachments?: GraphAttachment[]
  '@removed'?: { reason: string }
}
interface GraphFolder {
  id: string; displayName: string
  totalItemCount?: number; unreadItemCount?: number
}

const MSG_SELECT = [
  'id', 'subject', 'bodyPreview', 'from', 'toRecipients', 'ccRecipients', 'bccRecipients',
  'replyTo', 'body', 'receivedDateTime', 'isRead', 'flag', 'hasAttachments', 'isDraft',
  'conversationId', 'categories', 'internetMessageHeaders',
].join(',')

const ATT_EXPAND =
  '$expand=attachments($select=id,name,contentType,size,isInline,contentId)'

// ── Folder / message parsers ──────────────────────────────────────────────

function mapFolderType(displayName: string, id: string): FolderType {
  const n = displayName.toLowerCase()
  const i = id.toLowerCase()
  if (n === 'inbox' || i === 'inbox') return 'inbox'
  if (n === 'sent items' || n === 'sent' || i === 'sentitems') return 'sent'
  if (n === 'drafts' || i === 'drafts') return 'drafts'
  if (n === 'deleted items' || i === 'deleteditems') return 'trash'
  if (n === 'junk email' || i === 'junkemail') return 'spam'
  if (n === 'archive' || i === 'archive') return 'archive'
  return 'custom'
}

function toAddr(r: GraphRecipient | undefined): AddressObject {
  return { address: r?.emailAddress.address ?? 'unknown@unknown.com', name: r?.emailAddress.name }
}

function parseGraphMessage(msg: GraphMessage, folderId: string): RawMessage | null {
  if (!msg.id || msg['@removed']) return null

  const hdrs: Record<string, string> = {}
  for (const h of msg.internetMessageHeaders ?? []) hdrs[h.name.toLowerCase()] = h.value

  const attachments: RawAttachment[] = (msg.attachments ?? []).map((a) => ({
    filename: a.name ?? 'attachment',
    mimeType: a.contentType ?? 'application/octet-stream',
    size: a.size ?? 0,
    remoteRef: `${msg.id}:${a.id}`,
    contentId: a.contentId,
    isInline: a.isInline ?? false,
  }))

  const isHtml = (msg.body?.contentType ?? '').toLowerCase() === 'html'

  return {
    remoteId: msg.id,
    threadRemoteId: msg.conversationId ?? msg.id,
    folderId,
    from: toAddr(msg.from),
    to: (msg.toRecipients ?? []).map(toAddr),
    cc: (msg.ccRecipients ?? []).map(toAddr),
    bcc: (msg.bccRecipients ?? []).map(toAddr),
    replyTo: (msg.replyTo ?? []).map(toAddr),
    subject: msg.subject ?? '(No Subject)',
    bodyHtml: isHtml ? (msg.body?.content ?? '') : '',
    bodyText: isHtml ? (msg.bodyPreview ?? '') : (msg.body?.content ?? msg.bodyPreview ?? ''),
    date: msg.receivedDateTime ? new Date(msg.receivedDateTime) : new Date(),
    isRead: msg.isRead ?? false,
    isStarred: msg.flag?.flagStatus === 'flagged',
    isDraft: msg.isDraft ?? false,
    labels: msg.categories ?? [],
    attachments,
    headers: hdrs,
    sizeBytes: 0,
    inReplyTo: hdrs['in-reply-to']?.replace(/^<|>$/g, ''),
    references: (hdrs['references'] ?? '')
      .split(/\s+/)
      .filter(Boolean)
      .map((r) => r.replace(/^<|>$/g, '')),
  }
}

function buildGraphMessage(draft: Draft): object {
  return {
    subject: draft.subject,
    body: {
      contentType: draft.bodyHtml ? 'HTML' : 'Text',
      content: draft.bodyHtml || draft.bodyText || '',
    },
    toRecipients: draft.to.map((a) => ({ emailAddress: { name: a.name ?? '', address: a.address } })),
    ccRecipients: (draft.cc ?? []).map((a) => ({ emailAddress: { name: a.name ?? '', address: a.address } })),
    bccRecipients: (draft.bcc ?? []).map((a) => ({ emailAddress: { name: a.name ?? '', address: a.address } })),
  }
}

// ── GraphProvider ─────────────────────────────────────────────────────────

export interface GraphUserProfile { email: string; name: string }

export class GraphProvider extends BaseProvider {
  readonly kind: ProviderKind = 'graph'
  readonly accountId: string
  private _tokens: OAuthTokens | null = null

  constructor(accountId: string) {
    super()
    this.accountId = accountId
    const raw = credentialStore.get(tokenKey(accountId))
    if (raw) this._tokens = JSON.parse(raw) as OAuthTokens
  }

  private storeTokens(t: OAuthTokens): void {
    this._tokens = t
    credentialStore.set(tokenKey(this.accountId), JSON.stringify(t))
  }

  private async validTokens(): Promise<OAuthTokens> {
    if (!this._tokens) throw new Error('Not authenticated')
    if (Date.now() > this._tokens.expiresAt - 5 * 60_000) {
      return this.refreshTokens(this._tokens)
    }
    return this._tokens
  }

  // ── Auth ──────────────────────────────────────────────────────────────

  async authenticate(): Promise<OAuthTokens> {
    const { clientId } = getGraphCredentials()
    const port = await findFreePort()
    const redirectUri = `http://localhost:${port}`
    const scopes = [
      'https://graph.microsoft.com/Mail.ReadWrite',
      'https://graph.microsoft.com/Mail.Send',
      'https://graph.microsoft.com/User.Read',
      'offline_access',
    ].join(' ')

    // /consumers endpoint targets personal Microsoft accounts only
    const authUrl = `https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize?` +
      new URLSearchParams({ client_id: clientId, response_type: 'code',
        redirect_uri: redirectUri, scope: scopes, prompt: 'select_account' }).toString()

    await shell.openExternal(authUrl)
    const code = await waitForOAuthCode(port)

    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      // Public client — no client_secret needed, PKCE-style exchange
      body: new URLSearchParams({ client_id: clientId,
        code, redirect_uri: redirectUri, grant_type: 'authorization_code' }).toString(),
    })
    if (!res.ok) throw new Error(`Token exchange failed: ${await res.text()}`)
    const data = await res.json() as {
      access_token: string; refresh_token: string; expires_in: number; token_type?: string; scope?: string
    }
    const tokens: OAuthTokens = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: Date.now() + data.expires_in * 1000,
      tokenType: data.token_type ?? 'Bearer',
      scope: data.scope ?? '',
    }
    this.storeTokens(tokens)
    return tokens
  }

  async refreshTokens(current: OAuthTokens): Promise<OAuthTokens> {
    const { clientId } = getGraphCredentials()
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: clientId,
        refresh_token: current.refreshToken, grant_type: 'refresh_token' }).toString(),
    })
    if (!res.ok) throw new Error(`Token refresh failed: ${await res.text()}`)
    const data = await res.json() as {
      access_token: string; refresh_token?: string; expires_in: number; token_type?: string; scope?: string
    }
    const tokens: OAuthTokens = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? current.refreshToken,
      expiresAt: Date.now() + data.expires_in * 1000,
      tokenType: data.token_type ?? current.tokenType ?? 'Bearer',
      scope: data.scope ?? current.scope ?? '',
    }
    this.storeTokens(tokens)
    return tokens
  }

  async getUserProfile(): Promise<GraphUserProfile> {
    const { accessToken } = await this.validTokens()
    const data = await graphGet('/me?$select=mail,displayName,userPrincipalName', accessToken) as {
      mail?: string; displayName?: string; userPrincipalName?: string
    }
    return { email: data.mail ?? data.userPrincipalName ?? '', name: data.displayName ?? '' }
  }

  async revokeAccess(): Promise<void> {
    credentialStore.delete(tokenKey(this.accountId))
    this._tokens = null
  }

  async testConnection(): Promise<{ success: boolean; error?: string }> {
    try { await this.validTokens(); return { success: true } }
    catch (err) { return { success: false, error: String(err) } }
  }

  // ── Folders ───────────────────────────────────────────────────────────

  async listFolders(): Promise<ProviderFolder[]> {
    const { accessToken } = await this.validTokens()
    const data = await graphGet(
      '/me/mailFolders?$select=id,displayName,totalItemCount,unreadItemCount&$top=100',
      accessToken
    ) as { value: GraphFolder[] }
    return data.value.map((f) => ({
      remoteId: f.id,
      name: f.displayName,
      type: mapFolderType(f.displayName, f.id),
      totalCount: f.totalItemCount ?? 0,
      unreadCount: f.unreadItemCount ?? 0,
    }))
  }

  async getFolder(remoteId: string): Promise<ProviderFolder> {
    const { accessToken } = await this.validTokens()
    const f = await graphGet(
      `/me/mailFolders/${remoteId}?$select=id,displayName,totalItemCount,unreadItemCount`,
      accessToken
    ) as GraphFolder
    return {
      remoteId: f.id, name: f.displayName,
      type: mapFolderType(f.displayName, f.id),
      totalCount: f.totalItemCount ?? 0, unreadCount: f.unreadItemCount ?? 0,
    }
  }

  // ── Sync ──────────────────────────────────────────────────────────────

  async syncFolder(folderId: string, cursor: string | null): Promise<SyncResult> {
    const { accessToken } = await this.validTokens()
    if (cursor) {
      try {
        return await this.doDelta(folderId, cursor, accessToken)
      } catch (err: unknown) {
        const s = (err as { status?: number }).status
        if (s === 410 || s === 404) return this.doFull(folderId, accessToken)
        throw err
      }
    }
    return this.doFull(folderId, accessToken)
  }

  private async doFull(folderId: string, accessToken: string): Promise<SyncResult> {
    const url =
      `/me/mailFolders/${folderId}/messages/delta` +
      `?$select=${MSG_SELECT}&${ATT_EXPAND}&$top=50&$orderby=receivedDateTime desc`
    const { messages, deltaLink } = await this.pageDelta(url, folderId, accessToken, 500)
    return { messages, deletedRemoteIds: [], nextCursor: deltaLink, hasMore: false }
  }

  private async doDelta(
    folderId: string, deltaLink: string, accessToken: string
  ): Promise<SyncResult> {
    const { messages, deletedRemoteIds, deltaLink: newLink } =
      await this.pageDelta(deltaLink, folderId, accessToken)
    return { messages, deletedRemoteIds, nextCursor: newLink ?? deltaLink, hasMore: false }
  }

  private async pageDelta(
    startUrl: string, folderId: string, accessToken: string, max = Infinity
  ): Promise<{ messages: RawMessage[]; deletedRemoteIds: string[]; deltaLink: string | null }> {
    const messages: RawMessage[] = []
    const deletedRemoteIds: string[] = []
    let next: string | null = startUrl
    let deltaLink: string | null = null

    while (next && messages.length < max) {
      const page = await graphGet(next, accessToken) as {
        value: GraphMessage[]
        '@odata.nextLink'?: string
        '@odata.deltaLink'?: string
      }
      for (const msg of page.value) {
        if (msg['@removed']) { deletedRemoteIds.push(msg.id) }
        else { const r = parseGraphMessage(msg, folderId); if (r) messages.push(r) }
      }
      deltaLink = page['@odata.deltaLink'] ?? deltaLink
      next = page['@odata.nextLink'] ?? null
    }
    return { messages, deletedRemoteIds, deltaLink }
  }

  // ── Message fetch ─────────────────────────────────────────────────────

  async fetchMessage(remoteId: string): Promise<RawMessage> {
    const { accessToken } = await this.validTokens()
    const msg = await graphGet(
      `/me/messages/${remoteId}?$select=${MSG_SELECT}&${ATT_EXPAND}`, accessToken
    ) as GraphMessage
    const raw = parseGraphMessage(msg, '')
    if (!raw) throw new Error(`Could not parse message ${remoteId}`)
    return raw
  }

  async fetchAttachment(remoteRef: string): Promise<Buffer> {
    const parts = remoteRef.split(':')
    const attachmentId = parts.pop()!
    const messageId = parts.join(':')
    const { accessToken } = await this.validTokens()
    const att = await graphGet(
      `/me/messages/${messageId}/attachments/${attachmentId}`, accessToken
    ) as { contentBytes?: string }
    if (!att.contentBytes) throw new Error('Attachment has no content')
    return Buffer.from(att.contentBytes, 'base64')
  }

  // ── Mutations ──────────────────────────────────────────────────────────

  async sendMessage(draft: Draft): Promise<{ remoteId: string }> {
    const { accessToken } = await this.validTokens()
    await graphPost('/me/sendMail', accessToken, {
      message: buildGraphMessage(draft), saveToSentItems: true,
    })
    return { remoteId: `sent-${Date.now()}` }
  }

  async createDraft(draft: Draft): Promise<{ remoteId: string }> {
    const { accessToken } = await this.validTokens()
    const result = await graphPost('/me/messages', accessToken, buildGraphMessage(draft)) as { id: string }
    return { remoteId: result.id }
  }

  async updateDraft(remoteId: string, draft: Draft): Promise<void> {
    const { accessToken } = await this.validTokens()
    await graphPatch(`/me/messages/${remoteId}`, accessToken, buildGraphMessage(draft))
  }

  async deleteDraft(remoteId: string): Promise<void> {
    const { accessToken } = await this.validTokens()
    await graphDelete(`/me/messages/${remoteId}`, accessToken)
  }

  async markRead(refs: RemoteMessageRef[], read: boolean): Promise<void> {
    const { accessToken } = await this.validTokens()
    await Promise.all(
      refs.map(({ remoteId: id }) => graphPatch(`/me/messages/${id}`, accessToken, { isRead: read }).catch(() => {}))
    )
  }

  async star(refs: RemoteMessageRef[], starred: boolean): Promise<void> {
    const { accessToken } = await this.validTokens()
    const flagStatus = starred ? 'flagged' : 'notFlagged'
    await Promise.all(
      refs.map(({ remoteId: id }) =>
        graphPatch(`/me/messages/${id}`, accessToken, { flag: { flagStatus } }).catch(() => {})
      )
    )
  }

  async moveMessages(refs: RemoteMessageRef[], targetFolderRemoteId: string): Promise<void> {
    const { accessToken } = await this.validTokens()
    await Promise.all(
      refs.map(({ remoteId: id }) =>
        graphPost(`/me/messages/${id}/move`, accessToken, { destinationId: targetFolderRemoteId }).catch(() => {})
      )
    )
  }

  async deleteMessages(refs: RemoteMessageRef[]): Promise<void> {
    const { accessToken } = await this.validTokens()
    await Promise.all(refs.map(({ remoteId: id }) => graphDelete(`/me/messages/${id}`, accessToken).catch(() => {})))
  }

  async addLabels(refs: RemoteMessageRef[], labels: string[]): Promise<void> {
    const { accessToken } = await this.validTokens()
    await Promise.all(
      refs.map(async ({ remoteId: id }) => {
        const msg = await graphGet(`/me/messages/${id}?$select=categories`, accessToken) as { categories?: string[] }
        await graphPatch(`/me/messages/${id}`, accessToken, {
          categories: [...new Set([...(msg.categories ?? []), ...labels])],
        })
      })
    )
  }

  async removeLabels(refs: RemoteMessageRef[], labels: string[]): Promise<void> {
    const { accessToken } = await this.validTokens()
    await Promise.all(
      refs.map(async ({ remoteId: id }) => {
        const msg = await graphGet(`/me/messages/${id}?$select=categories`, accessToken) as { categories?: string[] }
        await graphPatch(`/me/messages/${id}`, accessToken, {
          categories: (msg.categories ?? []).filter((c) => !labels.includes(c)),
        })
      })
    )
  }

  async searchRemote(query: string, folderId?: string): Promise<RawMessage[]> {
    const { accessToken } = await this.validTokens()
    const base = folderId ? `/me/mailFolders/${folderId}/messages` : `/me/messages`
    const data = await graphGet(
      `${base}?$search="${encodeURIComponent(query)}"&$select=${MSG_SELECT}&$top=50`, accessToken
    ) as { value: GraphMessage[] }
    return data.value.map((m) => parseGraphMessage(m, folderId ?? '')).filter(Boolean) as RawMessage[]
  }

  setupPush(): Promise<PushConfig> {
    return Promise.resolve({ type: 'polling' } as PushConfig)
  }

  teardownPush(): Promise<void> { return Promise.resolve() }

  handlePushEvent(): Promise<SyncResult> {
    return Promise.resolve({ messages: [], deletedRemoteIds: [], nextCursor: null, hasMore: false })
  }
}
