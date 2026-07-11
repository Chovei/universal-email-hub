import { useCallback } from 'react'
import { useSelectionStore } from '../stores/selectionStore'
import type { BulkQueryCriteria } from '@shared/types/ipc'

export function useBulkQuery() {
  const { selectAll } = useSelectionStore()

  const query = useCallback(async (criteria: BulkQueryCriteria) => {
    const response = await window.emailAPI.bulk.queryIds(criteria)
    // The preload bridge's invoke() passes the main-process `{ data }` envelope
    // through untouched (see src/preload/index.ts), so unwrap it here the same
    // way useMessages does. Tolerate a raw array in case the bridge ever
    // unwraps for us.
    const ids = Array.isArray(response)
      ? response
      : (response as unknown as { data?: string[] } | null | undefined)?.data
    if (Array.isArray(ids)) selectAll(ids)
  }, [selectAll])

  return {
    selectAllUnread: (accountId?: string) => query({ accountId, unreadOnly: true }),
    selectAllRead: (accountId?: string) => query({ accountId, readOnly: true }),
    selectAllStarred: (accountId?: string) => query({ accountId, starredOnly: true }),
    selectAllWithAttachments: (accountId?: string) => query({ accountId, hasAttachment: true }),
    selectAllFromSender: (fromAddress: string, accountId?: string) => query({ accountId, fromAddress }),
    selectOlderThan: (days: number, accountId?: string) => query({ accountId, olderThanDays: days }),
    selectNewerThan: (days: number, accountId?: string) => query({ accountId, newerThanDays: days }),
  }
}
