import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import type { ListMessagesPayload, ListMessagesResult } from '@shared/types/ipc'

export function useMessages(payload: Omit<ListMessagesPayload, 'cursor'>) {
  const queryClient = useQueryClient()

  const query = useInfiniteQuery({
    queryKey: ['messages', payload],
    queryFn: async ({ pageParam }) => {
      const result = await window.emailAPI.messages.list({
        ...payload,
        cursor: pageParam as string | undefined,
      })
      return (result as { data?: ListMessagesResult }).data ?? { threads: [], cursor: null, hasMore: false }
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.cursor ?? undefined,
    staleTime: 10_000,
    gcTime: 5 * 60_000,
  })

  const threads = query.data?.pages.flatMap((p) => p.threads) ?? []

  useEffect(() => {
    const unsub = window.emailAPI.messages.onNew((_payload) => {
      void queryClient.invalidateQueries({ queryKey: ['messages'] })
    })
    return unsub
  }, [queryClient])

  useEffect(() => {
    const unsub = window.emailAPI.messages.onUpdated((_payload) => {
      void queryClient.invalidateQueries({ queryKey: ['messages'] })
    })
    return unsub
  }, [queryClient])

  // H3: Invalidate the thread list when remote deletions arrive so they
  //     disappear immediately rather than on the next manual refresh.
  useEffect(() => {
    const unsub = window.emailAPI.messages.onDeleted((_messageIds) => {
      void queryClient.invalidateQueries({ queryKey: ['messages'] })
    })
    return unsub
  }, [queryClient])

  return {
    threads,
    isLoading: query.isLoading,
    isFetchingNextPage: query.isFetchingNextPage,
    hasNextPage: query.hasNextPage,
    fetchNextPage: query.fetchNextPage,
    error: query.error,
    refetch: query.refetch,
  }
}
