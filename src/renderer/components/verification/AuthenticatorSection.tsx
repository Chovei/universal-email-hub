import { useState, useCallback } from 'react'
import { AnimatePresence } from 'framer-motion'
import { KeyRound, Copy, Check, Trash2, Plus, AlertTriangle } from 'lucide-react'
import { cn } from '../../lib/utils'
import { useTotpAccounts } from '../../hooks/useTotpAccounts'
import { AddAuthenticatorDialog } from './AddAuthenticatorDialog'
import type { TotpCodeView } from '@shared/types/ipc'

/** Groups digits for readability: 483921 -> 483 921 */
function spaced(code: string): string {
  const mid = Math.ceil(code.length / 2)
  return `${code.slice(0, mid)} ${code.slice(mid)}`
}

function CodeRow({
  account,
  onDelete,
}: {
  account: TotpCodeView
  onDelete: (id: string) => void
}) {
  const [copied, setCopied] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const copy = useCallback(async () => {
    if (!account.code) return
    await navigator.clipboard.writeText(account.code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [account.code])

  const pct = account.period > 0 ? (account.remainingSeconds / account.period) * 100 : 0
  const expiringSoon = account.remainingSeconds <= 5

  return (
    <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-xl p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-6 h-6 rounded-lg bg-[var(--color-primary)]/15 flex items-center justify-center shrink-0">
            <KeyRound className="w-3.5 h-3.5 text-[var(--color-primary)]" />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold text-[var(--color-foreground)] truncate">
              {account.issuer || account.label}
            </div>
            {account.issuer && (
              <div className="text-[11px] text-[var(--color-muted-foreground)] truncate">
                {account.label}
              </div>
            )}
          </div>
        </div>
        {!account.verified && (
          <span
            className="shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-500"
            title="This authenticator has not been confirmed against your app yet"
          >
            UNVERIFIED
          </span>
        )}
      </div>

      {account.error ? (
        <div className="flex items-start gap-2 text-xs text-red-500">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>{account.error}</span>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-3">
            <span
              className={cn(
                'flex-1 font-mono text-3xl font-bold tracking-[0.18em] select-all transition-colors',
                expiringSoon ? 'text-amber-500' : 'text-[var(--color-foreground)]'
              )}
            >
              {account.code ? spaced(account.code) : '—'}
            </span>
            <button
              onClick={() => { void copy() }}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all shrink-0',
                copied
                  ? 'bg-green-500/15 text-green-600'
                  : 'bg-[var(--color-primary)] text-white hover:opacity-90 active:scale-95'
              )}
            >
              {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>

          {/* Time remaining, shown as a bar as well as a number */}
          <div className="flex items-center gap-2">
            <div className="flex-1 h-1 rounded-full bg-[var(--color-muted)] overflow-hidden">
              <div
                className={cn(
                  'h-full rounded-full transition-[width] duration-1000 ease-linear',
                  expiringSoon ? 'bg-amber-500' : 'bg-[var(--color-primary)]'
                )}
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="text-[11px] text-[var(--color-muted-foreground)] tabular-nums shrink-0">
              Expires in {account.remainingSeconds}s
            </span>
          </div>
        </>
      )}

      <div className="flex items-center justify-end gap-1">
        {confirmDelete ? (
          <>
            <span className="text-[11px] text-[var(--color-muted-foreground)] mr-auto">
              Remove this authenticator? You will need the original key to add it back.
            </span>
            <button
              onClick={() => setConfirmDelete(false)}
              className="px-2 py-1 rounded text-xs text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)]"
            >
              Cancel
            </button>
            <button
              onClick={() => onDelete(account.id)}
              className="px-2 py-1 rounded text-xs font-medium bg-red-500/15 text-red-500 hover:bg-red-500/25"
            >
              Remove
            </button>
          </>
        ) : (
          <button
            onClick={() => setConfirmDelete(true)}
            className="p-1 rounded text-[var(--color-muted-foreground)] hover:text-red-500 hover:bg-red-500/10 transition-colors"
            title="Remove authenticator"
            aria-label="Remove authenticator"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  )
}

export function AuthenticatorSection() {
  const { accounts, isLoading, refresh, remove } = useTotpAccounts()
  const [adding, setAdding] = useState(false)

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-[var(--color-foreground)]">
            Authenticator codes
          </h2>
          <p className="text-[11px] text-[var(--color-muted-foreground)]">
            Generated on this computer — these never arrive by email
          </p>
        </div>
        <button
          onClick={() => setAdding(true)}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border border-[var(--color-border)] text-[var(--color-foreground)] hover:bg-[var(--color-accent)] transition-colors shrink-0"
        >
          <Plus className="w-3.5 h-3.5" />
          Add authenticator
        </button>
      </div>

      {!isLoading && accounts.length === 0 ? (
        <p className="text-xs text-[var(--color-muted-foreground)] py-2">
          No authenticators yet. Add one for accounts that use an authenticator app instead of emailed
          codes.
        </p>
      ) : (
        <div className="grid gap-3">
          {accounts.map((a) => (
            <CodeRow key={a.id} account={a} onDelete={(id) => void remove(id)} />
          ))}
        </div>
      )}

      <AnimatePresence>
        {adding && (
          <AddAuthenticatorDialog
            onClose={() => setAdding(false)}
            onAdded={() => void refresh()}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
