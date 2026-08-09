import { useState, useCallback } from 'react'
import { AnimatePresence } from 'framer-motion'
import { KeyRound, Copy, Check, Trash2, Plus, AlertTriangle, Pencil, ShieldCheck } from 'lucide-react'
import { cn } from '../../lib/utils'
import { useTotpAccounts } from '../../hooks/useTotpAccounts'
import { AddAuthenticatorDialog } from './AddAuthenticatorDialog'
import type { TotpCodeView } from '@shared/types/ipc'

/** Groups digits for readability: 483921 -> 483 921 */
function spaced(code: string): string {
  const mid = Math.ceil(code.length / 2)
  return `${code.slice(0, mid)} ${code.slice(mid)}`
}

type RowMode = 'idle' | 'confirm-delete' | 'rename' | 'verify'

function CodeRow({
  account,
  onDelete,
  onRename,
  onVerify,
}: {
  account: TotpCodeView
  onDelete: (id: string) => Promise<string | null>
  onRename: (id: string, issuer: string, label: string) => Promise<string | null>
  onVerify: (id: string, code: string) => Promise<{ verified: boolean; error: string | null }>
}) {
  const [copied, setCopied] = useState(false)
  const [mode, setMode] = useState<RowMode>('idle')
  const [draft, setDraft] = useState({ issuer: account.issuer, label: account.label })
  const [code, setCode] = useState('')
  const [rowError, setRowError] = useState('')
  const [busy, setBusy] = useState(false)

  const copy = useCallback(async () => {
    if (!account.code) return
    try {
      await navigator.clipboard.writeText(account.code)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard access can be refused when the window is not focused;
      // silently doing nothing looks like a broken button.
      setRowError('Could not copy — select the code and copy it manually')
    }
  }, [account.code])

  const run = useCallback(async (action: () => Promise<string | null>) => {
    setBusy(true)
    setRowError('')
    let failure: string | null
    try {
      failure = await action()
    } catch {
      // The handlers return error envelopes rather than throwing, so this is
      // the bridge itself failing. Without the finally the row's buttons would
      // stay disabled for good, with nothing on screen explaining why.
      failure = 'Email Hub could not reach its background process — try again'
    } finally {
      setBusy(false)
    }
    if (failure) {
      setRowError(failure)
      return false
    }
    setMode('idle')
    return true
  }, [])

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
          <button
            onClick={() => {
              setMode(mode === 'verify' ? 'idle' : 'verify')
              setRowError('')
            }}
            className="shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-500 hover:bg-amber-500/25 transition-colors"
            title="This authenticator has not been checked against the service yet — click to check it now"
          >
            UNVERIFIED
          </button>
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
              aria-label={copied ? 'Code copied' : 'Copy code'}
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

      {mode === 'rename' && (
        <div className="flex flex-col gap-2">
          <div className="grid grid-cols-2 gap-2">
            <input
              value={draft.issuer}
              onChange={(e) => setDraft((d) => ({ ...d, issuer: e.target.value }))}
              placeholder="Service"
              aria-label="Service"
              className="px-2 py-1 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] text-xs text-[var(--color-foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]/40"
            />
            <input
              value={draft.label}
              onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))}
              placeholder="Account name"
              aria-label="Account name"
              autoFocus
              className="px-2 py-1 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] text-xs text-[var(--color-foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]/40"
            />
          </div>
        </div>
      )}

      {mode === 'verify' && (
        <div className="flex flex-col gap-1.5">
          <p className="text-[11px] text-[var(--color-muted-foreground)] leading-relaxed">
            Enter the code the service is showing right now — or compare it with the one above — to
            confirm this key and your clock agree.
          </p>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 8))}
            placeholder="000000"
            inputMode="numeric"
            aria-label="Code to check"
            autoFocus
            className="w-full px-2 py-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] text-center font-mono tracking-[0.25em] text-[var(--color-foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]/40"
          />
        </div>
      )}

      {rowError && <p className="text-[11px] text-red-500">{rowError}</p>}

      <div className="flex items-center justify-end gap-1">
        {mode === 'confirm-delete' && (
          <>
            <span className="text-[11px] text-[var(--color-muted-foreground)] mr-auto">
              Remove this authenticator? You will need the original key to add it back.
            </span>
            <button
              onClick={() => setMode('idle')}
              disabled={busy}
              className="px-2 py-1 rounded text-xs text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)]"
            >
              Cancel
            </button>
            <button
              onClick={() => { void run(() => onDelete(account.id)) }}
              disabled={busy}
              className="px-2 py-1 rounded text-xs font-medium bg-red-500/15 text-red-500 hover:bg-red-500/25 disabled:opacity-50"
            >
              Remove
            </button>
          </>
        )}

        {mode === 'rename' && (
          <>
            <button
              onClick={() => {
                setDraft({ issuer: account.issuer, label: account.label })
                setMode('idle')
              }}
              disabled={busy}
              className="px-2 py-1 rounded text-xs text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)]"
            >
              Cancel
            </button>
            <button
              onClick={() => {
                void run(() => onRename(account.id, draft.issuer.trim(), draft.label.trim()))
              }}
              disabled={busy || !draft.label.trim()}
              className="px-2 py-1 rounded text-xs font-medium bg-[var(--color-primary)] text-white hover:opacity-90 disabled:opacity-50"
            >
              Save
            </button>
          </>
        )}

        {mode === 'verify' && (
          <>
            <button
              onClick={() => { setCode(''); setMode('idle') }}
              disabled={busy}
              className="px-2 py-1 rounded text-xs text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)]"
            >
              Cancel
            </button>
            <button
              onClick={() => {
                void run(async () => {
                  const result = await onVerify(account.id, code)
                  if (result.error) return result.error
                  if (!result.verified) {
                    return 'That code did not match. Check this computer’s clock is accurate.'
                  }
                  setCode('')
                  return null
                })
              }}
              disabled={busy || code.length < 6}
              className="px-2 py-1 rounded text-xs font-medium bg-[var(--color-primary)] text-white hover:opacity-90 disabled:opacity-50"
            >
              Check
            </button>
          </>
        )}

        {mode === 'idle' && (
          <>
            {!account.verified && (
              <button
                onClick={() => { setMode('verify'); setRowError('') }}
                className="p-1 rounded text-[var(--color-muted-foreground)] hover:text-[var(--color-primary)] hover:bg-[var(--color-primary)]/10 transition-colors"
                title="Check this authenticator"
                aria-label="Check this authenticator"
              >
                <ShieldCheck className="w-3.5 h-3.5" />
              </button>
            )}
            <button
              onClick={() => {
                setDraft({ issuer: account.issuer, label: account.label })
                setMode('rename')
                setRowError('')
              }}
              className="p-1 rounded text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] hover:bg-[var(--color-accent)] transition-colors"
              title="Rename authenticator"
              aria-label="Rename authenticator"
            >
              <Pencil className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => { setMode('confirm-delete'); setRowError('') }}
              className="p-1 rounded text-[var(--color-muted-foreground)] hover:text-red-500 hover:bg-red-500/10 transition-colors"
              title="Remove authenticator"
              aria-label="Remove authenticator"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </>
        )}
      </div>
    </div>
  )
}

