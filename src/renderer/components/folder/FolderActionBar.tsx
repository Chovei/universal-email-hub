import { useState, useCallback } from 'react'
import {
  Trash2, AlertTriangle, MailOpen, Archive, RefreshCw,
} from 'lucide-react'
import { cn } from '../../lib/utils'
import type { FolderRow } from '@shared/types/db'
import type { FolderAction } from '@shared/types/ipc'

interface ActionDef {
  action: FolderAction
  label: string
  icon: React.ReactNode
  destructive?: boolean
}

const ICON = 'w-3.5 h-3.5 shrink-0'

function getActions(folder: FolderRow): ActionDef[] {
  if (folder.type === 'trash') {
    return [{ action: 'emptyTrash', label: 'Empty Trash', icon: <Trash2 className={ICON} />, destructive: true }]
  }
  if (folder.type === 'spam') {
    return [{ action: 'emptySpam', label: 'Empty Spam', icon: <AlertTriangle className={ICON} />, destructive: true }]
  }
  if (folder.type === 'sent' || folder.type === 'drafts') {
    return [
      { action: 'markAllRead', label: 'Mark All Read', icon: <MailOpen className={ICON} /> },
    ]
  }
  const base: ActionDef[] = [
    { action: 'markAllRead', label: 'Mark All Read', icon: <MailOpen className={ICON} /> },
    { action: 'archiveAllRead', label: 'Archive All Read', icon: <Archive className={ICON} /> },
  ]
  if (folder.type === 'custom') {
    base.push({ action: 'deleteAll', label: 'Delete All', icon: <Trash2 className={ICON} />, destructive: true })
  }
  return base
}

/**
 * Width at which button text labels still fit, measured against THIS BAR
 * rather than the viewport — the bar lives in a user-resizable pane, so
 * Tailwind's sm:/md: breakpoints are the wrong axis entirely.
 *
 * A size container query resolves against the container's content box, so
 * these are (pane width − 24px) for this bar's px-3. Values come from the
 * measured max-content width of the labelled button group plus the gap,
 * with ~6% headroom for font variation; the stat text needs no allowance
 * because it truncates.
 *   1 action  ~176px → 200 (labelled at any usable pane width)
 *   2 actions ~312px → 330 (labelled from a ~354px pane)
 *   3 actions ~403px → 420 (cannot fit below a ~444px pane)
 * Whole literal strings so the Tailwind scanner emits the CSS.
 */
function labelVisibilityClass(actionCount: number): string {
  if (actionCount >= 3) return 'hidden @min-[420px]:inline'
  if (actionCount === 2) return 'hidden @min-[330px]:inline'
  return 'hidden @min-[200px]:inline'
}

interface FolderActionBarProps {
  folder: FolderRow
  onAction: (action: FolderAction) => void
  onSync: () => void
}

export function FolderActionBar({ folder, onAction, onSync }: FolderActionBarProps) {
  const [isSyncing, setIsSyncing] = useState(false)

  const handleSync = useCallback(async () => {
    setIsSyncing(true)
    onSync()
    setTimeout(() => setIsSyncing(false), 2000) // visual feedback for 2s
  }, [onSync])

  const actions = getActions(folder)
  const labelClass = labelVisibilityClass(actions.length)

  return (
    <div className="@container flex items-center gap-2 px-3 py-2 border-b border-[var(--color-border)] bg-[var(--color-background)] shrink-0 overflow-hidden">
      {/* Folder info. `truncate` lives on this BLOCK element — overflow/text-overflow
          do not apply to inline boxes, so a <span> here would never clip. */}
      <div className="flex-1 min-w-0 truncate text-xs text-[var(--color-muted-foreground)]">
        {folder.totalCount.toLocaleString()} total
        {folder.unreadCount > 0 && ` · ${folder.unreadCount.toLocaleString()} unread`}
      </div>

      {/* Action buttons — never shrink; labels collapse to icons in a narrow pane. */}
      <div className="flex items-center gap-0.5 shrink-0">
        {actions.map((a) => (
          <button
            key={a.action}
            onClick={() => onAction(a.action)}
            title={a.label}
            aria-label={a.label}
            className={cn(
              'flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs font-medium transition-colors whitespace-nowrap',
              a.destructive
                ? 'text-red-500 hover:bg-red-500/10'
                : 'text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] hover:bg-[var(--color-muted)]',
            )}
          >
            {a.icon}
            <span className={labelClass}>{a.label}</span>
          </button>
        ))}

        <div className="w-px h-4 bg-[var(--color-border)] mx-1 shrink-0" />

        <button
          onClick={() => void handleSync()}
          title="Sync"
          aria-label="Sync"
          className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] hover:bg-[var(--color-muted)] transition-colors whitespace-nowrap"
        >
          <RefreshCw className={cn('w-3.5 h-3.5 shrink-0', isSyncing && 'animate-spin')} />
          <span className={labelClass}>Sync</span>
        </button>
      </div>
    </div>
  )
}
