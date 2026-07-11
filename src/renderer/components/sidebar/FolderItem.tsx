import { useState, useCallback } from 'react'
import { AnimatePresence } from 'framer-motion'
import {
  Inbox, Send, FileText, Trash2, Archive, AlertTriangle,
  Folder, MoreHorizontal, MailOpen, Mail,
} from 'lucide-react'
import { cn } from '../../lib/utils'
import { ContextMenu } from '../ui/ContextMenu'
import type { ContextMenuGroup } from '../ui/ContextMenu'
import type { FolderRow } from '@shared/types/db'
import type { FolderAction } from '@shared/types/ipc'

const FOLDER_ICONS: Record<string, React.ReactNode> = {
  inbox: <Inbox className="w-3.5 h-3.5" />,
  sent: <Send className="w-3.5 h-3.5" />,
  drafts: <FileText className="w-3.5 h-3.5" />,
  trash: <Trash2 className="w-3.5 h-3.5" />,
  archive: <Archive className="w-3.5 h-3.5" />,
  spam: <AlertTriangle className="w-3.5 h-3.5" />,
  custom: <Folder className="w-3.5 h-3.5" />,
}

interface FolderItemProps {
  folder: FolderRow
  isSelected: boolean
  onSelect: () => void
  onAction: (action: FolderAction, folder: FolderRow) => void
}

export function FolderItem({ folder, isSelected, onSelect, onAction }: FolderItemProps) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)

  const openMenu = useCallback((x: number, y: number) => setMenu({ x, y }), [])

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => { e.preventDefault(); openMenu(e.clientX, e.clientY) },
    [openMenu],
  )

  const handleMoreClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
      openMenu(rect.right + 4, rect.top)
    },
    [openMenu],
  )

  const groups = buildMenuGroups(folder, (action) => onAction(action, folder))

  return (
    <>
      <button
        onContextMenu={handleContextMenu}
        onClick={onSelect}
        className={cn(
          'group w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-sm transition-colors',
          isSelected
            ? 'bg-[var(--color-primary)]/10 text-[var(--color-primary)] font-medium'
            : 'text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] hover:bg-[var(--color-muted)]',
        )}
      >
        <span className="shrink-0 opacity-60">
          {FOLDER_ICONS[folder.type] ?? FOLDER_ICONS.custom}
        </span>
        <span className="flex-1 truncate text-left text-[13px]">{folder.name}</span>
        {folder.unreadCount > 0 && (
          <span className="text-[10px] font-semibold text-[var(--color-primary)] shrink-0 mr-1">
            {folder.unreadCount > 999 ? '999+' : folder.unreadCount}
          </span>
        )}
        <button
          onClick={handleMoreClick}
          className="opacity-0 group-hover:opacity-60 hover:!opacity-100 p-0.5 rounded hover:bg-[var(--color-border)] transition-opacity shrink-0"
          aria-label={`Actions for ${folder.name}`}
        >
          <MoreHorizontal className="w-3.5 h-3.5" />
        </button>
      </button>

      <AnimatePresence>
        {menu && (
          <ContextMenu
            x={menu.x}
            y={menu.y}
            groups={groups}
            onClose={() => setMenu(null)}
          />
        )}
      </AnimatePresence>
    </>
  )
}

function buildMenuGroups(
  folder: FolderRow,
  onAction: (action: FolderAction) => void,
): ContextMenuGroup[] {
  if (folder.type === 'trash') {
    return [
      {
        items: [
          {
            label: 'Empty Trash',
            icon: <Trash2 className="w-3.5 h-3.5" />,
            destructive: true,
            onClick: () => onAction('emptyTrash'),
          },
        ],
      },
    ]
  }

  if (folder.type === 'spam') {
    return [
      {
        items: [
          {
            label: 'Empty Spam',
            icon: <AlertTriangle className="w-3.5 h-3.5" />,
            destructive: true,
            onClick: () => onAction('emptySpam'),
          },
        ],
      },
    ]
  }

  const readActions: ContextMenuGroup = {
    items: [
      {
        label: 'Mark All Read',
        icon: <MailOpen className="w-3.5 h-3.5" />,
        onClick: () => onAction('markAllRead'),
      },
      {
        label: 'Mark All Unread',
        icon: <Mail className="w-3.5 h-3.5" />,
        onClick: () => onAction('markAllUnread'),
      },
    ],
  }

  if (folder.type === 'inbox' || folder.type === 'archive') {
    return [
      readActions,
      {
        items: [
          {
            label: 'Archive All Read',
            icon: <Archive className="w-3.5 h-3.5" />,
            onClick: () => onAction('archiveAllRead'),
          },
        ],
      },
    ]
  }

  if (folder.type === 'custom') {
    return [
      readActions,
      {
        items: [
          {
            label: 'Archive All Read',
            icon: <Archive className="w-3.5 h-3.5" />,
            onClick: () => onAction('archiveAllRead'),
          },
          {
            label: 'Delete All',
            icon: <Trash2 className="w-3.5 h-3.5" />,
            destructive: true,
            onClick: () => onAction('deleteAll'),
          },
        ],
      },
    ]
  }

  // sent, drafts — just read actions
  return [readActions]
}