export function AuthenticatorSection() {
  const { accounts, isLoading, error, refresh, remove, rename, verify } = useTotpAccounts()
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

      {error && (
        <div className="flex items-start gap-2 p-2.5 rounded-lg bg-red-500/10 border border-red-500/25 text-xs text-red-500">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span className="flex-1">{error}</span>
          <button
            onClick={() => void refresh()}
            className="shrink-0 font-medium underline underline-offset-2 hover:no-underline"
          >
            Try again
          </button>
        </div>
      )}

      {isLoading ? (
        <div className="grid gap-3" aria-hidden>
          {[0, 1].map((key) => (
            <div
              key={key}
              className="h-[104px] rounded-xl border border-[var(--color-border)] bg-[var(--color-muted)]/30 animate-pulse"
            />
          ))}
        </div>
      ) : accounts.length === 0 && !error ? (
        <p className="text-xs text-[var(--color-muted-foreground)] py-2">
          No authenticators yet. Add one for accounts that use an authenticator app instead of emailed
          codes.
        </p>
      ) : (
        <div className="grid gap-3">
          {accounts.map((a) => (
            <CodeRow
              key={a.id}
              account={a}
              onDelete={remove}
              onRename={rename}
              onVerify={verify}
            />
          ))}
        </div>
      )}

      <AnimatePresence>
        {adding && (
          <AddAuthenticatorDialog
            onClose={() => { setAdding(false); void refresh() }}
            onAdded={() => void refresh()}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
