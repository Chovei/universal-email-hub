import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, ChevronRight, Loader2, CheckCircle2, XCircle, ExternalLink, ArrowLeft, Info } from 'lucide-react'
import { cn } from '../../lib/utils'
import type { ProviderKind } from '@shared/constants/providers'
import type { VerifyAccountPayload, VerifyAccountResult, AddAccountPayload } from '@shared/types/ipc'
import type { AccountRow } from '@shared/types/db'

// ── Provider definitions ───────────────────────────────────────────────────────

interface WizardProvider {
  id: ProviderKind
  label: string
  description: string
  color: string
  passwordLabel: string
  requiresAppPassword: boolean
  imapHost: string
  imapPort: string
  imapSecurity: string
  smtpHost: string
  smtpPort: string
  smtpSecurity: string
  note?: string
  instructions: string[]
  helpLinks?: Array<{ url: string; text: string }>
  isCustom?: boolean
}

const WIZARD_PROVIDERS: WizardProvider[] = [
  {
    id: 'gmail',
    label: 'Gmail',
    description: 'Google accounts — uses App Password',
    color: '#EA4335',
    passwordLabel: 'App Password',
    requiresAppPassword: true,
    imapHost: 'imap.gmail.com',
    imapPort: '993',
    imapSecurity: 'TLS',
    smtpHost: 'smtp.gmail.com',
    smtpPort: '587',
    smtpSecurity: 'STARTTLS',
    note: 'Sign into the Gmail you\'re adding in your browser first — Google opens these pages for whichever account is currently active.',
    instructions: [
      'Turn on 2-Step Verification (skip this if it\'s already on)',
      'Create an App Password and name it "Email Hub"',
      'Copy the 16-character code and paste it in the Password field below',
    ],
    helpLinks: [
      { url: 'https://myaccount.google.com/signinoptions/two-step-verification', text: 'Step 1: Enable 2-Step Verification ↗' },
      { url: 'https://myaccount.google.com/apppasswords', text: 'Step 2: Create App Password ↗' },
    ],
  },
  {
    id: 'outlook',
    label: 'Outlook / Hotmail',
    description: 'outlook.com · hotmail.com · live.com',
    color: '#0078D4',
    passwordLabel: 'Password',
    requiresAppPassword: false,
    imapHost: 'outlook.office365.com',
    imapPort: '993',
    imapSecurity: 'TLS',
    smtpHost: 'smtp.office365.com',
    smtpPort: '587',
    smtpSecurity: 'STARTTLS',
    instructions: [
      'Use your full Microsoft account email and regular password',
      'If you have 2-factor authentication: go to account.microsoft.com → Security → Advanced security options → App passwords',
      'Create one named "Email Hub" and use that password below',
    ],
    helpLinks: [{ url: 'https://account.microsoft.com/security', text: 'Open Microsoft Account Security ↗' }],
  },
  {
    id: 'icloud',
    label: 'iCloud Mail',
    description: 'icloud.com · me.com · mac.com',
    color: '#1D7AE0',
    passwordLabel: 'App-Specific Password',
    requiresAppPassword: true,
    imapHost: 'imap.mail.me.com',
    imapPort: '993',
    imapSecurity: 'TLS',
    smtpHost: 'smtp.mail.me.com',
    smtpPort: '587',
    smtpSecurity: 'STARTTLS',
    instructions: [
      'Go to appleid.apple.com → Sign-In and Security → App-Specific Passwords',
      'Click Generate App-Specific Password and name it "Email Hub"',
      'Enter your full iCloud email address and the generated password below',
    ],
    helpLinks: [{ url: 'https://appleid.apple.com/account/manage', text: 'Open Apple ID ↗' }],
  },
  {
    id: 'yahoo',
    label: 'Yahoo Mail',
    description: 'yahoo.com accounts — uses App Password',
    color: '#6001D2',
    passwordLabel: 'App Password',
    requiresAppPassword: true,
    imapHost: 'imap.mail.yahoo.com',
    imapPort: '993',
    imapSecurity: 'TLS',
    smtpHost: 'smtp.mail.yahoo.com',
    smtpPort: '465',
    smtpSecurity: 'TLS',
    instructions: [
      'Go to Yahoo Account Security (link below)',
      'Click "Generate app password", choose Other, name it "Email Hub"',
      'Use that password below — your regular Yahoo password will not work',
    ],
    helpLinks: [{ url: 'https://login.yahoo.com/account/security', text: 'Open Yahoo Account Security ↗' }],
  },
  {
    id: 'fastmail',
    label: 'Fastmail',
    description: 'Fastmail accounts',
    color: '#E36B00',
    passwordLabel: 'Password',
    requiresAppPassword: false,
    imapHost: 'imap.fastmail.com',
    imapPort: '993',
    imapSecurity: 'TLS',
    smtpHost: 'smtp.fastmail.com',
    smtpPort: '465',
    smtpSecurity: 'TLS',
    instructions: [
      'Use your Fastmail email and password',
      'For better security, create a dedicated App Password under Settings → Privacy & Security → App Passwords',
    ],
  },
  {
    id: 'zoho',
    label: 'Zoho Mail',
    description: 'Zoho Mail accounts',
    color: '#E42527',
    passwordLabel: 'Password',
    requiresAppPassword: false,
    imapHost: 'imappro.zoho.com',
    imapPort: '993',
    imapSecurity: 'TLS',
    smtpHost: 'smtppro.zoho.com',
    smtpPort: '465',
    smtpSecurity: 'TLS',
    instructions: [
      'Use your Zoho Mail email and password',
      'Make sure IMAP is enabled: Zoho Mail Settings → Mail Accounts → IMAP/POP Access',
    ],
  },
  {
    id: 'imap',
    label: 'Custom IMAP',
    description: 'Any IMAP / SMTP email server',
    color: '#6366F1',
    passwordLabel: 'Password',
    requiresAppPassword: false,
    imapHost: '',
    imapPort: '993',
    imapSecurity: 'TLS',
    smtpHost: '',
    smtpPort: '465',
    smtpSecurity: 'TLS',
    instructions: [
      'Enter your IMAP and SMTP server details below',
      'Contact your email provider or IT administrator for the correct server settings',
    ],
    isCustom: true,
  },
]

