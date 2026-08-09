import type { ProviderKind } from '../constants/providers'
import type { BasicCredentials } from './provider'
import type {
  AccountRow,
  FolderRow,
  MessageRow,
  ThreadRow,
  AttachmentRow,
  SyncStatus,
  SearchQuery,
  SearchResult,
  AppSettings,
  VerificationCodeRow,
  AccountHealth,
} from './db'

// ── Generic IPC envelope ───────────────────────────────────────────────────

export type IpcResult<T> = { data: T; error?: never } | { data?: never; error: IpcError }

export interface IpcError {
  code: string
  message: string
  details?: unknown
}

// ── Accounts ───────────────────────────────────────────────────────────────

export interface AddAccountPayload {
  provider: ProviderKind
  credentials?: BasicCredentials
}

export interface VerifyAccountPayload {
  provider: ProviderKind
  credentials: BasicCredentials
}

export interface VerifyAccountResult {
  success: boolean
  email?: string
  error?: string
  /** Raw error string from the server for diagnosis */
  detail?: string
}

export interface UpdateAccountPayload {
  displayName?: string
  color?: string
  isActive?: boolean
  syncIntervalSeconds?: number
  order?: number
}

export interface SyncStatusChangedPayload {
  accountId: string
  status: SyncStatus
}

// ── Folders ────────────────────────────────────────────────────────────────

export interface ListFoldersPayload {
  accountId: string
}

export interface UnreadChangedPayload {
  folderId: string
  count: number
  accountId: string
}

// ── Messages ───────────────────────────────────────────────────────────────

export interface ListMessagesPayload {
  accountId?: string
  folderId?: string
  folderType?: string
  cursor?: string
  limit?: number
  unreadOnly?: boolean
  starredOnly?: boolean
  hasAttachment?: boolean
  labels?: string[]
  sortBy?: 'date'
  sortOrder?: 'asc' | 'desc'
}

export interface ListMessagesResult {
  threads: ThreadRow[]
  cursor: string | null
  hasMore: boolean
}

export interface GetMessagePayload {
  messageId: string
}

export interface GetThreadPayload {
  threadId: string
}

export interface GetThreadResult {
  thread: ThreadRow
  messages: (MessageRow & { attachments: AttachmentRow[] })[]
}

export interface MarkReadPayload {
  messageIds: string[]
  read: boolean
}

export interface StarPayload {
  messageIds: string[]
  starred: boolean
}

export interface MovePayload {
  messageIds: string[]
  targetFolderId: string
}

export interface DeletePayload {
  messageIds: string[]
  permanent?: boolean
}

export interface LabelPayload {
  messageIds: string[]
  label: string
}

export interface MessagesNewPayload {
  threads: ThreadRow[]
  accountId: string
}

export interface MessagesUpdatedPayload {
  updates: Partial<ThreadRow>[]
}

// ── Bulk operations ────────────────────────────────────────────────────────

export type BulkAction =
  | 'delete' | 'archive' | 'move'
  | 'markRead' | 'markUnread'
  | 'star' | 'unstar'
  | 'spam' | 'notSpam'
  | 'export' | 'copy'

export interface BulkRequest {
  operationId: string
  action: BulkAction
  threadIds: string[]
  options?: {
    targetFolderId?: string
    targetAccountId?: string
    exportFormat?: 'eml' | 'csv'
    exportPath?: string
    skipTrash?: boolean
  }
}

export interface BulkProgress {
  operationId: string
  action: BulkAction
  total: number
  completed: number
  failed: number
  percentage: number
  currentBatch: number
  estimatedSecondsRemaining: number
  errors: string[]
}

export interface BulkResult {
  operationId: string
  action: BulkAction
  succeeded: number
  failed: number
  errors: string[]
  undoToken?: string
}

export interface BulkCancelledPayload {
  operationId: string
  completed: number
  remaining: number
}

export interface BulkQueryCriteria {
  accountId?: string
  folderId?: string
  folderType?: string
  unreadOnly?: boolean
  readOnly?: boolean
  starredOnly?: boolean
  hasAttachment?: boolean
  fromAddress?: string
  olderThanDays?: number
  newerThanDays?: number
}

// ── Folder management (Phase 8B) ──────────────────────────────────────────

/**
 * High-level folder operation. Maps to a BulkAction + BulkQueryCriteria pair
 * on the main process — the renderer never handles the thread IDs directly.
 */
export type FolderAction =
  | 'emptyTrash'      // delete all in trash
  | 'emptySpam'       // delete all in spam
  | 'markAllRead'     // markRead all unread in folder
  | 'markAllUnread'   // markUnread all in folder
  | 'archiveAllRead'  // archive all read messages in folder
  | 'deleteAll'       // move all to trash (custom folders only)

