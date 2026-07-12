import type { ProviderKind } from '../constants/providers'
import type { FolderType } from './provider'

// ── Account ────────────────────────────────────────────────────────────────

export interface AccountRow {
  id: string
  provider: ProviderKind
  email: string
  displayName: string
  avatarUrl: string | null
  color: string
  isActive: boolean
  syncCursor: string | null
  lastSyncAt: number | null
  syncIntervalSeconds: number
  createdAt: number
  order: number
  notes: string | null
  label: string | null
}

// ── Verification code ──────────────────────────────────────────────────────

export interface VerificationCodeRow {
  id: string
  accountId: string
  messageId: string
  serviceName: string
  senderEmail: string
  senderName: string | null
  code: string
  subject: string
  receivedAt: number
  isRead: boolean
}

// ── Folder ─────────────────────────────────────────────────────────────────

export interface FolderRow {
  id: string
  accountId: string
  remoteId: string
  name: string
  type: FolderType
  totalCount: number
  unreadCount: number
  syncCursor: string | null
  updatedAt: number
}

// ── Thread ─────────────────────────────────────────────────────────────────

export interface ThreadRow {
  id: string
  accountId: string
  remoteId: string | null
  subject: string
  snippet: string
  lastMessageAt: number
  unreadCount: number
  messageCount: number
  isStarred: boolean
  labels: string[]
  participantAddresses: ParticipantAddress[]
  hasAttachment: boolean
}

export interface ParticipantAddress {
  name?: string
  address: string
}

// ── Message ────────────────────────────────────────────────────────────────

export interface MessageRow {
  id: string
  threadId: string
  accountId: string
  folderId: string | null
  remoteId: string
  fromAddress: string
  fromName: string | null
  toAddresses: AddressEntry[]
  ccAddresses: AddressEntry[]
  bccAddresses: AddressEntry[]
  replyToAddresses: AddressEntry[]
  subject: string
  bodyHtml: string | null
  bodyText: string | null
  date: number
  isRead: boolean
  isStarred: boolean
  isDraft: boolean
  labels: string[]
  headers: Record<string, string>
  sizeBytes: number | null
  fetchedAt: number
  hasAttachment: boolean
}

export interface AddressEntry {
  name?: string
  address: string
}

// ── Attachment ─────────────────────────────────────────────────────────────

export interface AttachmentRow {
  id: string
  messageId: string
  filename: string
  mimeType: string
  size: number
  remoteRef: string
  localPath: string | null
  isDownloaded: boolean
  isInline: boolean
  contentId: string | null
}

// ── Sync job ───────────────────────────────────────────────────────────────

export type SyncJobType =
  | 'FULL_SYNC'
  | 'PARTIAL_SYNC'
  | 'SEND'
  | 'DELETE'
  | 'MARK_READ'
  | 'MOVE'
  | 'LABEL'
  | 'FETCH_BODY'
  | 'RENEW_PUSH'

export type SyncJobStatus = 'pending' | 'running' | 'done' | 'failed' | 'dead'

export interface SyncJobRow {
  id: number
  accountId: string
  folderId: string | null
  type: SyncJobType
  priority: number
  payload: string | null
  status: SyncJobStatus
  attempts: number
  lastError: string | null
  nextRunAt: number
  createdAt: number
}

// ── Sync status ────────────────────────────────────────────────────────────

export type SyncState = 'idle' | 'syncing' | 'error' | 'paused' | 'offline'

export interface SyncStatus {
  state: SyncState
  progress?: number
  lastSyncAt?: number
  lastError?: string
  errorCategory?: 'auth' | 'network' | 'rate-limit' | 'unknown'
  consecutiveFailures?: number
  lastSyncDurationMs?: number
  /** true while an IMAP IDLE watcher holds a live connection for this account */
  realtime?: boolean
}

// ── Account health ─────────────────────────────────────────────────────────

export interface AccountHealth {
  accountId: string
  email: string
  displayName: string
  provider: string
  status: SyncStatus
  messageCount: number
  unreadCount: number
}

// ── Search ─────────────────────────────────────────────────────────────────

export interface SearchResult {
  messageId: string
  threadId: string
  accountId: string
  subject: string
  snippet: string
  fromAddress: string
  fromName: string | null
  date: number
  isRead: boolean
  hasAttachment: boolean
  rank: number
}

export interface SearchFilters {
  accountId?: string
  folderId?: string
  isUnread?: boolean
  hasAttachment?: boolean
  isStarred?: boolean
  dateFrom?: number
  dateTo?: number
  labels?: string[]
}

export interface SearchQuery {
  query: string
  filters?: SearchFilters
  limit?: number
  offset?: number
}

// ── Settings ───────────────────────────────────────────────────────────────

export interface AppSettings {
  theme: 'light' | 'dark' | 'system'
  accentColor: string
  density: 'compact' | 'comfortable' | 'spacious'
  sidebarWidth: number
  splitRatio: number
  notifications: {
    enabled: boolean
    sound: boolean
    quietHoursStart: string | null
    quietHoursEnd: string | null
    perAccount: Record<string, boolean>
  }
  composer: {
    defaultSignature: string | null
    sendDelay: number
    autoSaveDraftInterval: number
  }
  sync: {
    defaultIntervalSeconds: number
    downloadAttachments: 'always' | 'wifi' | 'never'
    showRemoteImages: boolean
  }
  shortcuts: Record<string, string>
  language: string
  gmailClientId: string
  gmailClientSecret: string
  graphClientId: string
  graphClientSecret: string
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'system',
  accentColor: '#6366F1',
  density: 'comfortable',
  sidebarWidth: 220,
  splitRatio: 0.38,
  notifications: {
    enabled: true,
    sound: true,
    quietHoursStart: null,
    quietHoursEnd: null,
    perAccount: {},
  },
  composer: {
    defaultSignature: null,
    sendDelay: 0,
    autoSaveDraftInterval: 5000,
  },
  sync: {
    defaultIntervalSeconds: 60,
    downloadAttachments: 'wifi',
    showRemoteImages: false,
  },
  shortcuts: {},
  language: 'en',
  gmailClientId: '',
  gmailClientSecret: '',
  graphClientId: '',
  graphClientSecret: '',
}
