import { useState, useRef, useEffect, useMemo } from 'react'
import { motion } from 'framer-motion'
import {
  Inbox, Send, FileText, Trash2, AlertTriangle, Archive,
  Star, Settings, Plus, ChevronDown, ChevronRight,
  Layers, Mail, ShieldCheck, Pencil,
} from 'lucide-react'
import { cn } from '../../lib/utils'
import { UnreadBadge } from '../ui/Badge'
import { Avatar } from '../ui/Avatar'
import { useAccountStore } from '../../stores/accountStore'
import { useMailboxStore } from '../../stores/mailboxStore'
import { useUIStore } from '../../stores/uiStore'
import { useSyncStore } from '../../stores/syncStore'
import { useVerificationCodes } from '../../hooks/useVerificationCodes'
import type { AccountRow } from '@shared/types/db'

const PROVIDER_LABELS: Record<string, string> = {
  gmail: 'Gmail',
  outlook: 'Outlook',
  graph: 'Outlook',
  icloud: 'iCloud',
  yahoo: 'Yahoo Mail',
  fastmail: 'Fastmail',
  zoho: 'Zoho Mail',
  aol: 'AOL',
  gmx: 'GMX',
  imap: 'Custom IMAP',
}

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
  const { syncStatus, updateAccount } = useAccountStore()
  const status = syncStatus[account.id]
  const [editing, setEditing] = useState(false)
  const [editName, setEditName] = useState(account.displayName)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) inputRef.current?.select()
  }, [editing])

  const startEdit = (e: React.MouseEvent) => {
    e.stopPropagation()
    setEditName(account.displayName)
    setEditing(true)
  }

  const commitRename = async () => {
    const name = editName.trim()
    setEditing(false)
    if (!name || name === account.displayName) return
    updateAccount(account.id, { displayName: name })
    await window.emailAPI.accounts.update(account.id, { displayName: name })
  }

  if (editing) {
    return (
      <div className="px-3 py-1.5">
        <input
          ref={inputRef}
          value={editName}
          onChange={(e) => setEditName(e.target.value)}
          onBlur={() => void commitRename()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void commitRename()
            if (e.key === 'Escape') setEditing(false)
          }}
          className="w-full text-xs font-medium bg-[var(--color-background)] border border-[var(--color-primary)] rounded px-1.5 py-0.5 outline-none text-[var(--color-foreground)]"
        />
      </div>
    )
  }

  return (
    <motion.button
      onClick={onClick}
      whileTap={{ scale: 0.98 }}
      className={cn(
        'group flex items-center gap-2.5 w-full px-3 py-1.5 rounded-[var(--radius-md)] text-sm transition-colors text-left',
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
        <div className="truncate text-[10px] text-[var(--color-muted-foreground)]">{account.email}</div>
      </div>
      <button
        onClick={startEdit}
        className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-[var(--color-accent)]"
        title="Rename"
      >
        <Pencil className="w-3 h-3 text-[var(--color-muted-foreground)]" />
      </button>
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
  const { unreadCount: verificationUnread } = useVerificationCodes()
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())

  const accountGroups = useMemo(() => {
    const map = new Map<string, AccountRow[]>()
    accounts.forEach((acc) => {
      const label = PROVIDER_LABELS[acc.provider] ?? acc.provider
      if (!map.has(label)) map.set(label, [])
      map.get(label)!.push(acc)
    })
    return Array.from(map.entries()).map(([label, accs]) => ({ label, accounts: accs }))
  }, [accounts])

  const toggleGroup = (label: string) =>
    setCollapsedGroups((prev) => {
      const next = new Set(prev)
      next.has(label) ? next.delete(label) : next.add(label)
      return next
    })

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

        {/* Verification Center */}
        <NavItem
          icon={<ShieldCheck className="w-4 h-4" />}
          label="Verification Codes"
          isActive={activePanel === 'verification'}
          unreadCount={verificationUnread}
          onClick={() => setActivePanel('verification')}
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

        {/* Accounts grouped by provider */}
        {accountGroups.length > 0 && (
          <>
            <div className="h-px bg-[var(--color-sidebar-border)] my-2" />
            {accountGroups.map(({ label, accounts: groupAccounts }) => {
              const collapsed = collapsedGroups.has(label)
              return (
                <div key={label}>
                  <button
                    onClick={() => toggleGroup(label)}
                    className="flex items-center gap-1 w-full px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] transition-colors"
                  >
                    {collapsed
                      ? <ChevronRight className="w-3 h-3 shrink-0" />
                      : <ChevronDown className="w-3 h-3 shrink-0" />}
                    {label}
                    <span className="ml-1 font-normal normal-case tracking-normal opacity-60">
                      ({groupAccounts.length})
                    </span>
                  </button>
                  {!collapsed && groupAccounts.map((account) => (
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
                </div>
              )
            })}
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
