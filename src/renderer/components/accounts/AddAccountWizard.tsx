import { useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, ChevronRight, Mail, Loader2, CheckCircle2, AlertCircle } from 'lucide-react'
import { cn } from '../../lib/utils'
import type { ProviderKind } from '@shared/constants/providers'

interface AddAccountWizardProps {
  onClose: () => void
  onSuccess?: () => void
}

type Step = 'provider' | 'auth' | 'success'

interface ProviderOption {
  id: ProviderKind
  label: string
  description: string
  authType: 'oauth' | 'imap'
  color: string
}

const PROVIDERS: ProviderOption[] = [
  { id: 'gmail', label: 'Gmail', description: 'Google personal & Workspace', authType: 'oauth', color: '#EA4335' },
  { id: 'graph', label: 'Microsoft 365 / Outlook', description: 'Office 365 & Hotmail', authType: 'oauth', color: '#0078D4' },
  { id: 'icloud', label: 'iCloud Mail', description: 'Apple iCloud email', authType: 'imap', color: '#1D7AE0' },
  { id: 'yahoo', label: 'Yahoo Mail', description: 'Yahoo & AOL Mail', authType: 'imap', color: '#720E9E' },
  { id: 'fastmail', label: 'Fastmail', description: 'Fastmail accounts', authType: 'imap', color: '#3256CB' },
  { id: 'zoho', label: 'Zoho Mail', description: 'Zoho business email', authType: 'imap', color: '#E61E25' },
  { id: 'imap', label: 'Custom IMAP', description: 'Any standard IMAP/SMTP server', authType: 'imap', color: '#71717A' },
]