export interface FolderExecuteRequest {
  operationId?: string
  action: FolderAction
  /** Local DB folder id — use when acting on a specific folder row */
  folderId?: string
  /** Folder type — use for cross-account type operations (e.g. 'trash') */
  folderType?: string
  /** Omit to affect all accounts */
  accountId?: string
}

// ── Compose ────────────────────────────────────────────────────────────────

export interface SendPayload {
  fromAccountId: string
  to: { name?: string; address: string }[]
  cc?: { name?: string; address: string }[]
  bcc?: { name?: string; address: string }[]
  subject: string
  bodyHtml: string
  attachmentPaths?: string[]
  inReplyToRemoteId?: string
  scheduledAt?: number
}

export interface SaveDraftPayload extends SendPayload {
  remoteId?: string
}

export interface UploadAttachmentPayload {
  accountId: string
  filePath: string
}

export interface UploadAttachmentResult {
  localPath: string
  filename: string
  mimeType: string
  size: number
}

// ── Attachments ────────────────────────────────────────────────────────────

export interface DownloadAttachmentPayload {
  attachmentId: string
}

export interface DownloadAttachmentResult {
  localPath: string
}

// ── Sync ───────────────────────────────────────────────────────────────────

export interface SyncProgressPayload {
  accountId: string
  folderId?: string
  message: string
  progress: number
}

// ── Settings ───────────────────────────────────────────────────────────────

export interface SettingsSetPayload {
  key: string
  value: unknown
}

// ── Plugin ─────────────────────────────────────────────────────────────────

export interface PluginManifest {
  id: string
  name: string
  version: string
  description: string
  author: string
  entrypoint: string
  permissions: string[]
  allowedOrigins: string[]
  hooks: string[]
}

// ── Updater ────────────────────────────────────────────────────────────────

// ── Authenticator (TOTP) ───────────────────────────────────────────────────

export type TotpAlgorithm = 'SHA1' | 'SHA256' | 'SHA512'

/** Describes an authenticator. Intentionally has no secret field. */
export interface TotpAccountMeta {
  id: string
  accountId: string | null
  issuer: string
  label: string
  algorithm: TotpAlgorithm
  digits: number
  period: number
  verified: boolean
  createdAt: number
  updatedAt: number
}

/** Metadata plus a code that expires within `remainingSeconds`. */
export interface TotpCodeView extends TotpAccountMeta {
  code: string | null
  remainingSeconds: number
  error?: string
}

export interface TotpProvisioning {
  secret: string
  issuer: string
  label: string
  algorithm: TotpAlgorithm
  digits: number
  period: number
}

export interface TotpMigrationEntry extends TotpProvisioning {
  /** Present when Email Hub cannot use this entry (e.g. counter-based). */
  unsupportedReason?: string
}

export interface TotpAddPayload {
  secret: string
  issuer: string
  label: string
  algorithm: TotpAlgorithm
  digits: number
  period: number
  accountId?: string | null
}

export type UpdateStatus =
  | { type: 'checking' }
  | { type: 'not-available' }
  | { type: 'available'; version: string; releaseNotes?: string | null }
  | { type: 'downloading'; progress: number }
  | { type: 'downloaded'; version: string; releaseNotes?: string | null }
  | { type: 'error'; error: string }

export interface AppInfo {
  version: string
  isSafeMode: boolean
}

// ── The typed window.emailAPI surface ──────────────────────────────────────

export interface EmailAPI {
  // Accounts
  accounts: {
    list(): Promise<AccountRow[]>
    add(payload: AddAccountPayload): Promise<AccountRow>
    remove(accountId: string): Promise<void>
    update(accountId: string, patch: UpdateAccountPayload): Promise<AccountRow>
    reconnect(accountId: string): Promise<void>
    reorder(accountIds: string[]): Promise<void>
    /** Start OAuth flow in system browser; resolves when auth completes */
    oauthStart(provider: 'gmail' | 'graph'): Promise<AccountRow>
    /** Test IMAP connection without saving to DB */
    verify(payload: VerifyAccountPayload): Promise<VerifyAccountResult>
    /** Per-account health: sync status, counts, provider */
    health(): Promise<AccountHealth[]>
    onSyncStatusChanged(cb: (payload: SyncStatusChangedPayload) => void): () => void
  }

  // Folders
  folders: {
    list(accountId: string): Promise<FolderRow[]>
    execute(req: FolderExecuteRequest): Promise<{ operationId: string } | { error: IpcError }>
    onUnreadChanged(cb: (payload: UnreadChangedPayload) => void): () => void
  }

