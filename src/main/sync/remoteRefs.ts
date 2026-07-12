import type { RemoteMessageRef } from '@shared/types/provider'
import { getFolderById } from '../db/queries/folders'

/**
 * Build provider-ready message refs from DB rows, resolving each message's
 * local folderId to the provider's folder remoteId. IMAP requires this
 * context because UIDs are only unique within a mailbox; Gmail/Graph
 * ignore it.
 *
 * Folder lookups are memoized per call — bulk operations routinely pass
 * thousands of messages spread across a handful of folders.
 */
export function buildRemoteRefs(
  msgs: Array<{ remoteId: string; folderId: string | null }>
): RemoteMessageRef[] {
  const folderCache = new Map<string, string | null>()

  const resolve = (folderId: string | null): string | null => {
    if (!folderId) return null
    if (folderCache.has(folderId)) return folderCache.get(folderId) ?? null
    const remoteId = getFolderById(folderId)?.remoteId ?? null
    folderCache.set(folderId, remoteId)
    return remoteId
  }

  return msgs.map((m) => ({
    remoteId: m.remoteId,
    folderRemoteId: resolve(m.folderId),
  }))
}