// ── Form state ─────────────────────────────────────────────────────────────────

interface FormState {
  username: string
  password: string
  host: string
  port: string
  security: string
  smtpHost: string
  smtpPort: string
  smtpSecurity: string
}

function defaultForm(p: WizardProvider): FormState {
  return {
    username: '',
    password: '',
    host: p.imapHost,
    port: p.imapPort,
    security: p.imapSecurity,
    smtpHost: p.smtpHost,
    smtpPort: p.smtpPort,
    smtpSecurity: p.smtpSecurity,
  }
}

// ── Connecting step ────────────────────────────────────────────────────────────

type ConnectPhase = 'verifying' | 'adding' | 'syncing' | 'done' | 'error'

const STEP_LABELS = ['Testing credentials', 'Saving account', 'Syncing inbox']

function stepIndicatorState(
  step: number,
  phase: ConnectPhase,
  errorStep: number
): 'pending' | 'loading' | 'success' | 'error' {
  if (phase === 'error') {
    if (step < errorStep) return 'success'
    if (step === errorStep) return 'error'
    return 'pending'
  }
  const active = { verifying: 0, adding: 1, syncing: 2, done: 3 }[phase] ?? 3
  if (step < active) return 'success'
  if (step === active) return 'loading'
  return 'pending'
}

function StepRow({
  label,
  state,
  extra,
}: {
  label: string
  state: 'pending' | 'loading' | 'success' | 'error'
  extra?: string
}) {
  return (
    <div className="flex items-center gap-3">
      <div className="w-6 h-6 flex items-center justify-center shrink-0">
        {state === 'loading' && <Loader2 className="w-5 h-5 text-[var(--color-primary)] animate-spin" />}
        {state === 'success' && <CheckCircle2 className="w-5 h-5 text-green-500" />}
        {state === 'error' && <XCircle className="w-5 h-5 text-red-500" />}
        {state === 'pending' && <div className="w-2.5 h-2.5 rounded-full bg-[var(--color-border)]" />}
      </div>
      <span
        className={cn(
          'text-sm',
          state === 'pending' && 'text-[var(--color-muted-foreground)]',
          (state === 'loading' || state === 'success') && 'text-[var(--color-foreground)]',
          state === 'error' && 'text-red-500 font-medium'
        )}
      >
        {label}
        {extra && <span className="font-normal text-[var(--color-muted-foreground)] ml-1.5">{extra}</span>}
      </span>
    </div>
  )
}

