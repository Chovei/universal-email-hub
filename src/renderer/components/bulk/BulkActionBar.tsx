import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  X, Archive, Trash2, MailOpen, Mail, Star, StarOff,
  FolderInput, AlertTriangle, ShieldCheck, Download, Copy, MoreHorizontal,
} from 'lucide-react'
import { cn } from '../../lib/utils'
import { useSelectionStore, selectIsSelectionMode } from '../../stores/selectionStore'
import type { BulkAction } from '@shared/types/ipc'

interface BulkActionBarProps {
  onAction: (action: BulkAction, threadIds: string[]) => void
}

const PRIMARY: { action: BulkAction; icon: React.ReactNode; label: string; destructive?: boolean }[] = [
  { action: 'archive', icon: <Archive className="w-4 h-4" />, label: 'Archive' },
  { action: 'delete', icon: <Trash2 className="w-4 h-4" />, label: 'Delete', destructive: true },
  { action: 'markRead', icon: <MailOpen className="w-4 h-4" />, label: 'Read' },
  { action: 'markUnread', icon: <Mail className="w-4 h-4" />, label: 'Unread' },
  { action: 'star', icon: <Star className="w-4 h-4" />, label: 'Star' },
  { action: 'move', icon: <FolderInput className="w-4 h-4" />, label: 'Move' },
]

const MORE: { action: BulkAction; icon: React.ReactNode; label: string; destructive?: boolean }[] = [
  { action: 'unstar', icon: <StarOff className="w-4 h-4" />, label: 'Unstar' },
  { action: 'spam', icon: <AlertTriangle className="w-4 h-4" />, label: 'Spam', destructive: true },
  { action: 'notSpam', icon: <ShieldCheck className="w-4 h-4" />, label: 'Not Spam' },
  { action: 'copy', icon: <Copy className="w-4 h-4" />, label: 'Copy to…' },
  { action: 'export', icon: <Download className="w-4 h-4" />, label: 'Export' },
]

export function BulkActionBar({ onAction }: BulkActionBarProps) {
  const { selectedIds, deselectAll } = useSelectionStore()
  const isSelectionMode = useSelectionStore(selectIsSelectionMode)
  const [showMore, setShowMore] = useState(false)
  const [confirmAction, setConfirmAction] = useState<BulkAction | null>(null)

  const count = selectedIds.size
  const ids = [...selectedIds]

  const dispatch = (action: BulkAction) => {
    if (action === 'delete' || action === 'spam') {
      setConfirmAction(action)
      setShowMore(false)
      return
    }
    onAction(action, ids)
    setShowMore(false)
  }

  const confirm = () => {
    if (confirmAction) { onAction(confirmAction, ids); setConfirmAction(null) }
  }

  return (
    <AnimatePresence>
      {isSelectionMode && (
        <motion.div
          initial={{ opacity: 0, y: 16, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 16, scale: 0.96 }}
          transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 pointer-events-none"
        >
          <div className="relative pointer-events-auto flex items-center gap-1 px-3 py-2 rounded-2xl bg-[var(--color-foreground)] text-[var(--color-background)] shadow-2xl min-w-max select-none">

            {/* Destructive confirm overlay */}
            <AnimatePresence>
              {confirmAction && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.12 }}
                  className="absolute inset-0 rounded-2xl bg-[var(--color-foreground)] flex items-center gap-3 px-4"
                >
                  <span className="text-sm text-[var(--color-background)]/75 flex-1">
                    {confirmAction === 'delete'
                      ? `Move ${count.toLocaleString()} emails to trash?`
                      : `Mark ${count.toLocaleString()} emails as spam?`}
                  </span>
                  <button
                    onClick={() => setConfirmAction(null)}
                    className="px-3 py-1 rounded-lg text-xs font-medium bg-white/15 hover:bg-white/25 transition-colors text-[var(--color-background)]"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={confirm}
                    className="px-3 py-1 rounded-lg text-xs font-medium bg-red-500 hover:bg-red-400 transition-colors text-white"
                  >
                    Confirm
                  </button>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Clear button */}
            <button
              onClick={() => { deselectAll(); setConfirmAction(null) }}
              className="w-7 h-7 flex items-center justify-center rounded-xl hover:bg-white/15 transition-colors"
              title="Clear selection (Esc)"
            >
              <X className="w-4 h-4" />
            </button>

            {/* Count */}
            <span className="text-sm font-semibold px-2 tabular-nums min-w-[5rem] text-center">
              {count.toLocaleString()} selected
            </span>

            <div className="w-px h-5 bg-white/20 mx-1 shrink-0" />

            {/* Primary actions */}
            {PRIMARY.map(({ action, icon, label }) => (
              <button
                key={action}
                onClick={() => dispatch(action)}
                title={label}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-medium hover:bg-white/15 transition-colors whitespace-nowrap"
              >
                {icon}
                <span className="hidden md:inline">{label}</span>
              </button>
            ))}

            {/* More dropdown */}
            <div className="relative">
              <button
                onClick={() => setShowMore((v) => !v)}
                className="w-7 h-7 flex items-center justify-center rounded-xl hover:bg-white/15 transition-colors"
                title="More actions"
              >
                <MoreHorizontal className="w-4 h-4" />
              </button>

              <AnimatePresence>
                {showMore && (
                  <motion.div
                    initial={{ opacity: 0, y: 6, scale: 0.96 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 6, scale: 0.96 }}
                    transition={{ duration: 0.15 }}
                    className="absolute bottom-full mb-2 right-0 min-w-[168px] rounded-xl bg-[var(--color-background)] border border-[var(--color-border)] shadow-xl py-1"
                  >
                    {MORE.map(({ action, icon, label, destructive }) => (
                      <button
                        key={action}
                        onClick={() => dispatch(action)}
                        className={cn(
                          'flex items-center gap-2.5 w-full px-3 py-2 text-sm transition-colors',
                          destructive
                            ? 'text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30'
                            : 'text-[var(--color-foreground)] hover:bg-[var(--color-muted)]'
                        )}
                      >
                        {icon}{label}
                      </button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
