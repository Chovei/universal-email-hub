import { useState, useCallback } from 'react'
import { motion } from 'framer-motion'
import { X, ShieldAlert, KeyRound, Loader2, CheckCircle2 } from 'lucide-react'
import { cn } from '../../lib/utils'
import type { TotpAddPayload, TotpAccountMeta, TotpProvisioning } from '@shared/types/ipc'

type Envelope<T> = { data?: T; error?: { code: string; message: string } }

type Step = 'consent' | 'details' | 'verify' | 'done'

export function AddAuthenticatorDialog({
  onClose,
  onAdded,
}: {
  onClose: () => void
  onAdded: () => void
}) {
  const [step, setStep] = useState<Step>('consent')
  const [issuer, setIssuer] = useState('')
  const [label, setLabel] = useState('')
  const [secret, setSecret] = useState('')
  const [advanced, setAdvanced] = useState<Pick<TotpAddPayload, 'algorithm' | 'digits' | 'period'>>({
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
  })
  const [created, setCreated] = useState<TotpAccountMeta | null>(null)
  const [verifyCode, setVerifyCode] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  // Pasting an otpauth:// link fills every field, including the ones most
  // people would otherwise have to guess at.
  const tryParseUri = useCallback(async (value: string) => {
    if (!value.trim().toLowerCase().startsWith('otpauth://')) return false
    const res = (await window.emailAPI.totp.parseUri(value.trim())) as unknown as Envelope<TotpProvisioning>
    if (res.error || !res.data) {
      setError(res.error?.message ?? 'That link could not be read')
      return true
    }
    setSecret(res.data.secret)
    setIssuer(res.data.issuer)
    setLabel(res.data.label)
    setAdvanced({ algorithm: res.data.algorithm, digits: res.data.digits, period: res.data.period })
    setError('')
    return true
  }, [])

  const handleSecretChange = useCallback(
    (value: string) => {
      setSecret(value)
      void tryParseUri(value)
    },
    [tryParseUri]
  )

  const submit = useCallback(async () => {
    setBusy(true)
    setError('')
    const res = (await window.emailAPI.totp.add({
      secret,
      issuer,
      label,
      ...advanced,
    })) as unknown as Envelope<TotpAccountMeta>
    setBusy(false)
    if (res.error || !res.data) {
      setError(res.error?.message ?? 'Could not add this authenticator')
      return
    }
    setCreated(res.data)
    // Wipe the secret from component state the moment it is stored; there is
    // no reason for it to stay in the renderer.
    setSecret('')
    setStep('verify')
  }, [secret, issuer, label, advanced])

  const verify = useCallback(async () => {
    if (!created) return
    setBusy(true)
    setError('')
    const res = (await window.emailAPI.totp.verify(created.id, verifyCode)) as unknown as Envelope<{
      verified: boolean
    }>
    setBusy(false)
    if (res.data?.verified) {
      setStep('done')
      onAdded()
      return
    }
    setError(
      'That code did not match. Check you copied the key correctly, and that this computer’s clock is accurate.'
    )
  }, [created, verifyCode, onAdded])

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.97, y: -6 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97, y: -6 }}
        transition={{ duration: 0.15 }}
        className="w-[460px] max-w-[92vw] rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2.5 px-5 py-4 border-b border-[var(--color-border)]">
          <KeyRound className="w-4 h-4 text-[var(--color-primary)]" />
          <h2 className="flex-1 text-sm font-semibold text-[var(--color-foreground)]">
            Add authenticator
          </h2>
          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-[var(--color-accent)] text-[var(--color-muted-foreground)]"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-4">
          {step === 'consent' && (
            <div className="flex flex-col gap-4">
              <div className="flex gap-3 p-3 rounded-xl bg-amber-500/10 border border-amber-500/25">
                <ShieldAlert className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                <div className="text-xs text-[var(--color-foreground)] leading-relaxed">
                  <p className="font-medium mb-1">Before you continue</p>
                  <p>
                    Email Hub will store this authenticator key encrypted on this computer. Unlike a
                    six-digit code, the key does not expire — anyone who obtains it can generate valid
                    codes for this account indefinitely.
                  </p>
                  <p className="mt-2">
                    Keeping it here also means your email and your second factor live on the same
                    machine, so they no longer protect you independently.
                  </p>
                </div>
              </div>
              <div className="flex gap-2 justify-end">
                <button
                  onClick={onClose}
                  className="px-3 py-1.5 rounded-lg text-sm border border-[var(--color-border)] text-[var(--color-foreground)] hover:bg-[var(--color-accent)]"
                >
                  Cancel
                </button>
                <button
                  onClick={() => setStep('details')}
                  className="px-3 py-1.5 rounded-lg text-sm bg-[var(--color-primary)] text-white hover:opacity-90"
                >
                  I understand, continue
                </button>
              </div>
            </div>
          )}

          {step === 'details' && (
            <div className="flex flex-col gap-3">
              <Field label="Setup key or otpauth:// link">
                <input
                  value={secret}
                  onChange={(e) => handleSecretChange(e.target.value)}
                  placeholder="JBSW Y3DP EHPK 3PXP"
                  autoComplete="off"
                  spellCheck={false}
                  className="w-full px-2.5 py-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] text-sm font-mono text-[var(--color-foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]/40"
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Service">
                  <input
                    value={issuer}
                    onChange={(e) => setIssuer(e.target.value)}
                    placeholder="VRChat"
                    className="w-full px-2.5 py-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] text-sm text-[var(--color-foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]/40"
                  />
                </Field>
                <Field label="Account name">
                  <input
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    placeholder="my-account"
                    className="w-full px-2.5 py-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] text-sm text-[var(--color-foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]/40"
                  />
                </Field>
              </div>

              <details className="text-xs text-[var(--color-muted-foreground)]">
                <summary className="cursor-pointer select-none">Advanced</summary>
                <div className="grid grid-cols-3 gap-2 mt-2">
                  <Field label="Algorithm">
                    <select
                      value={advanced.algorithm}
                      onChange={(e) =>
                        setAdvanced((a) => ({ ...a, algorithm: e.target.value as typeof a.algorithm }))
                      }
                      className="w-full px-2 py-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] text-xs text-[var(--color-foreground)]"
                    >
                      <option>SHA1</option>
                      <option>SHA256</option>
                      <option>SHA512</option>
                    </select>
                  </Field>
                  <Field label="Digits">
                    <input
                      type="number"
                      min={6}
                      max={8}
                      value={advanced.digits}
                      onChange={(e) => setAdvanced((a) => ({ ...a, digits: Number(e.target.value) }))}
                      className="w-full px-2 py-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] text-xs text-[var(--color-foreground)]"
                    />
                  </Field>
                  <Field label="Period (s)">
                    <input
                      type="number"
                      min={15}
                      max={300}
                      value={advanced.period}
                      onChange={(e) => setAdvanced((a) => ({ ...a, period: Number(e.target.value) }))}
                      className="w-full px-2 py-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] text-xs text-[var(--color-foreground)]"
                    />
                  </Field>
                </div>
                <p className="mt-2">Leave these alone unless the service told you otherwise.</p>
              </details>

              {error && <p className="text-xs text-red-500">{error}</p>}

              <div className="flex gap-2 justify-end pt-1">
                <button
                  onClick={onClose}
                  className="px-3 py-1.5 rounded-lg text-sm border border-[var(--color-border)] text-[var(--color-foreground)] hover:bg-[var(--color-accent)]"
                >
                  Cancel
                </button>
                <button
                  onClick={() => void submit()}
                  disabled={busy || !secret.trim() || !label.trim()}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm bg-[var(--color-primary)] text-white hover:opacity-90 disabled:opacity-50"
                >
                  {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  Continue
                </button>
              </div>
            </div>
          )}

          {step === 'verify' && (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-[var(--color-foreground)]">
                Enter the six digits your authenticator is showing right now, so we can confirm the key
                and your clock are both correct.
              </p>
              <input
                value={verifyCode}
                onChange={(e) => setVerifyCode(e.target.value.replace(/\D/g, '').slice(0, 8))}
                placeholder="000000"
                inputMode="numeric"
                autoFocus
                className="w-full px-3 py-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] text-center text-2xl font-mono tracking-[0.3em] text-[var(--color-foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]/40"
              />
              {error && <p className="text-xs text-red-500">{error}</p>}
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => { onAdded(); onClose() }}
                  className="px-3 py-1.5 rounded-lg text-sm border border-[var(--color-border)] text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)]"
                >
                  Skip for now
                </button>
                <button
                  onClick={() => void verify()}
                  disabled={busy || verifyCode.length < 6}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm bg-[var(--color-primary)] text-white hover:opacity-90 disabled:opacity-50"
                >
                  {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  Verify
                </button>
              </div>
            </div>
          )}

          {step === 'done' && (
            <div className="flex flex-col items-center gap-3 py-4">
              <CheckCircle2 className="w-8 h-8 text-emerald-500" />
              <p className="text-sm text-[var(--color-foreground)] text-center">
                Verified. Codes for <span className="font-medium">{issuer || label}</span> now appear in
                your Verification Center.
              </p>
              <button
                onClick={onClose}
                className="px-3 py-1.5 rounded-lg text-sm bg-[var(--color-primary)] text-white hover:opacity-90"
              >
                Done
              </button>
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className={cn('flex flex-col gap-1')}>
      <span className="text-[11px] font-medium text-[var(--color-muted-foreground)]">{label}</span>
      {children}
    </label>
  )
}