function ConnectingStep({
  provider,
  form,
  onRetry,
  onDone,
}: {
  provider: WizardProvider
  form: FormState
  onRetry: () => void
  onDone: () => void
}) {
  const [phase, setPhase] = useState<ConnectPhase>('verifying')
  const [errorMsg, setErrorMsg] = useState('')
  const [errorStep, setErrorStep] = useState(0)
  const [syncedCount, setSyncedCount] = useState(0)

  useEffect(() => {
    let cancelled = false
    const cleanups: Array<() => void> = []

    async function run(): Promise<void> {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      type Env<T> = { data?: T; error?: { code: string; message: string } }

      const creds = {
        username: form.username,
        password: form.password,
        host: form.host,
        port: parseInt(form.port) || 993,
        security: form.security as 'TLS' | 'STARTTLS' | 'NONE',
        smtpHost: form.smtpHost,
        smtpPort: parseInt(form.smtpPort) || 465,
        smtpSecurity: form.smtpSecurity as 'TLS' | 'STARTTLS' | 'NONE',
      }

      // ── Step 0: Verify credentials ─────────────────────────────────────────
      const verifyPayload: VerifyAccountPayload = { provider: provider.id, credentials: creds }
      const vRes = await (
        window.emailAPI.accounts.verify(verifyPayload) as unknown as Promise<Env<VerifyAccountResult>>
      )
      if (cancelled) return

      if (!vRes.data?.success) {
        setErrorMsg(vRes.data?.error ?? vRes.error?.message ?? 'Connection failed')
        setErrorStep(0)
        setPhase('error')
        return
      }

      // ── Step 1: Add account ────────────────────────────────────────────────
      setPhase('adding')
      const addPayload: AddAccountPayload = { provider: provider.id, credentials: creds }
      const aRes = await (
        window.emailAPI.accounts.add(addPayload) as unknown as Promise<Env<AccountRow>>
      )
      if (cancelled) return

      if (aRes.error) {
        setErrorMsg(aRes.error.message)
        setErrorStep(1)
        setPhase('error')
        return
      }

      const accountId = aRes.data!.id

      // ── Step 2: Watch sync progress ────────────────────────────────────────
      setPhase('syncing')
      let count = 0

      cleanups.push(
        window.emailAPI.accounts.onSyncStatusChanged(({ accountId: aid, status }) => {
          if (aid !== accountId) return
          if ((status.state === 'idle' || status.state === 'error') && !cancelled) {
            setPhase('done')
          }
        })
      )

      cleanups.push(
        window.emailAPI.messages.onNew(({ threads, accountId: aid }) => {
          if (aid !== accountId) return
          count += threads.length
          if (!cancelled) setSyncedCount(count)
        })
      )

      // Race guard: sync may have already finished before we subscribed
      const sRes = await (
        window.emailAPI.sync.getStatus() as unknown as Promise<
          Env<Record<string, { state: string }>>
        >
      )
      if (!cancelled) {
        const s = sRes.data?.[accountId]?.state
        if (s === 'idle' || s === 'error') setPhase('done')
      }
    }

    void run()
    return () => {
      cancelled = true
      cleanups.forEach((fn) => fn())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const isDone = phase === 'done'
  const isError = phase === 'error'

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-base font-semibold text-[var(--color-foreground)] mb-0.5">
          {isError ? 'Connection failed' : isDone ? 'Account added!' : 'Connecting to your account…'}
        </h2>
        <p className="text-sm text-[var(--color-muted-foreground)]">
          {isError
            ? 'Check the error below and try again.'
            : isDone
            ? `${provider.label} is syncing in the background.`
            : 'This usually takes under 30 seconds.'}
        </p>
      </div>

      <div className="flex flex-col gap-4">
        {STEP_LABELS.map((label, i) => (
          <StepRow
            key={label}
            label={label}
            state={stepIndicatorState(i, phase, errorStep)}
            extra={i === 2 && syncedCount > 0 ? `(${syncedCount.toLocaleString()} messages)` : undefined}
          />
        ))}
      </div>

      {isError && (
        <div className="bg-red-500/8 border border-red-500/20 rounded-xl px-4 py-3 text-sm text-red-600 dark:text-red-400">
          {errorMsg}
        </div>
      )}

      <div className="flex flex-col gap-2 pt-1">
        {isDone && (
          <button
            onClick={onDone}
            className="w-full py-2.5 px-4 rounded-lg bg-[var(--color-primary)] text-white text-sm font-medium hover:opacity-90 transition-opacity"
          >
            Done
          </button>
        )}
        {isError && (
          <button
            onClick={onRetry}
            className="w-full py-2.5 px-4 rounded-lg border border-[var(--color-border)] text-[var(--color-foreground)] text-sm font-medium hover:bg-[var(--color-accent)] transition-colors"
          >
            Try different credentials
          </button>
        )}
      </div>
    </div>
  )
}

// ── Server settings sub-form ───────────────────────────────────────────────────

function ServerSettingsFields({
  form,
  updateForm,
}: {
  form: FormState
  updateForm: (field: keyof FormState, value: string) => void
}) {
  const inputClass =
    'px-2.5 py-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] text-xs text-[var(--color-foreground)] placeholder:text-[var(--color-muted-foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]/40 focus:border-[var(--color-primary)] w-full'
  const selectClass = inputClass

  return (
    <div className="flex flex-col gap-3 p-3 border border-[var(--color-border)] rounded-xl bg-[var(--color-background)]/60">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--color-muted-foreground)]">
        IMAP (incoming)
      </p>
      <div className="grid grid-cols-[1fr_80px] gap-2">
        <div>
          <p className="text-[11px] text-[var(--color-muted-foreground)] mb-1">Host</p>
          <input
            value={form.host}
            onChange={(e) => updateForm('host', e.target.value)}
            placeholder="imap.example.com"
            className={inputClass}
          />
        </div>
        <div>
          <p className="text-[11px] text-[var(--color-muted-foreground)] mb-1">Port</p>
          <input
            value={form.port}
            onChange={(e) => updateForm('port', e.target.value)}
            placeholder="993"
            className={inputClass}
          />
        </div>
      </div>
      <div>
        <p className="text-[11px] text-[var(--color-muted-foreground)] mb-1">Security</p>
        <select
          value={form.security}
          onChange={(e) => updateForm('security', e.target.value)}
          className={selectClass}
        >
          <option value="TLS">TLS / SSL (recommended)</option>
          <option value="STARTTLS">STARTTLS</option>
          <option value="NONE">None</option>
        </select>
      </div>

      <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--color-muted-foreground)] mt-1">
        SMTP (outgoing)
      </p>
      <div className="grid grid-cols-[1fr_80px] gap-2">
        <div>
          <p className="text-[11px] text-[var(--color-muted-foreground)] mb-1">Host</p>
          <input
            value={form.smtpHost}
            onChange={(e) => updateForm('smtpHost', e.target.value)}
            placeholder="smtp.example.com"
            className={inputClass}
          />
        </div>
        <div>
          <p className="text-[11px] text-[var(--color-muted-foreground)] mb-1">Port</p>
          <input
            value={form.smtpPort}
            onChange={(e) => updateForm('smtpPort', e.target.value)}
            placeholder="465"
            className={inputClass}
          />
        </div>
      </div>
      <div>
        <p className="text-[11px] text-[var(--color-muted-foreground)] mb-1">Security</p>
        <select
          value={form.smtpSecurity}
          onChange={(e) => updateForm('smtpSecurity', e.target.value)}
          className={selectClass}
        >
          <option value="TLS">TLS / SSL (recommended)</option>
          <option value="STARTTLS">STARTTLS</option>
          <option value="NONE">None</option>
        </select>
      </div>
    </div>
  )
}

