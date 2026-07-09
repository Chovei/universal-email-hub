import { z } from 'zod'

// ── Address ────────────────────────────────────────────────────────────────

export const AddressSchema = z.object({
  name: z.string().optional(),
  address: z.string().email(),
})

// ── Accounts ───────────────────────────────────────────────────────────────

export const AddAccountSchema = z.object({
  provider: z.enum([
    'gmail', 'graph', 'imap', 'yahoo', 'icloud', 'exchange', 'zoho', 'fastmail', 'aol', 'gmx',
  ]),
  credentials: z
    .object({
      username: z.string(),
      password: z.string(),
      host: z.string(),
      port: z.number().int().min(1).max(65535),
      security: z.enum(['TLS', 'STARTTLS', 'NONE']),
      smtpHost: z.string(),
      smtpPort: z.number().int().min(1).max(65535),
      smtpSecurity: z.enum(['TLS', 'STARTTLS', 'NONE']),
    })
    .optional(),
})

export const UpdateAccountSchema = z.object({
  displayName: z.string().min(1).max(200).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  isActive: z.boolean().optional(),
  syncIntervalSeconds: z.number().int().min(30).max(3600).optional(),
  order: z.number().int().min(0).optional(),
})

// ── Messages ───────────────────────────────────────────────────────────────

export const ListMessagesSchema = z.object({
  accountId: z.string().optional(),
  folderId: z.string().optional(),
  cursor: z.string().max(512).optional(),
  limit: z.number().int().min(1).max(200).default(50),
  unreadOnly: z.boolean().optional(),
  starredOnly: z.boolean().optional(),
  hasAttachment: z.boolean().optional(),
  labels: z.array(z.string()).optional(),
  sortBy: z.enum(['date']).optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
})

export const MarkReadSchema = z.object({
  messageIds: z.array(z.string().min(1)).min(1).max(500),
  read: z.boolean(),
})

export const StarSchema = z.object({
  messageIds: z.array(z.string().min(1)).min(1).max(500),
  starred: z.boolean(),
})

export const MoveSchema = z.object({
  messageIds: z.array(z.string().min(1)).min(1).max(500),
  targetFolderId: z.string().min(1),
})

export const DeleteSchema = z.object({
  messageIds: z.array(z.string().min(1)).min(1).max(500),
  permanent: z.boolean().optional(),
})

export const LabelSchema = z.object({
  messageIds: z.array(z.string().min(1)).min(1).max(500),
  label: z.string().min(1).max(200),
})

// H7: Validates the messageIds array passed to MESSAGES_ARCHIVE
export const ArchiveSchema = z.array(z.string().min(1).max(200)).min(1).max(500)

// ── Compose ────────────────────────────────────────────────────────────────

export const SendSchema = z.object({
  fromAccountId: z.string().min(1),
  to: z.array(AddressSchema).min(1),
  cc: z.array(AddressSchema).optional(),
  bcc: z.array(AddressSchema).optional(),
  subject: z.string().max(2000),
  bodyHtml: z.string().max(10_000_000),
  attachmentPaths: z.array(z.string()).optional(),
  inReplyToRemoteId: z.string().optional(),
  scheduledAt: z.number().optional(),
})

export const SaveDraftSchema = SendSchema.extend({
  remoteId: z.string().optional(),
})

export const UploadAttachmentSchema = z.object({
  accountId: z.string().min(1),
  filePath: z.string().min(1),
})

// ── Search ─────────────────────────────────────────────────────────────────

export const SearchQuerySchema = z.object({
  query: z.string().max(1000),
  filters: z
    .object({
      accountId: z.string().optional(),
      folderId: z.string().optional(),
      isUnread: z.boolean().optional(),
      hasAttachment: z.boolean().optional(),
      isStarred: z.boolean().optional(),
      dateFrom: z.number().optional(),
      dateTo: z.number().optional(),
      labels: z.array(z.string()).optional(),
    })
    .optional(),
  limit: z.number().int().min(1).max(200).default(50),
  offset: z.number().int().min(0).default(0),
})

// ── Shell ──────────────────────────────────────────────────────────────────

export const OpenExternalSchema = z.object({
  url: z
    .string()
    .url()
    .refine((url) => ['http:', 'https:', 'mailto:'].some((p) => url.startsWith(p)), {
      message: 'Only http, https, and mailto protocols are allowed',
    }),
})
