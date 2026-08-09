import { useState, useEffect, useCallback, useRef } from 'react'
import type { TotpCodeView } from '@shared/types/ipc'

type Envelope<T> = { data?: T; error?: { code: string; message: string } }

/**
 * Authenticator codes with a single shared timer.
 *
 * One interval drives every account: it counts the displayed seconds down
 * locally and only asks the main process for fresh codes when a period
 * actually rolls over. Five hundred authenticators therefore cost one timer
 * and one IPC round trip per rollover, not five hundred of each.
 */
export function useTotpAccounts() {
  const [accounts, setAccounts] = useState<TotpCodeView[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const accountsRef = useRef<TotpCodeView[]>([])

  const refresh = useCallback(async () => {
    const result = (await window.emailAPI.totp.list()) as unknown as Envelope<TotpCodeView[]>
    const data = result.data ?? []
    accountsRef.current = data
    setAccounts(data)
    setIsLoading(false)
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    const tick = setInterval(() => {
      const current = accountsRef.current
      if (current.length === 0) return

      // A code whose countdown reaches zero needs a real value from the main
      // process; everything else just ticks down on screen.
      const needsRefresh = current.some((a) => a.code !== null && a.remainingSeconds <= 1)
      if (needsRefresh) {
        void refresh()
        return
      }
      const next = current.map((a) =>
        a.code === null ? a : { ...a, remainingSeconds: Math.max(0, a.remainingSeconds - 1) }
      )
      accountsRef.current = next
      setAccounts(next)
    }, 1000)
    return () => clearInterval(tick)
  }, [refresh])

  const remove = useCallback(
    async (id: string) => {
      await window.emailAPI.totp.remove(id)
      await refresh()
    },
    [refresh]
  )

  const rename = useCallback(
    async (id: string, issuer: string, label: string) => {
      await window.emailAPI.totp.rename(id, issuer, label)
      await refresh()
    },
    [refresh]
  )

  return { accounts, isLoading, refresh, remove, rename }
}
