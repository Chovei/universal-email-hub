import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { useSyncStore } from '../stores/syncStore'
import type { FolderRow } from '@shared/types/db'

export function useFolders(accountId: string | null) {
  const { updateUnreadCount } = useSyncStore()
  const queryClient = useQueryClient()

  const query = useQuery({
    queryKey: ['folders', accountId],
    queryFn: async () => {
      if (!accountId || accountId === 'unified') return []
      const result = await window.emailAPI.folders.list(accountId)
      return (result as { data?: FolderRow[] }).data ?? []
    },
    enabled: !!accountId && accountId !== 'unified',
    staleTime: 60_000,
  })

  useEffect(() => {
    const unsub = window.emailAPI.folders.onUnreadChanged((payload) => {
      const { folderId, count, accountId: aid } = payload as { folderId: string; count: number; accountId: string }
      updateUnreadCount(folderId, count, 0)
      void queryClient.invalidateQueries({ queryKey: ['folders', aid] })
    })
    return unsub
  }, [updateUnreadCount, queryClient])

  return {
    folders: query.data ?? [],
    isLoading: query.isLoading,
  }
}
