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
