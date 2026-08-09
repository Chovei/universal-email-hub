import { eq, and, inArray, desc } from 'drizzle-orm'
import { getDb, getRawSqlite } from '../client'
import { messages, attachments } from '../schema'
import type { MessageInsert, MessageSelect, AttachmentInsert, AttachmentSelect } from '../schema'

export function getMessageById(id: string): MessageSelect | undefined {
  return getDb().select().from(messages).where(eq(messages.id, id)).get()
}

export function getMessageByRemoteId(accountId: string, remoteId: string): MessageSelect | undefined {
  return getDb()
    .select()
    .from(messages)
    .where(and(eq(messages.accountId, accountId), eq(messages.remoteId, remoteId)))
    .get()
}

export function getMessagesByThread(threadId: string): MessageSelect[] {
  return getDb()
    .select()
    .from(messages)
    .where(eq(messages.threadId, threadId))
    .orderBy(desc(messages.date))
    .all()
}

export interface MessageSummary {
  id: string
  threadId: string
  accountId: string
  remoteId: string
  folderId: string | null
  isRead: boolean
  isStarred: boolean
}

export function getMessagesByThreadIds(threadIds: string[]): MessageSummary[] {
  if (threadIds.length === 0) return []
  // SQLite limits inArray to ~32k params — chunk to be safe
  const CHUNK = 500
  if (threadIds.length > CHUNK) {
    const results: MessageSummary[] = []
    for (let i = 0; i < threadIds.length; i += CHUNK) {
      results.push(...getMessagesByThreadIds(threadIds.slice(i, i + CHUNK)))
    }
    return results
  }
  return getDb()
    .select({
      id: messages.id,
      threadId: messages.threadId,
      accountId: messages.accountId,
      remoteId: messages.remoteId,
      folderId: messages.folderId,
      isRead: messages.isRead,
      isStarred: messages.isStarred,
    })
    .from(messages)
    .where(inArray(messages.threadId, threadIds))
    .all()
}

/**
 * Apply server-side read/starred state to messages we already hold, and
 * return the thread ids whose unread counts need recomputing. Only rows that
 * actually changed are written, so a steady-state sync costs one SELECT.
 */
export function applyFlagUpdates(
  accountId: string,
  updates: Array<{ remoteId: string; isRead: boolean; isStarred: boolean }>
): string[] {
  if (updates.length === 0) return []
  const db = getRawSqlite()

  const select = db.prepare<[string, string], { id: string; threadId: string; isRead: number; isStarred: number }>(
    `SELECT id, thread_id AS threadId, is_read AS isRead, is_starred AS isStarred
     FROM messages WHERE account_id = ? AND remote_id = ?`
  )
  const update = db.prepare(`UPDATE messages SET is_read = ?, is_starred = ? WHERE id = ?`)

  const changedThreads = new Set<string>()
  db.transaction(() => {
    for (const u of updates) {
      const row = select.get(accountId, u.remoteId)
      if (!row) continue
      const isRead = u.isRead ? 1 : 0
      const isStarred = u.isStarred ? 1 : 0
      if (row.isRead === isRead && row.isStarred === isStarred) continue
      update.run(isRead, isStarred, row.id)
      changedThreads.add(row.threadId)
    }
  })()

  return [...changedThreads]
}

/** Number of messages held locally for a folder. */
export function countMessagesByFolder(folderId: string): number {
  const row = getRawSqlite()
    .prepare<[string], { n: number }>(`SELECT COUNT(*) AS n FROM messages WHERE folder_id = ?`)
    .get(folderId)
  return row?.n ?? 0
}

/**
 * Lowest numeric remote ID (IMAP UID) held locally for a folder — the
 * backfill floor. IMAP-only: other providers' remote IDs are not numeric.
 */
export function getMinUidByFolder(folderId: string): number | null {
  const row = getRawSqlite()
    .prepare<[string], { minUid: number | null }>(
      `SELECT MIN(CAST(remote_id AS INTEGER)) AS minUid FROM messages WHERE folder_id = ?`
    )
    .get(folderId)
  return row?.minUid ?? null
}

/** Remote IDs of all messages in a folder — used for IMAP ghost reconciliation. */
export function getMessageRemoteIdsByFolder(folderId: string): string[] {
  return getDb()
    .select({ remoteId: messages.remoteId })
    .from(messages)
    .where(eq(messages.folderId, folderId))
    .all()
    .map((r) => r.remoteId)
}

export function upsertMessage(data: MessageInsert): MessageSelect {
  return getDb()
    .insert(messages)
    .values(data)
    .onConflictDoUpdate({
      target: [messages.accountId, messages.remoteId],
      set: {
        isRead: data.isRead,
        isStarred: data.isStarred,
        labels: data.labels,
        folderId: data.folderId,
        bodyHtml: data.bodyHtml,
        bodyText: data.bodyText,
        hasAttachment: data.hasAttachment,
        fetchedAt: data.fetchedAt,
      },
    })
    .returning()
    .get()
}

export function markMessagesRead(ids: string[], read: boolean): void {
  getDb().update(messages).set({ isRead: read }).where(inArray(messages.id, ids)).run()
}

export function starMessages(ids: string[], starred: boolean): void {
  getDb().update(messages).set({ isStarred: starred }).where(inArray(messages.id, ids)).run()
}

export function moveMessages(ids: string[], folderId: string): void {
  getDb().update(messages).set({ folderId }).where(inArray(messages.id, ids)).run()
}

export function deleteMessages(ids: string[]): void {
  getDb().delete(messages).where(inArray(messages.id, ids)).run()
}

// H5: Wrapped in a transaction so all label mutations are one DB write
//     instead of N*2 individual reads + updates.
export function addMessageLabel(ids: string[], label: string): void {
  const rawDb = getRawSqlite()
  const getStmt = rawDb.prepare<[string], { labels: string }>(`SELECT labels FROM messages WHERE id = ?`)
  const setStmt = rawDb.prepare(`UPDATE messages SET labels = ? WHERE id = ?`)

  rawDb.transaction(() => {
    for (const id of ids) {
      const row = getStmt.get(id)
      if (!row) continue
      const existing = JSON.parse(row.labels) as string[]
      if (!existing.includes(label)) {
        setStmt.run(JSON.stringify([...existing, label]), id)
      }
    }
  })()
}

export function removeMessageLabel(ids: string[], label: string): void {
  const rawDb = getRawSqlite()
  const getStmt = rawDb.prepare<[string], { labels: string }>(`SELECT labels FROM messages WHERE id = ?`)
  const setStmt = rawDb.prepare(`UPDATE messages SET labels = ? WHERE id = ?`)

  rawDb.transaction(() => {
    for (const id of ids) {
      const row = getStmt.get(id)
      if (!row) continue
      const existing = JSON.parse(row.labels) as string[]
      setStmt.run(JSON.stringify(existing.filter((l) => l !== label)), id)
    }
  })()
}

// ── Attachments ────────────────────────────────────────────────────────────

export function getAttachmentsByMessage(messageId: string): AttachmentSelect[] {
  return getDb().select().from(attachments).where(eq(attachments.messageId, messageId)).all()
}

export function getAttachmentById(id: string): AttachmentSelect | undefined {
  return getDb().select().from(attachments).where(eq(attachments.id, id)).get()
}

export function upsertAttachment(data: AttachmentInsert): AttachmentSelect {
  return getDb().insert(attachments).values(data).returning().get()
}

export function updateAttachmentDownloaded(id: string, localPath: string): void {
  getDb()
    .update(attachments)
    .set({ isDownloaded: true, localPath })
    .where(eq(attachments.id, id))
    .run()
}
