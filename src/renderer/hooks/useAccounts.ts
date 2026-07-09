import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { useAccountStore } from '../stores/accountStore'
import type { AccountRow } from '@shared/types/db'

const ACCOUNTS_KEY = ['accounts'] as const

export function useAccounts() {
  const { setAccounts, updateSyncStatus } = useAccountStore()
  const queryClient = useQueryClient()

  const query = useQuery({
    queryKey: ACCOUNTS_KEY,
    queryFn: async () => {
      const result = await window.emailAPI.accounts.list()
      return (result as { data?: AccountRow[] }).data ?? []
    },
    staleTime: 30_000,
  })

  useEffect(() => {
    if (query.data) setAccounts(query.data)
  }, [query.data, setAccounts])

  // Subscribe to sync status changes
  useEffect(() => {
    const unsub = window.emailAPI.accounts.onSyncStatusChanged((payload) => {
      const { accountId, status } = payload as { accountId: string; status: Parameters<typeof updateSyncStatus>[1] }
      updateSyncStatus(accountId, status)
    })
    return unsub
  }, [updateSyncStatus])

  const addMutation = useMutation({
    mutationFn: (payload: Parameters<typeof window.emailAPI.accounts.add>[0]) =>
      window.emailAPI.accounts.add(payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ACCOUNTS_KEY })
    },
  })

  const removeMutation = useMutation({
    mutationFn: (accountId: string) => window.emailAPI.accounts.remove(accountId),
    onMutate: async (accountId) => {
      const prev = queryClient.getQueryData<AccountRow[]>(ACCOUNTS_KEY)
      queryClient.setQueryData<AccountRow[]>(ACCOUNTS_KEY, (old) =>
        old?.filter((a) => a.id !== accountId) ?? []
      )
      return { prev }
    },
    onError: (_err, _vars, context) => {
      if (context?.prev) queryClient.setQueryData(ACCOUNTS_KEY, context.prev)
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ACCOUNTS_KEY })
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Parameters<typeof window.emailAPI.accounts.update>[1] }) =>
      window.emailAPI.accounts.update(id, patch),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ACCOUNTS_KEY })
    },
  })

  return {
    accounts: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error,
    addAccount: addMutation.mutateAsync,
    removeAccount: removeMutation.mutateAsync,
    updateAccount: updateMutation.mutateAsync,
  }
}
