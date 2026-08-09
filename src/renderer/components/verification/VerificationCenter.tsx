import { useState, useCallback, useMemo } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import { ShieldCheck, Copy, Check, Trash2, Clock, Mail, Search, Inbox } from 'lucide-react'
import { cn } from '../../lib/utils'
import { useVerificationCodes } from '../../hooks/useVerificationCodes'
import { useMailboxStore } from '../../stores/mailboxStore'
import { useUIStore } from '../../stores/uiStore'
import { useAccountStore } from '../../stores/accountStore'
import type { VerificationCodeRow, MessageRow } from '@shared/types/db'

function timeAgo(ts: number): string {
  const diffMs = Date.now() - ts
  const diffSec = Math.floor(diffMs / 1000)
  if (diffSec < 60) return 'just now'
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h ago`
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

const SERVICE_COLORS: Record<string, string> = {
  VRChat: '#7C3AED',
  Discord: '#5865F2',
  Steam: '#1B2838',
  'Epic Games': '#313131',
  Google: '#EA4335',
  Microsoft: '#00A4EF',
  Apple: '#555555',
  Roblox: '#E21A1A',
  Minecraft: '#62A93E',
  Twitch: '#9146FF',
  Reddit: '#FF4500',
  GitHub: '#24292F',
  'X / Twitter': '#555555',
  Instagram: '#E1306C',
  TikTok: '#010101',
  Spotify: '#1DB954',
  Netflix: '#E50914',
  Meta: '#0082FB',
  Facebook: '#1877F2',
  'Riot Games': '#D13639',
  Blizzard: '#00AEFF',
  'EA / Origin': '#F56C2D',
  YouTube: '#FF0000',
  Snapchat: '#FFFC00',
  LinkedIn: '#0A66C2',
  Slack: '#4A154B',
  Cloudflare: '#F38020',
}

function serviceColor(name: string): string {
  return SERVICE_COLORS[name] ?? '#6366F1'
}

function CodeCard({
  code,
  accountEmail,
  onDelete,
  onMarkRead,
  onOpenEmail,
}: {
  code: VerificationCodeRow
  /** Which of the user's inboxes received this code. */
  accountEmail: string | null
  onDelete: (id: string) => void
  onMarkRead: (id: string) => void
  onOpenEmail: (code: VerificationCodeRow) => void
}) {
  const [copied, setCopied] = useState(false)

  const copy = useCallback(async () => {
    await navigator.clipboard.writeText(code.code)
    setCopied(true)
    if (!code.isRead) onMarkRead(code.id)
    setTimeout(() => setCopied(false), 2000)
  }, [code.code, code.id, code.isRead, onMarkRead])

  const color = serviceColor(code.serviceName)

  return (
    <div
      className={cn(
        'relative bg-[var(--color-card)] border border-[var(--color-border)] rounded-xl p-4 flex flex-col gap-3 shadow-sm transition-all',
        !code.isRead && 'ring-1'
      )}
      style={
        !code.isRead
          ? ({ '--tw-ring-color': color + '60', borderLeftColor: color, borderLeftWidth: '3px' } as React.CSSProperties)
          : undefined
      }
    >
      {/* Header row */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div
            className="w-6 h-6 rounded-lg shrink-0 flex items-center justify-center text-[11px] font-bold text-white"
            style={{ backgroundColor: color }}
            aria-hidden
          >
            {code.serviceName.charAt(0).toUpperCase()}
          </div>
          <span className="font-semibold text-sm text-[var(--color-foreground)] truncate">
            {code.serviceName}
          </span>
          {!code.isRead && (
            <span
              className="text-[10px] font-bold px-1.5 py-0.5 rounded-full text-white shrink-0"
              style={{ backgroundColor: color }}
            >
              NEW
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0 text-xs text-[var(--color-muted-foreground)]">
          <Clock className="w-3 h-3" />
          <span>{timeAgo(code.receivedAt)}</span>
        </div>
      </div>

      {/* Code + copy button */}
      <div className="flex items-center gap-3">
        <span className="flex-1 font-mono text-3xl font-bold tracking-[0.22em] text-[var(--color-foreground)] select-all">
          {code.code}
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
          {copied ? (
            <>
              <Check className="w-3.5 h-3.5" />
              Copied!
            </>
          ) : (
            <>
              <Copy className="w-3.5 h-3.5" />
              Copy
            </>
          )}
        </button>
      </div>

      {/* Footer row */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex flex-col min-w-0 gap-0.5">
          {/* Which inbox received it — the thing you need when the same
              service is registered against several of your accounts. */}
          {accountEmail && (
            <span
              className="flex items-center gap-1.5 text-xs font-medium text-[var(--color-foreground)] truncate"
              title={`Delivered to ${accountEmail}`}
            >
              <Inbox className="w-3 h-3 shrink-0 text-[var(--color-muted-foreground)]" />
              {accountEmail}
            </span>
          )}
          <span className="text-[11px] text-[var(--color-muted-foreground)] truncate">
            from {code.senderEmail}
          </span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => onOpenEmail(code)}
            className="flex items-center gap-1 px-2 py-1 rounded text-xs text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] hover:bg-[var(--color-accent)] transition-colors"
            title="Open the original email"
          >
            <Mail className="w-3.5 h-3.5" />
            Open email
          </button>
          <button
            onClick={() => { void onDelete(code.id) }}
            className="p-1 rounded text-[var(--color-muted-foreground)] hover:text-red-500 hover:bg-red-500/10 transition-colors"
            title="Delete code and move its email to Trash"
            aria-label="Delete code and move its email to Trash"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  )
}

export function VerificationCenter() {
  const { codes, isLoading, unreadCount, markRead, deleteCode } = useVerificationCodes()
  const [filter, setFilter] = useState('')
  const selectThread = useMailboxStore((s) => s.selectThread)
  const setActivePanel = useUIStore((s) => s.setActivePanel)
  const accounts = useAccountStore((s) => s.accounts)

  const accountEmailById = useMemo(
    () => new Map(accounts.map((a) => [a.id, a.email])),
    [accounts]
  )

  const visibleCodes = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return codes
    return codes.filter(
      (c) =>
        c.serviceName.toLowerCase().includes(q) ||
        c.senderEmail.toLowerCase().includes(q) ||
        c.code.toLowerCase().includes(q) ||
        // Searchable by receiving inbox too: "which code came to this account?"
        (accountEmailById.get(c.accountId) ?? '').toLowerCase().includes(q)
    )
  }, [codes, filter, accountEmailById])

  const handleDelete = useCallback(
    async (id: string) => {
      // Also moves the email the code came from to Trash — recoverable there
      // if it was a mis-click.
      await deleteCode([id], true)
    },
    [deleteCode]
  )

  const handleMarkRead = useCallback(
    async (id: string) => {
      await markRead([id])
    },
    [markRead]
  )

  const handleMarkAllRead = useCallback(async () => {
    const ids = codes.filter((c) => !c.isRead).map((c) => c.id)
    if (ids.length > 0) await markRead(ids)
  }, [codes, markRead])

  const handleOpenEmail = useCallback(
    async (code: VerificationCodeRow) => {
      const result = await window.emailAPI.messages.get(code.messageId)
      const msg = (result as unknown as { data?: MessageRow }).data
      if (!msg) return
      setActivePanel('inbox')
      selectThread(msg.threadId)
      if (!code.isRead) void markRead([code.id])
    },
    [setActivePanel, selectThread, markRead]
  )

  // Press "c" to copy the newest code — the fastest path from
  // "notification arrived" to "code in clipboard"
  useHotkeys(
    'c',
    () => {
      const newest = codes[0]
      if (!newest) return
      void navigator.clipboard.writeText(newest.code)
      if (!newest.isRead) void markRead([newest.id])
    },
    [codes, markRead]
  )

  return (
    <div className="flex flex-col h-full bg-[var(--color-background)]">
      {/* Header */}
      <div className="flex-shrink-0 border-b border-[var(--color-border)] px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-[var(--color-primary)]/10 rounded-xl flex items-center justify-center">
              <ShieldCheck className="w-5 h-5 text-[var(--color-primary)]" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-[var(--color-foreground)]">
                Verification Center
              </h1>
              <p className="text-xs text-[var(--color-muted-foreground)]">
                Login and 2FA codes from all your accounts
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {codes.length > 5 && (
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--color-muted-foreground)]" />
                <input
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="Filter codes…"
                  className="pl-8 pr-3 py-1.5 w-48 rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] text-xs text-[var(--color-foreground)] placeholder:text-[var(--color-muted-foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]/40"
                />
              </div>
            )}
            {unreadCount > 0 && (
              <button
                onClick={() => { void handleMarkAllRead() }}
                className="text-xs text-[var(--color-primary)] hover:underline font-medium shrink-0"
              >
                Mark all read
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 py-5">
        {isLoading ? (
          <div className="flex items-center justify-center h-48 text-[var(--color-muted-foreground)]">
            <span className="text-sm">Loading...</span>
          </div>
        ) : codes.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 gap-4 text-center">
            <div className="w-16 h-16 bg-[var(--color-muted)] rounded-2xl flex items-center justify-center">
              <ShieldCheck className="w-8 h-8 text-[var(--color-muted-foreground)]" />
            </div>
            <div>
              <p className="font-medium text-[var(--color-foreground)] mb-1">
                No verification codes yet
              </p>
              <p className="text-sm text-[var(--color-muted-foreground)] max-w-xs">
                Login codes and 2FA codes will appear here automatically as they arrive in your connected accounts.
              </p>
            </div>
          </div>
        ) : visibleCodes.length === 0 ? (
          <div className="flex items-center justify-center h-48 text-sm text-[var(--color-muted-foreground)]">
            No codes match “{filter}”
          </div>
        ) : (
          <div className="grid gap-3 max-w-2xl">
            {visibleCodes.map((code) => (
              <CodeCard
                key={code.id}
                code={code}
                accountEmail={accountEmailById.get(code.accountId) ?? null}
                onDelete={(id) => { void handleDelete(id) }}
                onMarkRead={(id) => { void handleMarkRead(id) }}
                onOpenEmail={(c) => { void handleOpenEmail(c) }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