export function AddAccountWizard({ onClose, onSuccess }: AddAccountWizardProps) {
  const [step, setStep] = useState<Step>('provider')
  const [selectedProvider, setSelectedProvider] = useState<ProviderOption | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // IMAP form state
  const [imapForm, setImapForm] = useState({
    username: '',
    password: '',
    host: '',
    port: '993',
    security: 'TLS' as 'TLS' | 'STARTTLS' | 'NONE',
    smtpHost: '',
    smtpPort: '587',
    smtpSecurity: 'STARTTLS' as 'TLS' | 'STARTTLS' | 'NONE',
  })

  const handleProviderSelect = (provider: ProviderOption) => {
    setSelectedProvider(provider)
    setStep('auth')
    setError(null)
  }

  const handleOAuthConnect = useCallback(async () => {
    if (!selectedProvider) return
    setIsLoading(true)
    setError(null)
    try {
      await window.emailAPI.accounts.oauthStart(selectedProvider.id as 'gmail' | 'graph')
      setStep('success')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Authentication failed')
    } finally {
      setIsLoading(false)
    }
  }, [selectedProvider])

  const handleImapConnect = useCallback(async () => {
    if (!selectedProvider) return
    if (!imapForm.username || !imapForm.password) {
      setError('Email and password are required')
      return
    }
    setIsLoading(true)
    setError(null)
    try {
      await window.emailAPI.accounts.add({
        provider: selectedProvider.id,
        credentials: {
          username: imapForm.username,
          password: imapForm.password,
          host: imapForm.host || defaultImapHost(selectedProvider.id),
          port: parseInt(imapForm.port) || 993,
          security: imapForm.security,
          smtpHost: imapForm.smtpHost || defaultSmtpHost(selectedProvider.id),
          smtpPort: parseInt(imapForm.smtpPort) || 587,
          smtpSecurity: imapForm.smtpSecurity,
        },
      })
      setStep('success')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Connection failed. Check your credentials.')
    } finally {
      setIsLoading(false)
    }
  }, [selectedProvider, imapForm])

  const handleDone = () => {
    onSuccess?.()
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Dialog */}
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 8 }}
        transition={{ duration: 0.18, ease: 'easeOut' }}
        className="relative w-full max-w-md bg-[var(--color-card)] rounded-[var(--radius-2xl)] shadow-2xl border border-[var(--color-border)] overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--color-border)]">
          <h2 className="text-base font-semibold text-[var(--color-foreground)]">
            {step === 'provider' && 'Add Account'}
            {step === 'auth' && selectedProvider?.label}
            {step === 'success' && 'Account Added'}
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-[var(--radius-md)] hover:bg-[var(--color-muted)] transition-colors text-[var(--color-muted-foreground)]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <AnimatePresence mode="wait">
          {step === 'provider' && (
            <motion.div
              key="provider"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.15 }}
              className="p-4"
            >
              <p className="text-sm text-[var(--color-muted-foreground)] mb-4 px-2">
                Choose your email provider to get started.
              </p>
              <div className="space-y-1">
                {PROVIDERS.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => handleProviderSelect(p)}
                    className="w-full flex items-center gap-3 px-3 py-3 rounded-[var(--radius-lg)] hover:bg-[var(--color-muted)] transition-colors text-left group"
                  >
                    <div
                      className="w-8 h-8 rounded-[var(--radius-md)] flex items-center justify-center shrink-0"
                      style={{ backgroundColor: p.color + '20', color: p.color }}
                    >
                      <Mail className="w-4 h-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-[var(--color-foreground)]">{p.label}</p>
                      <p className="text-xs text-[var(--color-muted-foreground)]">{p.description}</p>
                    </div>
                    <ChevronRight className="w-4 h-4 text-[var(--color-muted-foreground)] opacity-0 group-hover:opacity-100 transition-opacity" />
                  </button>
                ))}
              </div>
            </motion.div>
          )}

          {step === 'auth' && selectedProvider && (
            <motion.div
              key="auth"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.15 }}
              className="p-6"
            >
              {selectedProvider.authType === 'oauth' ? (
                <div className="text-center py-4">
                  <div
                    className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4"
                    style={{ backgroundColor: selectedProvider.color + '20', color: selectedProvider.color }}
                  >
                    <Mail className="w-8 h-8" />
                  </div>
                  <p className="text-sm text-[var(--color-muted-foreground)] mb-2">
                    Sign in with your {selectedProvider.label} account. A browser window will open
                    to complete authorization.
                  </p>
                  {isLoading && (
                    <p className="text-xs text-[var(--color-muted-foreground)] mb-4">
                      Waiting for you to complete sign-in in the browser…
                    </p>
                  )}
                  {error && <ErrorMessage message={error} />}
                  <button
                    onClick={() => void handleOAuthConnect()}
                    disabled={isLoading}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-[var(--radius-lg)] text-white text-sm font-medium transition-opacity disabled:opacity-60"
                    style={{ backgroundColor: selectedProvider.color }}
                  >
                    {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                    {isLoading ? 'Authorizing…' : `Sign in with ${selectedProvider.label}`}
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="text-sm text-[var(--color-muted-foreground)] mb-2">
                    Enter your {selectedProvider.label} credentials.
                    {selectedProvider.id === 'icloud' && (
                      <span className="block mt-1 text-xs">
                        Use an app-specific password from appleid.apple.com
                      </span>
                    )}
                  </p>
                  <FormField
                    label="Email / Username"
                    type="email"
                    placeholder="you@example.com"
                    value={imapForm.username}
                    onChange={(v) => setImapForm((f) => ({ ...f, username: v }))}
                  />
                  <FormField
                    label="Password"
                    type="password"
                    placeholder="••••••••"
                    value={imapForm.password}
                    onChange={(v) => setImapForm((f) => ({ ...f, password: v }))}
                  />
                  {selectedProvider.id === 'imap' && (
                    <>
                      <div className="grid grid-cols-3 gap-2">
                        <div className="col-span-2">
                          <FormField
                            label="IMAP Host"
                            type="text"
                            placeholder="imap.example.com"
                            value={imapForm.host}
                            onChange={(v) => setImapForm((f) => ({ ...f, host: v }))}
                          />
                        </div>
                        <FormField
                          label="Port"
                          type="text"
                          placeholder="993"
                          value={imapForm.port}
                          onChange={(v) => setImapForm((f) => ({ ...f, port: v }))}
                        />
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <div className="col-span-2">
                          <FormField
                            label="SMTP Host"
                            type="text"
                            placeholder="smtp.example.com"
                            value={imapForm.smtpHost}
                            onChange={(v) => setImapForm((f) => ({ ...f, smtpHost: v }))}
                          />
                        </div>
                        <FormField
                          label="Port"
                          type="text"
                          placeholder="587"
                          value={imapForm.smtpPort}
                          onChange={(v) => setImapForm((f) => ({ ...f, smtpPort: v }))}
                        />
                      </div>
                    </>
                  )}
                  {error && <ErrorMessage message={error} />}
                  <button
                    onClick={() => void handleImapConnect()}
                    disabled={isLoading}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 mt-2 bg-[var(--color-primary)] text-white rounded-[var(--radius-lg)] text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-60"
                  >
                    {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                    {isLoading ? 'Connecting…' : 'Connect Account'}
                  </button>
                </div>
              )}

              <button
                onClick={() => { setStep('provider'); setError(null) }}
                className="w-full mt-3 text-xs text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] transition-colors"
              >
                ← Back to providers
              </button>
            </motion.div>
          )}

          {step === 'success' && (
            <motion.div
              key="success"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="p-8 text-center"
            >
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: 'spring', stiffness: 300, delay: 0.1 }}
                className="w-16 h-16 rounded-full bg-green-100 text-green-600 flex items-center justify-center mx-auto mb-4"
              >
                <CheckCircle2 className="w-9 h-9" />
              </motion.div>
              <h3 className="text-base font-semibold text-[var(--color-foreground)] mb-2">
                Account connected!
              </h3>
              <p className="text-sm text-[var(--color-muted-foreground)] mb-6">
                Your {selectedProvider?.label} account has been added. Your emails will start
                syncing shortly.
              </p>
              <button
                onClick={handleDone}
                className="px-6 py-2.5 bg-[var(--color-primary)] text-white rounded-[var(--radius-lg)] text-sm font-medium hover:opacity-90 transition-opacity"
              >
                Done
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  )
}