// ── Main wizard ────────────────────────────────────────────────────────────────

interface AddAccountWizardProps {
  onClose: () => void
  onSuccess?: () => void
  onGoToSettings?: () => void
}

type Step = 'provider' | 'auth' | 'connecting'

export function AddAccountWizard({ onClose, onSuccess }: AddAccountWizardProps) {
  const [step, setStep] = useState<Step>('provider')
  const [provider, setProvider] = useState<WizardProvider | null>(null)
  const [form, setForm] = useState<FormState>({
    username: '',
    password: '',
    host: '',
    port: '993',
    security: 'TLS',
    smtpHost: '',
    smtpPort: '465',
    smtpSecurity: 'TLS',
  })
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const selectProvider = useCallback((p: WizardProvider) => {
    setProvider(p)
    setForm(defaultForm(p))
    setShowAdvanced(false)
    setFormError(null)
    setStep('auth')
  }, [])

  const updateForm = useCallback((field: keyof FormState, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }))
    setFormError(null)
  }, [])

  const handleConnect = useCallback(() => {
    if (!provider) return
    if (!form.username.trim()) { setFormError('Email address is required'); return }
    if (!form.password.trim()) { setFormError(`${provider.passwordLabel} is required`); return }
    if (provider.isCustom) {
      if (!form.host.trim()) { setFormError('IMAP host is required'); return }
      if (!form.smtpHost.trim()) { setFormError('SMTP host is required'); return }
    }
    setFormError(null)
    setStep('connecting')
  }, [provider, form])

  const handleDone = useCallback(() => {
    onSuccess?.()
    onClose()
  }, [onSuccess, onClose])

  const handleRetry = useCallback(() => {
    setStep('auth')
  }, [])

  const openExternal = useCallback((url: string) => {
    void window.emailAPI.shell.openExternal(url)
  }, [])

  const isConnecting = step === 'connecting'

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isConnecting) onClose()
      }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 8 }}
        transition={{ duration: 0.14 }}
        className="relative bg-[var(--color-card)] border border-[var(--color-border)] rounded-2xl shadow-2xl w-full max-w-md mx-4 max-h-[90vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-2 px-5 py-4 border-b border-[var(--color-border)] shrink-0">
          {step === 'auth' && (
            <button
              onClick={() => setStep('provider')}
              className="p-1.5 rounded-lg hover:bg-[var(--color-accent)] transition-colors text-[var(--color-muted-foreground)] shrink-0"
              aria-label="Back"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
          )}
          <div className="flex items-center gap-2 flex-1 min-w-0">
            {provider && step !== 'provider' && (
              <div
                className="w-4 h-4 rounded-full shrink-0"
                style={{ backgroundColor: provider.color }}
              />
            )}
            <h1 className="text-sm font-semibold text-[var(--color-foreground)] truncate">
              {step === 'provider' ? 'Add Email Account' : (provider?.label ?? 'Add Account')}
            </h1>
          </div>
          {!isConnecting && (
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-[var(--color-accent)] transition-colors text-[var(--color-muted-foreground)] shrink-0"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-5">
          <AnimatePresence mode="wait" initial={false}>
            {/* ── Provider selection ─────────────────────────────────────── */}
            {step === 'provider' && (
              <motion.div
                key="provider"
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 10 }}
                transition={{ duration: 0.12 }}
                className="flex flex-col gap-2"
              >
                <p className="text-sm text-[var(--color-muted-foreground)] mb-2">
                  Choose your email provider to get started.
                </p>
                {WIZARD_PROVIDERS.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => selectProvider(p)}
                    className="flex items-center gap-3 px-3.5 py-2.5 rounded-xl border border-[var(--color-border)] hover:border-[var(--color-primary)]/40 hover:bg-[var(--color-accent)] transition-all text-left group"
                  >
                    <div
                      className="w-7 h-7 rounded-full flex items-center justify-center shrink-0"
                      style={{ backgroundColor: p.color + '18', border: `1.5px solid ${p.color}35` }}
                    >
                      <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: p.color }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-[var(--color-foreground)] leading-tight">{p.label}</p>
                      <p className="text-xs text-[var(--color-muted-foreground)] truncate leading-tight">{p.description}</p>
                    </div>
                    <ChevronRight className="w-3.5 h-3.5 text-[var(--color-muted-foreground)] group-hover:text-[var(--color-foreground)] transition-colors shrink-0" />
                  </button>
                ))}
              </motion.div>
            )}

            {/* ── Credentials form ───────────────────────────────────────── */}
            {step === 'auth' && provider && (
              <motion.div
                key="auth"
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }}
                transition={{ duration: 0.12 }}
                className="flex flex-col gap-4"
              >
                {/* Instructions */}
                <div className="bg-[var(--color-accent)]/60 border border-[var(--color-border)] rounded-xl px-4 py-3 flex flex-col gap-2">
                  <div className="flex items-center gap-1.5">
                    <Info className="w-3.5 h-3.5 text-[var(--color-primary)] shrink-0" />
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-foreground)]">
                      {provider.requiresAppPassword ? 'App Password Required' : 'How to connect'}
                    </span>
                  </div>
                  {provider.note && (
                    <p className="text-xs bg-amber-500/10 border border-amber-500/20 text-amber-700 dark:text-amber-400 rounded-lg px-2.5 py-2 leading-snug">
                      {provider.note}
                    </p>
                  )}
                  <ol className="flex flex-col gap-1.5">
                    {provider.instructions.map((line, i) => (
                      <li key={i} className="flex gap-1.5 text-xs text-[var(--color-muted-foreground)] leading-snug">
                        <span className="shrink-0 font-semibold text-[var(--color-foreground)]">{i + 1}.</span>
                        <span>{line}</span>
                      </li>
                    ))}
                  </ol>
                  {provider.helpLinks && provider.helpLinks.length > 0 && (
                    <div className="flex flex-col gap-1 pt-0.5">
                      {provider.helpLinks.map((link) => (
                        <button
                          key={link.url}
                          type="button"
                          onClick={() => openExternal(link.url)}
                          className="flex items-center gap-1 text-xs text-[var(--color-primary)] hover:underline font-medium w-fit"
                        >
                          <ExternalLink className="w-3 h-3 shrink-0" />
                          {link.text}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Fields */}
                <div className="flex flex-col gap-3">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-medium text-[var(--color-foreground)]">
                      Email address
                    </label>
                    <input
                      type="email"
                      autoComplete="email"
                      placeholder="you@example.com"
                      value={form.username}
                      onChange={(e) => updateForm('username', e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] text-sm text-[var(--color-foreground)] placeholder:text-[var(--color-muted-foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30 focus:border-[var(--color-primary)] transition-shadow"
                    />
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-medium text-[var(--color-foreground)]">
                      {provider.passwordLabel}
                    </label>
                    <input
                      type="password"
                      autoComplete="current-password"
                      placeholder={provider.requiresAppPassword ? '16-character app password' : 'Password'}
                      value={form.password}
                      onChange={(e) => updateForm('password', e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') handleConnect() }}
                      className="w-full px-3 py-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] text-sm text-[var(--color-foreground)] placeholder:text-[var(--color-muted-foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30 focus:border-[var(--color-primary)] transition-shadow"
                    />
                  </div>

                  {/* Server settings */}
                  {provider.isCustom ? (
                    <ServerSettingsFields form={form} updateForm={updateForm} />
                  ) : (
                    <div>
                      <button
                        type="button"
                        onClick={() => setShowAdvanced((v) => !v)}
                        className="text-xs text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] transition-colors"
                      >
                        {showAdvanced ? '▾' : '▸'} Advanced server settings
                      </button>
                      {showAdvanced && (
                        <div className="mt-3">
                          <ServerSettingsFields form={form} updateForm={updateForm} />
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {formError && (
                  <p className="text-xs text-red-500 font-medium">{formError}</p>
                )}

                <button
                  onClick={handleConnect}
                  className="w-full py-2.5 px-4 rounded-lg bg-[var(--color-primary)] text-white text-sm font-medium hover:opacity-90 active:opacity-80 transition-opacity"
                >
                  Connect Account
                </button>
              </motion.div>
            )}

            {/* ── Connecting / progress ──────────────────────────────────── */}
            {step === 'connecting' && provider && (
              <motion.div
                key="connecting"
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }}
                transition={{ duration: 0.12 }}
              >
                <ConnectingStep
                  provider={provider}
                  form={form}
                  onRetry={handleRetry}
                  onDone={handleDone}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </div>
  )
}
