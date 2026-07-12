import { useEffect, useCallback } from 'react'
import { Command } from 'cmdk'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Search, Inbox, Send, FileText, Trash2, Settings, Plus,
  Star, Archive, RefreshCw, Mail, Layers, Keyboard,
} from 'lucide-react'
import { useUIStore } from '../../stores/uiStore'
import { useMailboxStore } from '../../stores/mailboxStore'
import { useAccountStore } from '../../stores/accountStore'

export function CommandPalette({ onShowShortcuts }: { onShowShortcuts?: () => void }) {
  const { commandPaletteOpen, closeCommandPalette, openComposer, setActivePanel } = useUIStore()
  const { setFolderType } = useMailboxStore()
  const { accounts, setActiveAccount } = useAccountStore()

  const runAndClose = useCallback(
    (fn: () => void) => {
      fn()
      closeCommandPalette()
    },
    [closeCommandPalette]
  )

  // Keyboard shortcut Ctrl+Shift+P
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'P') {
        e.preventDefault()
        useUIStore.getState().toggleCommandPalette()
      }
      if (e.key === 'Escape' && commandPaletteOpen) {
        closeCommandPalette()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [commandPaletteOpen, closeCommandPalette])

  return (
    <AnimatePresence>
      {commandPaletteOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
            onClick={closeCommandPalette}
          />

          {/* Palette */}
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: -8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: -8 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
            className="fixed top-[20%] left-1/2 -translate-x-1/2 z-50 w-[560px] max-w-[90vw]"
          >
            <div className="rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-card)] shadow-2xl overflow-hidden">
              <Command className="[&_[cmdk-root]]:bg-transparent">
                <div className="flex items-center border-b border-[var(--color-border)] px-4">
                  <Search className="w-4 h-4 text-[var(--color-muted-foreground)] shrink-0" />
                  <Command.Input
                    placeholder="Search or type a command…"
                    className="flex-1 px-3 py-4 text-sm bg-transparent outline-none placeholder:text-[var(--color-muted-foreground)] text-[var(--color-foreground)]"
                  />
                  <kbd className="shrink-0 text-[10px] bg-[var(--color-muted)] text-[var(--color-muted-foreground)] px-1.5 py-0.5 rounded font-mono">
                    ESC
                  </kbd>
                </div>

                <Command.List className="max-h-[380px] overflow-y-auto py-2">
                  <Command.Empty className="py-8 text-center text-sm text-[var(--color-muted-foreground)]">
                    No results found
                  </Command.Empty>

                  {/* Actions */}
                  <CommandGroup label="Actions">
                    <CommandItem
                      icon={<Plus className="w-4 h-4" />}
                      label="Compose new email"
                      shortcut="C"
                      onSelect={() => runAndClose(openComposer)}
                    />
                    <CommandItem
                      icon={<RefreshCw className="w-4 h-4" />}
                      label="Sync all accounts"
                      onSelect={() => runAndClose(() => void window.emailAPI.sync.force())}
                    />
                    {onShowShortcuts && (
                      <CommandItem
                        icon={<Keyboard className="w-4 h-4" />}
                        label="Keyboard shortcuts"
                        shortcut="Ctrl /"
                        onSelect={() => runAndClose(onShowShortcuts)}
                      />
                    )}
                  </CommandGroup>

                  {/* Navigate */}
                  <CommandGroup label="Navigate">
                    <CommandItem
                      icon={<Layers className="w-4 h-4" />}
                      label="All Inboxes"
                      onSelect={() =>
                        runAndClose(() => {
                          setActiveAccount('unified')
                          setActivePanel('inbox')
                          setFolderType('inbox')
                        })
                      }
                    />
                    <CommandItem
                      icon={<Star className="w-4 h-4" />}
                      label="Starred"
                      onSelect={() =>
                        runAndClose(() => {
                          setFolderType('starred')
                          setActivePanel('inbox')
                        })
                      }
                    />
                    <CommandItem
                      icon={<Send className="w-4 h-4" />}
                      label="Sent"
                      onSelect={() =>
                        runAndClose(() => {
                          setFolderType('sent')
                          setActivePanel('inbox')
                        })
                      }
                    />
                    <CommandItem
                      icon={<FileText className="w-4 h-4" />}
                      label="Drafts"
                      onSelect={() =>
                        runAndClose(() => {
                          setFolderType('drafts')
                          setActivePanel('inbox')
                        })
                      }
                    />
                    <CommandItem
                      icon={<Archive className="w-4 h-4" />}
                      label="Archive"
                      onSelect={() =>
                        runAndClose(() => {
                          setFolderType('archive')
                          setActivePanel('inbox')
                        })
                      }
                    />
                    <CommandItem
                      icon={<Settings className="w-4 h-4" />}
                      label="Settings"
                      onSelect={() => runAndClose(() => setActivePanel('settings'))}
                    />
                  </CommandGroup>

                  {/* Accounts */}
                  {accounts.length > 0 && (
                    <CommandGroup label="Accounts">
                      {accounts.map((account) => (
                        <CommandItem
                          key={account.id}
                          icon={<Mail className="w-4 h-4" />}
                          label={account.displayName}
                          description={account.email}
                          onSelect={() =>
                            runAndClose(() => {
                              setActiveAccount(account.id)
                              setActivePanel('inbox')
                              setFolderType('inbox')
                            })
                          }
                        />
                      ))}
                    </CommandGroup>
                  )}
                </Command.List>
              </Command>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}

function CommandGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Command.Group
      heading={label}
      className="[&_[cmdk-group-heading]]:px-4 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-[var(--color-muted-foreground)]"
    >
      {children}
    </Command.Group>
  )
}

function CommandItem({
  icon,
  label,
  description,
  shortcut,
  onSelect,
}: {
  icon: React.ReactNode
  label: string
  description?: string
  shortcut?: string
  onSelect: () => void
}) {
  return (
    <Command.Item
      onSelect={onSelect}
      className="flex items-center gap-3 px-4 py-2.5 cursor-pointer text-[var(--color-foreground)] aria-selected:bg-[var(--color-muted)] rounded-[var(--radius-md)] mx-1 transition-colors"
    >
      <span className="w-4 h-4 text-[var(--color-muted-foreground)] shrink-0">{icon}</span>
      <div className="flex-1 min-w-0">
        <span className="text-sm">{label}</span>
        {description && (
          <span className="text-xs text-[var(--color-muted-foreground)] block truncate">
            {description}
          </span>
        )}
      </div>
      {shortcut && (
        <kbd className="text-[10px] bg-[var(--color-muted)] text-[var(--color-muted-foreground)] px-1.5 py-0.5 rounded font-mono shrink-0">
          {shortcut}
        </kbd>
      )}
    </Command.Item>
  )
}
