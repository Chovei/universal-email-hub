import { useState, useCallback } from 'react'
import { ShieldCheck, Copy, Check, Trash2, Clock } from 'lucide-react'
import { cn } from '../../lib/utils'
import { useVerificationCodes } from '../../hooks/useVerificationCodes'
import type { VerificationCodeRow } from '@shared/types/db'

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
  onDelete,
  onMarkRead,
}: {
  code: VerificationCodeRow
  onDelete: (id: string) => void
  onMarkRead: (id: string) => void
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
          <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
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
        <span className="text-xs text-[var(--color-muted-foreground)] truncate min-w-0">
          {code.senderEmail}
        </span>
        <button
          onClick={() => { void onDelete(code.id) }}
          className="shrink-0 p-1 rounded text-[var(--color-muted-foreground)] hover:text-red-500 hover:bg-red-500/10 transition-colors"
          title="Dismiss"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  )
}

export function VerificationCenter() {
  const { codes, isLoading, unreadCount, markRead, deleteCode } = useVerificationCodes()

  const handleDelete = useCallback(
    async (id: string) => {
      await deleteCode([id])
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
          {unreadCount > 0 && (
            <button
              onClick={() => { void handleMarkAllRead() }}
              className="text-xs text-[var(--color-primary)] hover:underline font-medium"
            >
              Mark all read
            </button>
          )}
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
        ) : (
          <div className="grid gap-3 max-w-2xl">
            {codes.map((code) => (
              <CodeCard
                key={code.id}
                code={code}
                onDelete={(id) => { void handleDelete(id) }}
                onMarkRead={(id) => { void handleMarkRead(id) }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
