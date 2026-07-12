import {
  sqliteTable,
  text,
  integer,
  index,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core'
import { relations } from 'drizzle-orm'

// ── accounts ───────────────────────────────────────────────────────────────

export const accounts = sqliteTable(
  'accounts',
  {
    id: text('id').primaryKey(),
    provider: text('provider').notNull(),
    email: text('email').notNull(),
    displayName: text('display_name').notNull(),
    avatarUrl: text('avatar_url'),
    color: text('color').notNull().default('#6366F1'),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    syncCursor: text('sync_cursor'),
    lastSyncAt: integer('last_sync_at'),
    syncIntervalSeconds: integer('sync_interval_seconds').notNull().default(60),
    order: integer('order').notNull().default(0),
    createdAt: integer('created_at').notNull(),
    notes: text('notes'),
    label: text('label'),
  },
  (t) => ({
    emailIdx: uniqueIndex('accounts_email_idx').on(t.email),
  })
)

// ── folders ────────────────────────────────────────────────────────────────

export const folders = sqliteTable(
  'folders',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    remoteId: text('remote_id').notNull(),
    name: text('name').notNull(),
    type: text('type').notNull().default('custom'),
    totalCount: integer('total_count').notNull().default(0),
    unreadCount: integer('unread_count').notNull().default(0),
    syncCursor: text('sync_cursor'),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => ({
    accountRemoteIdx: uniqueIndex('folders_account_remote_idx').on(t.accountId, t.remoteId),
    accountTypeIdx: index('folders_account_type_idx').on(t.accountId, t.type),
  })
)

// ── threads ────────────────────────────────────────────────────────────────

export const threads = sqliteTable(
  'threads',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    remoteId: text('remote_id'),
    subject: text('subject').notNull().default(''),
    snippet: text('snippet').notNull().default(''),
    lastMessageAt: integer('last_message_at').notNull(),
    unreadCount: integer('unread_count').notNull().default(0),
    messageCount: integer('message_count').notNull().default(0),
    isStarred: integer('is_starred', { mode: 'boolean' }).notNull().default(false),
    hasAttachment: integer('has_attachment', { mode: 'boolean' }).notNull().default(false),
    labels: text('labels').notNull().default('[]'),
    participantAddresses: text('participant_addresses').notNull().default('[]'),
  },
  (t) => ({
    accountLastMsgIdx: index('threads_account_last_msg_idx').on(t.accountId, t.lastMessageAt),
    remoteIdx: index('threads_remote_idx').on(t.accountId, t.remoteId),
    accountUnreadIdx: index('threads_account_unread_idx').on(t.accountId, t.unreadCount),
    accountStarredIdx: index('threads_account_starred_idx').on(t.accountId, t.isStarred),
  })
)

// ── messages ───────────────────────────────────────────────────────────────

export const messages = sqliteTable(
  'messages',
  {
    id: text('id').primaryKey(),
    threadId: text('thread_id')
      .notNull()
      .references(() => threads.id, { onDelete: 'cascade' }),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    folderId: text('folder_id').references(() => folders.id, { onDelete: 'set null' }),
    remoteId: text('remote_id').notNull(),
    fromAddress: text('from_address').notNull(),
    fromName: text('from_name'),
    toAddresses: text('to_addresses').notNull().default('[]'),
    ccAddresses: text('cc_addresses').notNull().default('[]'),
    bccAddresses: text('bcc_addresses').notNull().default('[]'),
    replyToAddresses: text('reply_to_addresses').notNull().default('[]'),
    subject: text('subject').notNull().default(''),
    bodyHtml: text('body_html'),
    bodyText: text('body_text'),
    date: integer('date').notNull(),
    isRead: integer('is_read', { mode: 'boolean' }).notNull().default(false),
    isStarred: integer('is_starred', { mode: 'boolean' }).notNull().default(false),
    isDraft: integer('is_draft', { mode: 'boolean' }).notNull().default(false),
    hasAttachment: integer('has_attachment', { mode: 'boolean' }).notNull().default(false),
    labels: text('labels').notNull().default('[]'),
    headers: text('headers').notNull().default('{}'),
    sizeBytes: integer('size_bytes'),
    fetchedAt: integer('fetched_at').notNull(),
  },
  (t) => ({
    remoteIdx: uniqueIndex('messages_remote_idx').on(t.accountId, t.remoteId),
    threadDateIdx: index('messages_thread_date_idx').on(t.threadId, t.date),
    folderDateIdx: index('messages_folder_date_idx').on(t.folderId, t.date),
    accountDateIdx: index('messages_account_date_idx').on(t.accountId, t.date),
    accountReadIdx: index('messages_account_read_idx').on(t.accountId, t.isRead),
    accountStarredIdx: index('messages_account_starred_idx').on(t.accountId, t.isStarred),
    accountDraftIdx: index('messages_account_draft_idx').on(t.accountId, t.isDraft),
    fromAddressIdx: index('messages_from_address_idx').on(t.fromAddress),
  })
)

