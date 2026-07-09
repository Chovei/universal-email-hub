import { eq, and } from 'drizzle-orm'
import { getDb } from '../client'
import { folders } from '../schema'
import type { FolderInsert, FolderSelect } from '../schema'

export function getFoldersByAccount(accountId: string): FolderSelect[] {
  return getDb().select().from(folders).where(eq(folders.accountId, accountId)).all()
}

export function getFolderById(id: string): FolderSelect | undefined {
  return getDb().select().from(folders).where(eq(folders.id, id)).get()
}

export function getFolderByRemoteId(
  accountId: string,
  remoteId: string
): FolderSelect | undefined {
  return getDb()
    .select()
    .from(folders)
    .where(and(eq(folders.accountId, accountId), eq(folders.remoteId, remoteId)))
    .get()
}

export function getFolderByType(
  accountId: string,
  type: string
): FolderSelect | undefined {
  return getDb()
    .select()
    .from(folders)
    .where(and(eq(folders.accountId, accountId), eq(folders.type, type)))
    .get()
}

export function upsertFolder(data: FolderInsert): FolderSelect {
  return getDb()
    .insert(folders)
    .values(data)
    .onConflictDoUpdate({
      target: [folders.accountId, folders.remoteId],
      set: {
        name: data.name,
        type: data.type,
        totalCount: data.totalCount,
        unreadCount: data.unreadCount,
        updatedAt: data.updatedAt,
      },
    })
    .returning()
    .get()
}

export function updateFolderUnread(id: string, unreadCount: number, totalCount: number): void {
  getDb()
    .update(folders)
    .set({ unreadCount, totalCount, updatedAt: Date.now() })
    .where(eq(folders.id, id))
    .run()
}

export function updateFolderSyncCursor(id: string, cursor: string | null): void {
  getDb()
    .update(folders)
    .set({ syncCursor: cursor, updatedAt: Date.now() })
    .where(eq(folders.id, id))
    .run()
}

export function deleteFoldersByAccount(accountId: string): void {
  getDb().delete(folders).where(eq(folders.accountId, accountId)).run()
}