function defaultImapHost(provider: string): string {
  const hosts: Record<string, string> = {
    icloud: 'imap.mail.me.com',
    yahoo: 'imap.mail.yahoo.com',
    aol: 'imap.aol.com',
    fastmail: 'imap.fastmail.com',
    zoho: 'imap.zoho.com',
    gmx: 'imap.gmx.com',
  }
  return hosts[provider] ?? ''
}

function defaultSmtpHost(provider: string): string {
  const hosts: Record<string, string> = {
    icloud: 'smtp.mail.me.com',
    yahoo: 'smtp.mail.yahoo.com',
    aol: 'smtp.aol.com',
    fastmail: 'smtp.fastmail.com',
    zoho: 'smtp.zoho.com',
    gmx: 'mail.gmx.com',
  }
  return hosts[provider] ?? ''
}

function FormField({
  label,
  type,
  placeholder,
  value,
  onChange,
}: {
  label: string
  type: string
  placeholder: string
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-[var(--color-muted-foreground)] mb-1">
        {label}
      </label>
      <input
        type={type}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 text-sm bg-[var(--color-background)] border border-[var(--color-border)] rounded-[var(--radius-md)] outline-none text-[var(--color-foreground)] placeholder:text-[var(--color-muted-foreground)] focus:border-[var(--color-primary)] transition-colors"
      />
    </div>
  )
}

function ErrorMessage({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2 px-3 py-2 mb-3 rounded-[var(--radius-md)] bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300">
      <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
      <p className="text-xs">{message}</p>
    </div>
  )
}
