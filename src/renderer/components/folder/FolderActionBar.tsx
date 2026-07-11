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

function getActions(folder: FolderRow): ActionDef[] {
  if (folder.type === 'trash') {
    return [{ action: 'emptyTrash', label: 'Empty Trash', icon: <Trash2 className="w-3.5 h-3.5" />, destructive: true }]
  }
  if (folder.type === 'spam') {
    return [{ action: 'emptySpam', label: 'Empty Spam', icon: <AlertTriangle className="w-3.5 h-3.5" />, destructive: true }]
  }
  const base: ActionDef[] = [
    { action: 'markAllRead', label: 'Mark All Read', icon: <MailOpen className="w-3.5 h-3.5" /> },
    { action: 'archiveAllRead', label: 'Archive All Read', icon: <Archive className="w-3.5 h-3.5" /> },
  ]
  if (folder.type === 'custom') {
    base.push({ action: 'deleteAll', label: 'Delete All', icon: <Trash2 className="w-3.5 h-3.5" />, destructive: true })
  }
  return base
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

  return (
    <div className="flex items-center gap-1 px-3 py-2 border-b border-[var(--color-border)] bg-[var(--color-background)] shrink-0">
      {/* Folder info */}
      <div className="flex-1 min-w-0">
        <span className="text-xs text-[var(--color-muted-foreground)] truncate">
          {folder.totalCount.toLocaleString()} total
          {folder.unreadCount > 0 && ` · ${folder.unreadCount.toLocaleString()} unread`}
        </span>
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-0.5">
        {actions.map((a) => (
          <button
            key={a.action}
            onClick={() => onAction(a.action)}
            className={cn(
              'flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs font-medium transition-colors whitespace-nowrap',
              a.destructive
                ? 'text-red-500 hover:bg-red-500/10'
                : 'text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] hover:bg-[var(--color-muted)]',
            )}
          >
            {a.icon}
            {a.label}
          </button>
        ))}

        <div className="w-px h-4 bg-[var(--color-border)] mx-1" />

        <button
          onClick={handleSync}
          className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] hover:bg-[var(--color-muted)] transition-colors"
        >
          <RefreshCw className={cn('w-3.5 h-3.5', isSyncing && 'animate-spin')} />
          Sync
        </button>
      </div>
    </div>
  )
}
