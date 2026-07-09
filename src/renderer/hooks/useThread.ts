import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { GetThreadResult } from '@shared/types/ipc'

export function useThread(threadId: string | null) {
  const queryClient = useQueryClient()

  const query = useQuery({
    queryKey: ['thread', threadId],
    queryFn: async () => {
      if (!threadId) return null
      const result = await window.emailAPI.messages.getThread(threadId)
      return (result as { data?: GetThreadResult }).data ?? null
    },
    enabled: !!threadId,
    staleTime: 30_000,
    gcTime: 5 * 60_000,
  })

  const markReadMutation = useMutation({
    mutationFn: ({ messageIds, read }: { messageIds: string[]; read: boolean }) =>
      window.emailAPI.messages.markRead({ messageIds, read }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['thread', threadId] })
      void queryClient.invalidateQueries({ queryKey: ['messages'] })
    },
  })

  const starMutation = useMutation({
    mutationFn: ({ messageIds, starred }: { messageIds: string[]; starred: boolean }) =>
      window.emailAPI.messages.star({ messageIds, starred }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['thread', threadId] })
      void queryClient.invalidateQueries({ queryKey: ['messages'] })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (messageIds: string[]) =>
      window.emailAPI.messages.delete({ messageIds }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['messages'] })
    },
  })

  return {
    thread: query.data?.thread ?? null,
    messages: query.data?.messages ?? [],
    isLoading: query.isLoading,
    error: query.error,
    markRead: markReadMutation.mutateAsync,
    star: starMutation.mutateAsync,
    deleteMessages: deleteMutation.mutateAsync,
  }
}
