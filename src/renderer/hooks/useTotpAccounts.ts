import { useState, useEffect, useCallback, useRef } from 'react'
import type { TotpCodeView } from '@shared/types/ipc'

/**
 * Authenticator codes with a single shared timer.
 *
 * One interval drives every account. It does not count down by subtracting
 * one per tick: a throttled or suspended timer fires late, and a countdown
 * built from tick *count* drifts behind real time until it is displaying an
 * expired code as though it were live. Instead each tick re-derives the
 * remaining seconds from the wall clock against the moment the codes were
 * fetched, so a late tick corrects itself rather than compounding.
 *
 * Five hundred authenticators therefore cost one timer and one IPC round trip
 * per rollover, not five hundred of each.
 */

/** Re-fetch at least this often, so an account in an error state can recover. */
const MAX_STALENESS_SECONDS = 30
/** Retry backoff while the main process cannot answer, in seconds. */
const RETRY_BACKOFF_SECONDS = [1, 2, 5, 10, 30]

export function useTotpAccounts() {
  const [accounts, setAccounts] = useState<TotpCodeView[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  /** The last values from the main process, and when they were true. */
  const snapshot = useRef<{ accounts: TotpCodeView[]; at: number }>({ accounts: [], at: 0 })
  const running = useRef<Promise<void> | null>(null)
  const queued = useRef(false)
  const failures = useRef(0)
  const retryAfter = useRef(0)

  const refresh = useCallback((): Promise<void> => {
    // Callers await this as a barrier after a delete or rename. Handing back
    // the in-flight promise rather than resolving immediately keeps that
    // honest, and the queued flag makes the in-flight call run again so the
    // result reflects the mutation rather than predating it.
    if (running.current) {
      queued.current = true
      return running.current
    }

    const run = (async () => {
      try {
        do {
          queued.current = false
          const result = await window.emailAPI.totp.list()
          if (result.error || !result.data) {
            // Swallowing this would render an empty list as "no authenticators
            // yet" — indistinguishable from having none, and wrong.
            setError(result.error?.message ?? 'Could not read your authenticators')
            const wait =
              RETRY_BACKOFF_SECONDS[Math.min(failures.current, RETRY_BACKOFF_SECONDS.length - 1)]
            failures.current++
            // Without this the staleness check below would fire every second
            // for as long as the fault lasts, hammering the credential store.
            retryAfter.current = Date.now() + wait * 1000
            return
          }
          failures.current = 0
          retryAfter.current = 0
          snapshot.current = { accounts: result.data, at: Date.now() }
          setError(null)
          setAccounts(result.data)
        } while (queued.current)
      } finally {
        running.current = null
        queued.current = false
        setIsLoading(false)
      }
    })()

    running.current = run
    return run
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    const tick = (): void => {
      const { accounts: base, at } = snapshot.current
      if (base.length === 0) return

      const now = Date.now()
      const elapsed = Math.floor((now - at) / 1000)

      // The clock stepped backwards (NTP correction, a resumed VM, a manual
      // change). Extrapolating from a future timestamp inflates the countdown
      // and would pin an expired code on screen as live.
      if (elapsed < 0) {
        void refresh()
        return
      }

      let stale = elapsed >= MAX_STALENESS_SECONDS
      const next = base.map((account) => {
        if (account.code === null) return account
        const remaining = account.remainingSeconds - elapsed
        if (remaining > 0) return { ...account, remainingSeconds: remaining }
        stale = true
        // Past its period the code is no longer valid, and showing the last
        // known one would be worse than showing none.
        return { ...account, code: null, remainingSeconds: 0 }
      })

      if (stale && now >= retryAfter.current) {
        void refresh()
        return
      }
      setAccounts(next)
    }

    const timer = setInterval(tick, 1000)
    // Coming back to a window that was in the background is exactly when the
    // displayed countdown is furthest from the truth.
    const onVisible = (): void => {
      if (!document.hidden) void refresh()
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
    }
  }, [refresh])

  const remove = useCallback(
    async (id: string): Promise<string | null> => {
      const result = await window.emailAPI.totp.remove(id)
      await refresh()
      return result.error?.message ?? null
    },
    [refresh]
  )

  const rename = useCallback(
    async (id: string, issuer: string, label: string): Promise<string | null> => {
      const result = await window.emailAPI.totp.rename(id, issuer, label)
      await refresh()
      return result.error?.message ?? null
    },
    [refresh]
  )

  const verify = useCallback(
    async (id: string, code: string): Promise<{ verified: boolean; error: string | null }> => {
      const result = await window.emailAPI.totp.verify(id, code)
      if (result.error || !result.data) {
        return { verified: false, error: result.error?.message ?? 'Could not check that code' }
      }
      if (result.data.verified) await refresh()
      return { verified: result.data.verified, error: null }
    },
    [refresh]
  )

  return { accounts, isLoading, error, refresh, remove, rename, verify }
}
