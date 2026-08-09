import type { ProviderKind } from '../constants/providers'

// ── Credentials ────────────────────────────────────────────────────────────

export interface OAuthTokens {
  accessToken: string
  refreshToken: string
  expiresAt: number
  scope: string
  tokenType: string
}

export interface BasicCredentials {
  username: string
  password: string
  host: string
  port: number
  security: 'TLS' | 'STARTTLS' | 'NONE'
  smtpHost: string
  smtpPort: number
  smtpSecurity: 'TLS' | 'STARTTLS' | 'NONE'
}

// ── Address ────────────────────────────────────────────────────────────────

export interface AddressObject {
  name?: string
  address: string
}

// ── Attachment ─────────────────────────────────────────────────────────────

export interface RawAttachment {
  filename: string
  mimeType: string
  size: number
  remoteRef: string
  contentId?: string
  isInline: boolean
}

export interface DraftAttachment {
  filename: string
  mimeType: string
  size: number
  localPath: string
  contentId?: string
}

// ── Messages ───────────────────────────────────────────────────────────────

export interface RawMessage {
  remoteId: string
  threadRemoteId: string
  folderId: string
  from: AddressObject
  to: AddressObject[]
  cc: AddressObject[]
  bcc: AddressObject[]
  replyTo?: AddressObject[]
  subject: string
  bodyHtml: string
  bodyText: string
  date: Date
  isRead: boolean
  isStarred: boolean
  isDraft: boolean
  labels: string[]
  attachments: RawAttachment[]
  headers: Record<string, string>
  sizeBytes: number
  inReplyTo?: string
  references?: string[]
}

export interface Draft {
  to: AddressObject[]
  cc?: AddressObject[]
  bcc?: AddressObject[]
  subject: string
  bodyHtml: string
  bodyText?: string
  attachments?: DraftAttachment[]
  inReplyToRemoteId?: string
  threadRemoteId?: string
  fromAccountId: string
  scheduledAt?: Date
  remoteId?: string
}

// ── Folders ────────────────────────────────────────────────────────────────

export type FolderType = 'inbox' | 'sent' | 'drafts' | 'trash' | 'spam' | 'archive' | 'custom'

export interface ProviderFolder {
  remoteId: string
  name: string
  type: FolderType
  totalCount: number
  unreadCount: number
  parentRemoteId?: string
}

// ── Sync ───────────────────────────────────────────────────────────────────

export interface SyncResult {
  messages: RawMessage[]
  deletedRemoteIds: string[]
  nextCursor: string | null
  hasMore: boolean
  updatedFolders?: ProviderFolder[]
  /**
   * Total messages the server reports for this folder (IMAP EXISTS/STATUS).
   * Lets the engine detect server-side deletions cheaply: fewer on the
   * server than local means something was deleted elsewhere.
   */
  serverMessageCount?: number
  /**
   * Read/starred state for messages we already hold. Incremental sync only
   * returns NEW messages, so without this a mail read in another client
   * would stay unread here forever. Flags-only fetches carry no bodies.
   */
  flagUpdates?: Array<{ remoteId: string; isRead: boolean; isStarred: boolean }>
}

export type PushType = 'idle' | 'webhook' | 'polling'

export interface PushConfig {
  type: PushType
  expiration?: Date
  subscriptionId?: string
}

// ── Remote message reference ────────────────────────────────────────────────
// IMAP UIDs are only unique within a mailbox, so mutations must carry the
// folder they belong to. Gmail/Graph IDs are global; those providers ignore
// folderRemoteId.

export interface RemoteMessageRef {
  remoteId: string
  folderRemoteId?: string | null
}

// ── Provider Interface ──────────────────────────────────────────────────────

export interface IEmailProvider {
  readonly kind: ProviderKind
  readonly accountId: string

  // Auth
  authenticate(): Promise<OAuthTokens | BasicCredentials>
  refreshTokens(current: OAuthTokens): Promise<OAuthTokens>
  revokeAccess(): Promise<void>
  testConnection(): Promise<{ success: boolean; error?: string }>

  // Structure
  listFolders(): Promise<ProviderFolder[]>
  getFolder(remoteId: string): Promise<ProviderFolder>

  // Sync — cursor null = full sync
  syncFolder(folderId: string, cursor: string | null): Promise<SyncResult>
  fetchMessage(remoteId: string, folderRemoteId?: string | null): Promise<RawMessage>
  fetchAttachment(remoteRef: string, folderRemoteId?: string | null): Promise<Buffer>

  // Mutations — refs carry folder context because IMAP UIDs are mailbox-scoped
  sendMessage(draft: Draft): Promise<{ remoteId: string }>
  createDraft(draft: Draft): Promise<{ remoteId: string }>
  updateDraft(remoteId: string, draft: Draft): Promise<void>
  deleteDraft(remoteId: string): Promise<void>
  markRead(refs: RemoteMessageRef[], read: boolean): Promise<void>
  star(refs: RemoteMessageRef[], starred: boolean): Promise<void>
  moveMessages(refs: RemoteMessageRef[], targetFolderRemoteId: string): Promise<void>
  deleteMessages(refs: RemoteMessageRef[]): Promise<void>
  addLabels(refs: RemoteMessageRef[], labels: string[]): Promise<void>
  removeLabels(refs: RemoteMessageRef[], labels: string[]): Promise<void>

  // Remote search fallback
  searchRemote(query: string, folderId?: string): Promise<RawMessage[]>

  // Push
  setupPush(webhookUrl?: string): Promise<PushConfig>
  teardownPush(): Promise<void>
  handlePushEvent(payload: unknown): Promise<SyncResult>
  renewPush?(subscriptionId: string): Promise<PushConfig>
}
