import { useState, useEffect, useCallback } from 'react'
import { RefreshCw, Zap } from 'lucide-react'
import { cn } from '../../lib/utils'
import { PROVIDER_META } from '@shared/constants/providers'
import type { ProviderKind } from '@shared/constants/providers'
import type { AccountHealth as AccountHealthRow, SyncStatus } from '@shared/types/db'

const REFRESH_INTERVAL_MS = 15_000

interface Chip {
  label: string
  className: string
}

function statusChip(status: SyncStatus): Chip {
  switch (status.state) {
    case 'paused':
      return { label: 'Paused', className: 'bg-[var(--color-muted)] text-[var(--color-muted-foreground)]' }
    case 'syncing':
      return { label: 'Syncing…', className: 'bg-blue-500/15 text-blue-500' }
    case 'error':
      switch (status.errorCategory) {
        case 'auth':
          return { label: 'Needs reconnect', className: 'bg-red-500/15 text-red-500' }
        case 'network':
          return { label: 'Server unreachable', className: 'bg-amber-500/15 text-amber-500' }
        case 'rate-limit':
          return { label: 'Rate limited', className: 'bg-amber-500/15 text-amber-500' }
        default:
          return { label: 'Sync error', className: 'bg-red-500/15 text-red-500' }
      }
    default:
      return { label: 'Connected ✓', className: 'bg-emerald-500/15 text-emerald-500' }
  }
}

function relativeTime(ts: number | undefined): string {
  if (!ts) return 'never'
  const diff = Date.now() - ts
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)} min ago`
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)} h ago`
  return `${Math.round(diff / 86_400_000)} d ago`
}

export function AccountHealthList() {
  const [rows, setRows] = useState<AccountHealthRow[]>([])
  const [reconnecting, setReconnecting] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const result = await window.emailAPI.accounts.health()
    const data = (result as unknown as { data?: AccountHealthRow[] }).data
    if (data) setRows(data)
  }, [])

  useEffect(() => {
    void refresh()
    const interval = setInterval(() => void refresh(), REFRESH_INTERVAL_MS)
    // Live status updates between polls
    const unsubscribe = window.emailAPI.accounts.onSyncStatusChanged(({ accountId, status }) => {
      setRows((prev) => prev.map((r) => (r.accountId === accountId ? { ...r, status } : r)))
    })
    return () => {
      clearInterval(interval)
      unsubscribe()
    }
  }, [refresh])

  const reconnect = async (accountId: string) => {
    setReconnecting(accountId)
    try {
      await window.emailAPI.accounts.reconnect(accountId)
    } finally {
      setReconnecting(null)
    }
  }

  if (rows.length === 0) {
    return (
      <p className="text-sm text-[var(--color-muted-foreground)]">
        No active accounts yet — add one to see its health here.
      </p>
    )
  }

  return (
    <div className="flex flex-col divide-y divide-[var(--color-border)]">
      {rows.map((row) => {
        const chip = statusChip(row.status)
        const providerLabel =
          PROVIDER_META[row.provider as ProviderKind]?.label ?? row.provider
        return (
          <div key={row.accountId} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-[var(--color-foreground)] truncate">
                  {row.email}
                </span>
                <span
                  className={cn(
                    'shrink-0 px-2 py-0.5 rounded-full text-[10px] font-semibold',
                    chip.className
                  )}
                >
                  {chip.label}
                </span>
                {row.status.realtime && (
                  <span
                    className="shrink-0 flex items-center gap-0.5 text-[10px] font-medium text-emerald-500"
                    title="Real-time connection active — new mail arrives instantly"
                  >
                    <Zap className="w-3 h-3" />
                    Live
                  </span>
                )}
              </div>
              <div className="text-[11px] text-[var(--color-muted-foreground)] truncate mt-0.5">
                {providerLabel} · {row.messageCount.toLocaleString()} emails
                {row.unreadCount > 0 && ` (${row.unreadCount.toLocaleString()} unread)`}
                {' · '}synced {relativeTime(row.status.lastSyncAt)}
                {typeof row.status.lastSyncDurationMs === 'number' &&
                  ` in ${(row.status.lastSyncDurationMs / 1000).toFixed(1)}s`}
              </div>
              {row.status.state === 'error' && row.status.lastError && (
                <div className="text-[11px] text-red-500 mt-1">{row.status.lastError}</div>
              )}
            </div>
            {row.status.state === 'error' && (
              <button
                onClick={() => void reconnect(row.accountId)}
                disabled={reconnecting === row.accountId}
                className="shrink-0 flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-[var(--color-border)] text-xs text-[var(--color-foreground)] hover:bg-[var(--color-accent)] transition-colors disabled:opacity-50"
              >
                <RefreshCw
                  className={cn('w-3 h-3', reconnecting === row.accountId && 'animate-spin')}
                />
                Retry
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}
