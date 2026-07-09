import { motion } from 'framer-motion'
import {
  Inbox, Send, FileText, Trash2, AlertTriangle, Archive,
  Star, Settings, Plus, RefreshCw, ChevronDown, ChevronRight,
  Layers, Mail,
} from 'lucide-react'
import { cn } from '../../lib/utils'
import { UnreadBadge } from '../ui/Badge'
import { Avatar } from '../ui/Avatar'
import { useAccountStore } from '../../stores/accountStore'
import { useMailboxStore } from '../../stores/mailboxStore'
import { useUIStore } from '../../stores/uiStore'
import { useSyncStore } from '../../stores/syncStore'
import type { AccountRow } from '@shared/types/db'

interface NavItemProps {
  icon: React.ReactNode
  label: string
  isActive?: boolean
  unreadCount?: number
  onClick: () => void
  className?: string
}

function NavItem({ icon, label, isActive, unreadCount, onClick, className }: NavItemProps) {
  return (
    <motion.button
      onClick={onClick}
      whileTap={{ scale: 0.98 }}
      className={cn(
        'flex items-center gap-2.5 w-full px-3 py-1.5 rounded-[var(--radius-md)] text-sm font-medium transition-colors text-left',
        'text-[var(--color-sidebar-foreground)]',
        isActive
          ? 'bg-[var(--color-primary)] text-white'
          : 'hover:bg-[var(--color-muted)] hover:text-[var(--color-foreground)]',
        className
      )}
    >
      <span className="w-4 h-4 shrink-0">{icon}</span>
      <span className="flex-1 truncate">{label}</span>
      {unreadCount != null && unreadCount > 0 && (
        <UnreadBadge
          count={unreadCount}
          className={isActive ? 'bg-white/30 text-white' : ''}
        />
      )}
    </motion.button>
  )
}

function AccountItem({ account, isActive, onClick }: {
  account: AccountRow
  isActive: boolean
  onClick: () => void
}) {
  const { syncStatus } = useAccountStore()
  const status = syncStatus[account.id]

  return (
    <motion.button
      onClick={onClick}
      whileTap={{ scale: 0.98 }}
      className={cn(
        'flex items-center gap-2.5 w-full px-3 py-1.5 rounded-[var(--radius-md)] text-sm transition-colors text-left',
        isActive
          ? 'bg-[var(--color-muted)] text-[var(--color-foreground)]'
          : 'hover:bg-[var(--color-muted)] text-[var(--color-sidebar-foreground)] hover:text-[var(--color-foreground)]'
      )}
    >
      <div className="relative shrink-0">
        <Avatar name={account.displayName} email={account.email} size="xs" />
        {status?.state === 'syncing' && (
          <span className="absolute -bottom-0.5 -right-0.5 w-2 h-2 bg-[var(--color-primary)] rounded-full animate-pulse" />
        )}
        {status?.state === 'error' && (
          <span className="absolute -bottom-0.5 -right-0.5 w-2 h-2 bg-[var(--color-destructive)] rounded-full" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="truncate text-xs font-medium">{account.displayName}</div>
      </div>
    </motion.button>
  )
}

interface SidebarProps {
  onAddAccount?: () => void
}

export function Sidebar({ onAddAccount }: SidebarProps) {
  const { accounts, activeAccountId, setActiveAccount } = useAccountStore()
  const { selectedFolderType, setFolderType } = useMailboxStore()
  const { setActivePanel, activePanel, openComposer } = useUIStore()
  const { totalUnread } = useSyncStore()

  const isUnified = activeAccountId === 'unified'

  const mainFolders = [
    { type: 'inbox' as const, label: 'Inbox', icon: <Inbox className="w-4 h-4" />, unread: totalUnread },
    { type: 'starred' as const, label: 'Starred', icon: <Star className="w-4 h-4" /> },
    { type: 'sent' as const, label: 'Sent', icon: <Send className="w-4 h-4" /> },
    { type: 'drafts' as const, label: 'Drafts', icon: <FileText className="w-4 h-4" /> },
    { type: 'archive' as const, label: 'Archive', icon: <Archive className="w-4 h-4" /> },
    { type: 'spam' as const, label: 'Spam', icon: <AlertTriangle className="w-4 h-4" /> },
    { type: 'trash' as const, label: 'Trash', icon: <Trash2 className="w-4 h-4" /> },
  ]

  return (
    <div className="flex flex-col h-full bg-[var(--color-sidebar)] border-r border-[var(--color-sidebar-border)]">
      {/* macOS traffic light spacer */}
      <div className="h-10 drag-region shrink-0" />

      {/* App header */}
      <div className="px-4 pb-3 shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 bg-[var(--color-primary)] rounded-[var(--radius-sm)] flex items-center justify-center">
            <Mail className="w-3.5 h-3.5 text-white" />
          </div>
          <span className="text-sm font-semibold text-[var(--color-foreground)]">Email Hub</span>
        </div>
      </div>

      {/* Compose button */}
      <div className="px-3 mb-2 shrink-0">
        <motion.button
          onClick={openComposer}
          whileTap={{ scale: 0.97 }}
          className="flex items-center gap-2 w-full px-3 py-2 bg-[var(--color-primary)] text-white rounded-[var(--radius-md)] text-sm font-medium hover:opacity-90 transition-opacity"
        >
          <Plus className="w-4 h-4" />
          <span>Compose</span>
        </motion.button>
      </div>

      {/* Main navigation */}
      <div className="flex-1 overflow-y-auto px-2 space-y-0.5 min-h-0">
        {/* Unified inbox */}
        <NavItem
          icon={<Layers className="w-4 h-4" />}
          label="All Inboxes"
          isActive={activePanel === 'inbox' && isUnified && selectedFolderType === 'inbox'}
          unreadCount={totalUnread}
          onClick={() => {
            setActiveAccount('unified')
            setActivePanel('inbox')
            setFolderType('inbox')
          }}
        />

        <div className="h-px bg-[var(--color-sidebar-border)] my-2" />

        {/* Folder list */}
        {mainFolders.map((folder) => (
          <NavItem
            key={folder.type}
            icon={folder.icon}
            label={folder.label}
            isActive={
              activePanel === 'inbox' &&
              isUnified &&
              selectedFolderType === folder.type
            }
            unreadCount={folder.unread}
            onClick={() => {
              setActiveAccount('unified')
              setActivePanel('inbox')
              setFolderType(folder.type)
            }}
          />
        ))}

        {/* Accounts section */}
        {accounts.length > 0 && (
          <>
            <div className="h-px bg-[var(--color-sidebar-border)] my-2" />
            <p className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">
              Accounts
            </p>
            {accounts.map((account) => (
              <AccountItem
                key={account.id}
                account={account}
                isActive={activeAccountId === account.id}
                onClick={() => {
                  setActiveAccount(account.id)
                  setActivePanel('inbox')
                  setFolderType('inbox')
                }}
              />
            ))}
          </>
        )}
      </div>

      {/* Bottom actions */}
      <div className="px-2 pb-3 pt-2 border-t border-[var(--color-sidebar-border)] shrink-0 space-y-0.5">
        {onAddAccount && (
          <NavItem
            icon={<Plus className="w-4 h-4" />}
            label="Add Account"
            onClick={onAddAccount}
          />
        )}
        <NavItem
          icon={<Settings className="w-4 h-4" />}
          label="Settings"
          isActive={activePanel === 'settings'}
          onClick={() => setActivePanel('settings')}
        />
      </div>
    </div>
  )
}