  // Messages
  messages: {
    list(payload: ListMessagesPayload): Promise<ListMessagesResult>
    get(messageId: string): Promise<MessageRow>
    getThread(threadId: string): Promise<GetThreadResult>
    markRead(payload: MarkReadPayload): Promise<void>
    star(payload: StarPayload): Promise<void>
    move(payload: MovePayload): Promise<void>
    delete(payload: DeletePayload): Promise<void>
    addLabel(payload: LabelPayload): Promise<void>
    removeLabel(payload: LabelPayload): Promise<void>
    archive(messageIds: string[]): Promise<void>
    onNew(cb: (payload: MessagesNewPayload) => void): () => void
    onUpdated(cb: (payload: MessagesUpdatedPayload) => void): () => void
    onDeleted(cb: (messageIds: string[]) => void): () => void
  }

  // Compose
  compose: {
    send(payload: SendPayload): Promise<{ remoteId: string }>
    saveDraft(payload: SaveDraftPayload): Promise<{ remoteId: string }>
    uploadAttachment(payload: UploadAttachmentPayload): Promise<UploadAttachmentResult>
    deleteDraft(remoteId: string, accountId: string): Promise<void>
  }

  // Search
  search: {
    query(payload: SearchQuery): Promise<SearchResult[]>
    suggest(partial: string): Promise<string[]>
  }

  // Sync
  sync: {
    force(accountId?: string): Promise<void>
    getStatus(): Promise<Record<string, SyncStatus>>
    pause(accountId: string): Promise<void>
    resume(accountId: string): Promise<void>
    onProgress(cb: (payload: SyncProgressPayload) => void): () => void
  }

  // Attachments
  attachments: {
    download(attachmentId: string): Promise<DownloadAttachmentResult>
    open(localPath: string): Promise<void>
    saveAs(attachmentId: string): Promise<void>
  }

  // Plugins
  plugins: {
    list(): Promise<PluginManifest[]>
    install(manifestPath: string): Promise<PluginManifest>
    uninstall(pluginId: string): Promise<void>
  }

  // Settings
  settings: {
    get(): Promise<AppSettings>
    set(key: string, value: unknown): Promise<void>
    reset(): Promise<void>
    securityStatus(): Promise<{ encrypted: boolean; method: string }>
  }

  // Shell / OS
  shell: {
    openExternal(url: string): Promise<void>
    openFile(localPath: string): Promise<void>
    showOpenDialog(): Promise<string[]>
  }

  // Window
  window: {
    setBadge(count: number): Promise<void>
    onBadgeCount(cb: (count: number) => void): () => void
  }

  // App-level navigation pushes (notification clicks)
  app: {
    onNavigate(cb: (payload: { panel: 'inbox' | 'search' | 'settings' | 'verification' }) => void): () => void
  }

  // Auto-updater
  updater: {
    check(): Promise<void>
    install(): Promise<void>
    skipVersion(version: string): Promise<void>
    getAppInfo(): Promise<AppInfo>
    onStatus(cb: (status: UpdateStatus) => void): () => void
  }

  // Verification codes
  verificationCodes: {
    list(limit?: number): Promise<VerificationCodeRow[]>
    markRead(ids: string[]): Promise<void>
    /** trashEmail also moves the email each code came from to Trash. */
    delete(ids: string[], trashEmail?: boolean): Promise<{ trashedMessages: number }>
    onNew(cb: (code: VerificationCodeRow) => void): () => void
  }

  // Authenticator (TOTP). No method returns a stored secret — by design.
  totp: {
    /** Metadata plus the current short-lived code for each authenticator. */
    list(): Promise<TotpCodeView[]>
    /** Parses an otpauth:// link the user pasted, for the setup form. */
    parseUri(uri: string): Promise<TotpProvisioning>
    /** Decodes a Google Authenticator export, which may hold many accounts. */
    parseMigration(uri: string): Promise<TotpMigrationEntry[]>
    add(payload: TotpAddPayload): Promise<TotpAccountMeta>
    verify(id: string, code: string): Promise<{ verified: boolean }>
    rename(id: string, issuer: string, label: string): Promise<void>
    remove(id: string): Promise<void>
  }

  // Bulk operations
  bulk: {
    execute(req: BulkRequest): Promise<{ operationId: string }>
    cancel(operationId: string): Promise<void>
    undo(undoToken: string): Promise<void>
    queryIds(criteria: BulkQueryCriteria): Promise<string[]>
    onProgress(cb: (payload: BulkProgress) => void): () => void
    onDone(cb: (payload: BulkResult) => void): () => void
    onCancelled(cb: (payload: BulkCancelledPayload) => void): () => void
  }
}
