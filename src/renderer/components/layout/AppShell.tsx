import { useState, useEffect, useCallback } from 'react'
import { AnimatePresence } from 'framer-motion'
import { Sidebar } from './Sidebar'
import { CommandPalette } from '../command-palette/CommandPalette'
import { ComposerManager } from '../composer/Composer'
import { AddAccountWizard } from '../accounts/AddAccountWizard'
import { InboxPage } from '../../pages/InboxPage'
import { SearchPage } from '../../pages/SearchPage'
import { SettingsPage } from '../settings/SettingsPage'
import { VerificationCenter } from '../verification/VerificationCenter'
import { useUIStore } from '../../stores/uiStore'
import { useComposeStore } from '../../stores/composeStore'
import { useAccountStore } from '../../stores/accountStore'
import { useAccounts } from '../../hooks/useAccounts'
import { BulkActionBar } from '../bulk/BulkActionBar'
import { BulkProgressToast } from '../bulk/BulkProgressToast'
import { useBulkOperation } from '../../hooks/useBulkOperation'
import { useSelectionStore } from '../../stores/selectionStore'
import { useFolderActions } from '../../hooks/useFolderActions'
import { FolderConfirmDialog } from '../folder/FolderConfirmDialog'
import type { BulkAction, FolderAction } from '@shared/types/ipc'
import type { FolderRow } from '@shared/types/db'

export function AppShell() {
  const { activePanel, composerOpen, closeComposer: closeUIComposer, setActivePanel } = useUIStore()
  const { openComposer } = useComposeStore()
  const { accounts } = useAccountStore()
  const [showAddAccount, setShowAddAccount] = useState(false)

  const { deselectAll } = useSelectionStore()
  const { execute, cancel, undo, dismiss, progress, result, isRunning, lastAction } = useBulkOperation()
  const { requestAction, confirm, cancel: cancelFolder, pending } = useFolderActions()

  const handleBulkAction = useCallback((action: BulkAction, threadIds: string[]) => {
    void execute({ action, threadIds })
    deselectAll()
  }, [execute, deselectAll])

  const handleFolderAction = useCallback(
    (action: FolderAction, folder: FolderRow) =>
      requestAction(action, folder, folder.accountId),
    [requestAction],
  )

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
      <Sidebar onAddAccount={() => setShowAddAccount(true)} onFolderAction={requestAction} />

      {/* Main content */}
      <main className="flex-1 min-w-0 flex flex-col overflow-hidden">
        {activePanel === 'inbox' && <InboxPage onFolderAction={handleFolderAction} />}
        {activePanel === 'search' && <SearchPage />}
        {activePanel === 'settings' && <SettingsPage />}
        {activePanel === 'verification' && <VerificationCenter />}
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
            onGoToSettings={() => {
              setShowAddAccount(false)
              setActivePanel('settings')
            }}
          />
        )}
      </AnimatePresence>

      {/* Bulk operation UI */}
      <BulkActionBar onAction={handleBulkAction} />
      <BulkProgressToast
        progress={progress}
        result={result}
        isRunning={isRunning}
        lastAction={lastAction}
        onCancel={() => void cancel()}
        onUndo={(token) => void undo(token)}
        onDismiss={dismiss}
      />

      {/* Folder confirm dialog */}
      <AnimatePresence>
        {pending && (
          <FolderConfirmDialog
            pending={pending}
            onConfirm={() => void confirm()}
            onCancel={cancelFolder}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
