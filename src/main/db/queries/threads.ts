import { eq, desc, and, lt, gt, sql, inArray } from 'drizzle-orm'
import { getDb } from '../client'
import { threads, messages } from '../schema'
import type { ThreadInsert, ThreadSelect } from '../schema'

export function getThreadById(id: string): ThreadSelect | undefined {
  return getDb().select().from(threads).where(eq(threads.id, id)).get()
}

export function getThreadByRemoteId(accountId: string, remoteId: string): ThreadSelect | undefined {
  return getDb()
    .select()
    .from(threads)
    .where(and(eq(threads.accountId, accountId), eq(threads.remoteId, remoteId)))
    .get()
}

export interface ListThreadsOptions {
  accountId?: string
  folderId?: string
  cursor?: number
  limit?: number
  unreadOnly?: boolean
  starredOnly?: boolean
}

export function listThreads(opts: ListThreadsOptions): ThreadSelect[] {
  const db = getDb()
  const { cursor, limit = 50, unreadOnly, starredOnly } = opts

  const conditions = []

  if (opts.accountId) {
    conditions.push(eq(threads.accountId, opts.accountId))
  }
  if (opts.folderId) {
    const sub = db
      .select({ id: messages.threadId })
      .from(messages)
      .where(eq(messages.folderId, opts.folderId))
    conditions.push(inArray(threads.id, sub))
  }
  if (cursor) {
    conditions.push(lt(threads.lastMessageAt, cursor))
  }
  if (unreadOnly) {
    conditions.push(gt(threads.unreadCount, 0))
  }
  if (starredOnly) {
    conditions.push(eq(threads.isStarred, true))
  }

  const query = db
    .select()
    .from(threads)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(threads.lastMessageAt))
    .limit(limit)

  return query.all()
}

export function upsertThread(data: ThreadInsert): ThreadSelect {
  return getDb()
    .insert(threads)
    .values(data)
    .onConflictDoUpdate({
      target: [threads.id],
      set: {
        subject: data.subject,
        snippet: data.snippet,
        lastMessageAt: data.lastMessageAt,
        unreadCount: data.unreadCount,
        messageCount: data.messageCount,
        isStarred: data.isStarred,
        hasAttachment: data.hasAttachment,
        labels: data.labels,
        participantAddresses: data.participantAddresses,
      },
    })
    .returning()
    .get()
}

export function updateThreadCounts(
  id: string,
  unreadCount: number,
  messageCount: number
): void {
  getDb()
    .update(threads)
    .set({ unreadCount, messageCount })
    .where(eq(threads.id, id))
    .run()
}

export function updateThreadStar(id: string, isStarred: boolean): void {
  getDb().update(threads).set({ isStarred }).where(eq(threads.id, id)).run()
}

export function deleteThread(id: string): void {
  getDb().delete(threads).where(eq(threads.id, id)).run()
}

export function getTotalUnreadCount(accountId?: string): number {
  const db = getDb()
  const condition = accountId ? eq(threads.accountId, accountId) : undefined
  const result = db
    .select({ total: sql<number>`sum(${threads.unreadCount})` })
    .from(threads)
    .where(condition)
    .get()
  return result?.total ?? 0
}
