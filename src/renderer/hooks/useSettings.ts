import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { AppSettings } from '@shared/types/db'

const SETTINGS_KEY = ['settings'] as const

export function useSettings() {
  const queryClient = useQueryClient()

  const query = useQuery({
    queryKey: SETTINGS_KEY,
    queryFn: async () => {
      const result = await window.emailAPI.settings.get()
      return (result as { data?: AppSettings }).data ?? null
    },
    staleTime: 60_000,
  })

  const setMutation = useMutation({
    mutationFn: async ({ key, value }: { key: string; value: unknown }) => {
      await window.emailAPI.settings.set(key, value)
    },
    onMutate: async ({ key, value }) => {
      await queryClient.cancelQueries({ queryKey: SETTINGS_KEY })
      const prev = queryClient.getQueryData<AppSettings>(SETTINGS_KEY)
      queryClient.setQueryData<AppSettings>(SETTINGS_KEY, (old) =>
        old ? { ...old, [key]: value } : old
      )
      return { prev }
    },
    onError: (_err, _vars, context) => {
      if (context?.prev) queryClient.setQueryData(SETTINGS_KEY, context.prev)
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: SETTINGS_KEY })
    },
  })

  return {
    settings: query.data,
    isLoading: query.isLoading,
    setSetting: (key: string, value: unknown) => setMutation.mutate({ key, value }),
  }
}