// ── attachments ────────────────────────────────────────────────────────────

export const attachments = sqliteTable(
  'attachments',
  {
    id: text('id').primaryKey(),
    messageId: text('message_id')
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    filename: text('filename').notNull(),
    mimeType: text('mime_type').notNull(),
    size: integer('size').notNull(),
    remoteRef: text('remote_ref').notNull(),
    localPath: text('local_path'),
    isDownloaded: integer('is_downloaded', { mode: 'boolean' }).notNull().default(false),
    isInline: integer('is_inline', { mode: 'boolean' }).notNull().default(false),
    contentId: text('content_id'),
  },
  (t) => ({
    messageIdx: index('attachments_message_idx').on(t.messageId),
  })
)

// ── sync_jobs ──────────────────────────────────────────────────────────────

export const syncJobs = sqliteTable(
  'sync_jobs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    accountId: text('account_id').notNull(),
    folderId: text('folder_id'),
    type: text('type').notNull(),
    priority: integer('priority').notNull().default(5),
    payload: text('payload'),
    status: text('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    nextRunAt: integer('next_run_at').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => ({
    statusPriorityIdx: index('sync_jobs_status_priority_idx').on(
      t.status,
      t.priority,
      t.nextRunAt
    ),
    accountIdx: index('sync_jobs_account_idx').on(t.accountId, t.status),
  })
)

// ── plugin_storage ─────────────────────────────────────────────────────────

export const pluginStorage = sqliteTable(
  'plugin_storage',
  {
    pluginId: text('plugin_id').notNull(),
    key: text('key').notNull(),
    value: text('value').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => ({
    pk: uniqueIndex('plugin_storage_pk').on(t.pluginId, t.key),
    pluginIdx: index('plugin_storage_plugin_idx').on(t.pluginId),
  })
)

// ── verification_codes ─────────────────────────────────────────────────────

export const verificationCodes = sqliteTable(
  'verification_codes',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    messageId: text('message_id').notNull(),
    serviceName: text('service_name').notNull(),
    senderEmail: text('sender_email').notNull(),
    senderName: text('sender_name'),
    code: text('code').notNull(),
    subject: text('subject').notNull().default(''),
    receivedAt: integer('received_at').notNull(),
    isRead: integer('is_read', { mode: 'boolean' }).notNull().default(false),
  },
  (t) => ({
    accountReceivedIdx: index('verification_codes_account_received_idx').on(t.accountId, t.receivedAt),
    receivedIdx: index('verification_codes_received_idx').on(t.receivedAt),
    messageIdx: index('verification_codes_message_idx').on(t.messageId),
    accountCodeIdx: index('verification_codes_account_code_idx').on(t.accountId, t.code, t.receivedAt),
  })
)

// ── Relations ──────────────────────────────────────────────────────────────

export const accountsRelations = relations(accounts, ({ many }) => ({
  folders: many(folders),
  threads: many(threads),
  messages: many(messages),
  verificationCodes: many(verificationCodes),
}))

export const foldersRelations = relations(folders, ({ one, many }) => ({
  account: one(accounts, { fields: [folders.accountId], references: [accounts.id] }),
  messages: many(messages),
}))

export const threadsRelations = relations(threads, ({ one, many }) => ({
  account: one(accounts, { fields: [threads.accountId], references: [accounts.id] }),
  messages: many(messages),
}))

export const messagesRelations = relations(messages, ({ one, many }) => ({
  account: one(accounts, { fields: [messages.accountId], references: [accounts.id] }),
  thread: one(threads, { fields: [messages.threadId], references: [threads.id] }),
  folder: one(folders, { fields: [messages.folderId], references: [folders.id] }),
  attachments: many(attachments),
}))

export const attachmentsRelations = relations(attachments, ({ one }) => ({
  message: one(messages, { fields: [attachments.messageId], references: [messages.id] }),
}))

export const verificationCodesRelations = relations(verificationCodes, ({ one }) => ({
  account: one(accounts, { fields: [verificationCodes.accountId], references: [accounts.id] }),
}))

// ── Type exports from schema ───────────────────────────────────────────────

export type AccountInsert = typeof accounts.$inferInsert
export type VerificationCodeInsert = typeof verificationCodes.$inferInsert
export type VerificationCodeSelect = typeof verificationCodes.$inferSelect
export type AccountSelect = typeof accounts.$inferSelect
export type FolderInsert = typeof folders.$inferInsert
export type FolderSelect = typeof folders.$inferSelect
export type ThreadInsert = typeof threads.$inferInsert
export type ThreadSelect = typeof threads.$inferSelect
export type MessageInsert = typeof messages.$inferInsert
export type MessageSelect = typeof messages.$inferSelect
export type AttachmentInsert = typeof attachments.$inferInsert
export type AttachmentSelect = typeof attachments.$inferSelect
export type SyncJobInsert = typeof syncJobs.$inferInsert
export type SyncJobSelect = typeof syncJobs.$inferSelect
