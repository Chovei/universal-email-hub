import { useState, useEffect } from 'react'
import { Sun, Moon, Monitor, Palette, Bell, User, Key, Info, Eye, EyeOff, Trash2, RefreshCw, Download, CheckCircle2, Loader2 } from 'lucide-react'
import { cn } from '../../lib/utils'
import { useUIStore } from '../../stores/uiStore'
import { useAccounts } from '../../hooks/useAccounts'
import { useSettings } from '../../hooks/useSettings'
import { Avatar } from '../ui/Avatar'
import type { UpdateStatus } from '@shared/types/ipc'

export function SettingsPage() {
  const { theme, setTheme, density, setDensity } = useUIStore()
  const { accounts, removeAccount } = useAccounts()
  const { settings, setSetting } = useSettings()
  const [showClientSecret, setShowClientSecret] = useState(false)

  const [removingId, setRemovingId] = useState<string | null>(null)
  const [appVersion, setAppVersion] = useState<string>('…')
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null)

  useEffect(() => {
    type Env<T> = { data?: T }
    void (window.emailAPI.updater.getAppInfo() as unknown as Promise<Env<{ version: string }>>)
      .then((res) => { if (res.data?.version) setAppVersion(res.data.version) })

    return window.emailAPI.updater.onStatus(setUpdateStatus)
  }, [])

  const handleRemoveAccount = async (accountId: string) => {
    setRemovingId(accountId)
    try {
      await removeAccount(accountId)
    } finally {
      setRemovingId(null)
    }
  }

  return (
    <div className="flex flex-col h-full bg-[var(--color-background)] overflow-y-auto">
      <div className="max-w-2xl mx-auto w-full px-8 py-10">
        <h1 className="text-2xl font-bold text-[var(--color-foreground)] mb-8">Settings</h1>

        <div className="space-y-8">
          {/* Appearance */}
          <Section title="Appearance" icon={<Palette className="w-4 h-4" />}>
            <div className="space-y-4">
              <SettingRow label="Theme">
                <div className="flex gap-2">
                  {(['light', 'dark', 'system'] as const).map((t) => {
                    const icons = {
                      light: <Sun className="w-4 h-4" />,
                      dark: <Moon className="w-4 h-4" />,
                      system: <Monitor className="w-4 h-4" />,
                    }
                    return (
                      <button
                        key={t}
                        onClick={() => setTheme(t)}
                        className={cn(
                          'flex items-center gap-2 px-3 py-1.5 rounded-[var(--radius-md)] text-sm border transition-colors',
                          theme === t
                            ? 'border-[var(--color-primary)] bg-[var(--color-primary)] text-white'
                            : 'border-[var(--color-border)] text-[var(--color-foreground)] hover:bg-[var(--color-muted)]'
                        )}
                      >
                        {icons[t]}
                        <span className="capitalize">{t}</span>
                      </button>
                    )
                  })}
                </div>
              </SettingRow>

              <SettingRow label="Density">
                <div className="flex gap-2">
                  {(['compact', 'comfortable', 'spacious'] as const).map((d) => (
                    <button
                      key={d}
                      onClick={() => setDensity(d)}
                      className={cn(
                        'px-3 py-1.5 rounded-[var(--radius-md)] text-sm border capitalize transition-colors',
                        density === d
                          ? 'border-[var(--color-primary)] bg-[var(--color-primary)] text-white'
                          : 'border-[var(--color-border)] text-[var(--color-foreground)] hover:bg-[var(--color-muted)]'
                      )}
                    >
                      {d}
                    </button>
                  ))}
                </div>
              </SettingRow>
            </div>
          </Section>

          {/* Accounts */}
          <Section title="Accounts" icon={<User className="w-4 h-4" />}>
            {accounts.length === 0 ? (
              <p className="text-sm text-[var(--color-muted-foreground)]">
                No accounts connected. Add an account to get started.
              </p>
            ) : (
              <div className="space-y-3">
                {accounts.map((account) => (
                  <div
                    key={account.id}
                    className="flex items-center gap-3 p-3 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-background)]"
                  >
                    <Avatar name={account.displayName} email={account.email} size="sm" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-[var(--color-foreground)] truncate">
                        {account.displayName}
                      </p>
                      <p className="text-xs text-[var(--color-muted-foreground)] truncate">
                        {account.email} · {account.provider}
                      </p>
                    </div>
                    <button
                      onClick={() => void handleRemoveAccount(account.id)}
                      disabled={removingId === account.id}
                      className="p-1.5 rounded-[var(--radius-md)] text-[var(--color-muted-foreground)] hover:text-[var(--color-destructive)] hover:bg-red-50 dark:hover:bg-red-950 transition-colors disabled:opacity-40"
                      title="Remove account"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </Section>

          {/* Notifications */}
          <Section title="Notifications" icon={<Bell className="w-4 h-4" />}>
            <div className="space-y-4">
              <SettingRow label="Desktop notifications">
                <Toggle
                  enabled={settings?.notifications.enabled ?? true}
                  onChange={(v) =>
                    setSetting('notifications', { ...settings?.notifications, enabled: v })
                  }
                />
              </SettingRow>
              <SettingRow label="Notification sound">
                <Toggle
                  enabled={settings?.notifications.sound ?? true}
                  onChange={(v) =>
                    setSetting('notifications', { ...settings?.notifications, sound: v })
                  }
                  disabled={!settings?.notifications.enabled}
                />
              </SettingRow>
              <SettingRow label="Quiet hours start">
                <input
                  type="time"
                  value={settings?.notifications.quietHoursStart ?? ''}
                  onChange={(e) =>
                    setSetting('notifications', {
                      ...settings?.notifications,
                      quietHoursStart: e.target.value || null,
                    })
                  }
                  className="px-2 py-1 text-sm bg-[var(--color-background)] border border-[var(--color-border)] rounded-[var(--radius-md)] text-[var(--color-foreground)] outline-none focus:border-[var(--color-primary)]"
                />
              </SettingRow>
              <SettingRow label="Quiet hours end">
                <input
                  type="time"
                  value={settings?.notifications.quietHoursEnd ?? ''}
                  onChange={(e) =>
                    setSetting('notifications', {
                      ...settings?.notifications,
                      quietHoursEnd: e.target.value || null,
                    })
                  }
                  className="px-2 py-1 text-sm bg-[var(--color-background)] border border-[var(--color-border)] rounded-[var(--radius-md)] text-[var(--color-foreground)] outline-none focus:border-[var(--color-primary)]"
                />
              </SettingRow>
            </div>
          </Section>

          {/* Gmail OAuth Credentials */}
          <Section title="Gmail OAuth Credentials" icon={<Key className="w-4 h-4" />}>
            <div className="space-y-4">
              <p className="text-xs text-[var(--color-muted-foreground)] -mt-1">
                Required to sign in with Gmail. Create a Desktop App OAuth client at{' '}
                <span className="font-mono">console.cloud.google.com</span>, enable the Gmail API,
                then paste the credentials below.
              </p>
              <SettingRow label="Client ID">
                <input
                  type="text"
                  value={settings?.gmailClientId ?? ''}
                  onChange={(e) => setSetting('gmailClientId', e.target.value.trim())}
                  placeholder="…apps.googleusercontent.com"
                  className="w-64 px-3 py-1.5 text-sm bg-[var(--color-background)] border border-[var(--color-border)] rounded-[var(--radius-md)] text-[var(--color-foreground)] placeholder:text-[var(--color-muted-foreground)] outline-none focus:border-[var(--color-primary)] font-mono"
                />
              </SettingRow>
              <SettingRow label="Client Secret">
                <div className="relative flex items-center">
                  <input
                    type={showClientSecret ? 'text' : 'password'}
                    value={settings?.gmailClientSecret ?? ''}
                    onChange={(e) => setSetting('gmailClientSecret', e.target.value.trim())}
                    placeholder="GOCSPX-…"
                    className="w-64 px-3 py-1.5 pr-9 text-sm bg-[var(--color-background)] border border-[var(--color-border)] rounded-[var(--radius-md)] text-[var(--color-foreground)] placeholder:text-[var(--color-muted-foreground)] outline-none focus:border-[var(--color-primary)] font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setShowClientSecret((v) => !v)}
                    className="absolute right-2 text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
                  >
                    {showClientSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </SettingRow>
            </div>
          </Section>

          {/* Microsoft Graph OAuth Credentials */}
          <Section title="Microsoft 365 OAuth Credentials" icon={<Key className="w-4 h-4" />}>
            <div className="space-y-4">
              <p className="text-xs text-[var(--color-muted-foreground)] -mt-1">
                Required for "Sign in with Microsoft" on Outlook accounts. Register a free app at{' '}
                <span className="font-mono">portal.azure.com</span> → App registrations → New registration.
                Set redirect URI to <span className="font-mono">http://localhost</span> (public client),
                enable "Allow public client flows", then paste the Application (client) ID below.
              </p>
              <SettingRow label="Client ID">
                <input
                  type="text"
                  value={settings?.graphClientId ?? ''}
                  onChange={(e) => setSetting('graphClientId', e.target.value.trim())}
                  placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                  className="w-64 px-3 py-1.5 text-sm bg-[var(--color-background)] border border-[var(--color-border)] rounded-[var(--radius-md)] text-[var(--color-foreground)] placeholder:text-[var(--color-muted-foreground)] outline-none focus:border-[var(--color-primary)] font-mono"
                />
              </SettingRow>
            </div>
          </Section>

          {/* About */}
          <Section title="About" icon={<Info className="w-4 h-4" />}>
            <div className="space-y-3">
              <SettingRow label="Version">
                <span className="text-sm text-[var(--color-muted-foreground)] font-mono">
                  v{appVersion}
                </span>
              </SettingRow>
              <SettingRow label="Updates">
                <UpdateControl status={updateStatus} />
              </SettingRow>
            </div>
          </Section>
        </div>
      </div>
    </div>
  )
}

function UpdateControl({ status }: { status: UpdateStatus | null }) {
  const check = () => { void window.emailAPI.updater.check() }
  const install = () => { void window.emailAPI.updater.install() }

  if (!status || status.type === 'not-available') {
    return (
      <div className="flex items-center gap-2">
        {status?.type === 'not-available' && (
          <span className="flex items-center gap-1 text-sm text-green-600 dark:text-green-400">
            <CheckCircle2 className="w-4 h-4" />
            Up to date
          </span>
        )}
        <button
          onClick={check}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-md)] text-sm border border-[var(--color-border)] text-[var(--color-foreground)] hover:bg-[var(--color-muted)] transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          {status ? 'Check again' : 'Check for Updates'}
        </button>
      </div>
    )
  }

  if (status.type === 'checking') {
    return (
      <span className="flex items-center gap-1.5 text-sm text-[var(--color-muted-foreground)]">
        <Loader2 className="w-4 h-4 animate-spin" />
        Checking…
      </span>
    )
  }

  if (status.type === 'available') {
    return (
      <span className="flex items-center gap-2 text-sm text-[var(--color-muted-foreground)]">
        v{status.version} available — downloading automatically…
      </span>
    )
  }

  if (status.type === 'downloading') {
    return (
      <span className="flex items-center gap-1.5 text-sm text-[var(--color-muted-foreground)]">
        <Loader2 className="w-4 h-4 animate-spin" />
        Downloading… {Math.round(status.progress)}%
      </span>
    )
  }

  if (status.type === 'downloaded') {
    return (
      <button
        onClick={install}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-md)] text-sm bg-[var(--color-primary)] text-white hover:opacity-90 transition-opacity"
      >
        <Download className="w-3.5 h-3.5" />
        Restart to install v{status.version}
      </button>
    )
  }

  if (status.type === 'error') {
    return (
      <div className="flex items-center gap-2">
        <span className="text-sm text-red-500">Check failed</span>
        <button
          onClick={check}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-md)] text-sm border border-[var(--color-border)] text-[var(--color-foreground)] hover:bg-[var(--color-muted)] transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Retry
        </button>
      </div>
    )
  }

  return null
}

function Section({
  title,
  icon,
  children,
}: {
  title: string
  icon: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <span className="text-[var(--color-muted-foreground)]">{icon}</span>
        <h2 className="text-sm font-semibold text-[var(--color-foreground)] uppercase tracking-wide">
          {title}
        </h2>
      </div>
      <div className="rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-card)] p-5">
        {children}
      </div>
    </div>
  )
}

function SettingRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-sm text-[var(--color-foreground)]">{label}</span>
      {children}
    </div>
  )
}

function Toggle({
  enabled,
  onChange,
  disabled = false,
}: {
  enabled: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
}) {
  return (
    <button
      role="switch"
      aria-checked={enabled}
      onClick={() => !disabled && onChange(!enabled)}
      disabled={disabled}
      className={cn(
        'relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none disabled:opacity-40 disabled:cursor-not-allowed',
        enabled ? 'bg-[var(--color-primary)]' : 'bg-[var(--color-muted)]'
      )}
    >
      <span
        className={cn(
          'pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-200',
          enabled ? 'translate-x-4' : 'translate-x-0'
        )}
      />
    </button>
  )
}
