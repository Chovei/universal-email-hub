import { useState, useEffect } from 'react'
import { AnimatePresence } from 'framer-motion'
import { Sidebar } from './Sidebar'
import { CommandPalette } from '../command-palette/CommandPalette'
import { ComposerManager } from '../composer/Composer'
import { AddAccountWizard } from '../accounts/AddAccountWizard'
import { InboxPage } from '../../pages/InboxPage'
import { SearchPage } from '../../pages/SearchPage'
import { SettingsPage } from '../settings/SettingsPage'
import { useUIStore } from '../../stores/uiStore'
import { useComposeStore } from '../../stores/composeStore'
import { useAccountStore } from '../../stores/accountStore'
import { useAccounts } from '../../hooks/useAccounts'

export function AppShell() {
  const { activePanel, composerOpen, closeComposer: closeUIComposer } = useUIStore()
  const { openComposer } = useComposeStore()
  const { accounts } = useAccountStore()
  const [showAddAccount, setShowAddAccount] = useState(false)

  // Load accounts on mount
  useAccounts()

  // Bridge uiStore.composerOpen → composeStore.openComposer()
  useEffect(() => {
    if (composerOpen) {
      openComposer()
      closeUIComposer()
    }
  }, [composerOpen, openComposer, closeUIComposer])

  // Show add-account wizard automatically when there are no accounts
  useEffect(() => {
    if (accounts.length === 0) {
      // Small delay so the app shell renders first
      const t = setTimeout(() => setShowAddAccount(true), 600)
      return () => clearTimeout(t)
    }
  }, [accounts.length])

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[var(--color-background)] select-none">
      {/* Sidebar */}
      <Sidebar onAddAccount={() => setShowAddAccount(true)} />

      {/* Main content */}
      <main className="flex-1 min-w-0 flex flex-col overflow-hidden">
        {activePanel === 'inbox' && <InboxPage />}
        {activePanel === 'search' && <SearchPage />}
        {activePanel === 'settings' && <SettingsPage />}
      </main>

      {/* Global overlays */}
      <CommandPalette />
      <ComposerManager />

      {/* Add account wizard */}
      <AnimatePresence>
        {showAddAccount && (
          <AddAccountWizard
            onClose={() => setShowAddAccount(false)}
            onSuccess={() => setShowAddAccount(false)}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
