import { motion } from 'framer-motion'
import type { PendingFolderAction } from '../../hooks/useFolderActions'

const ACTION_COPY: Record<string, { title: string; verb: string }> = {
  emptyTrash: { title: 'Empty Trash', verb: 'permanently delete' },
  emptySpam: { title: 'Empty Spam', verb: 'permanently delete' },
  deleteAll: { title: 'Delete All Emails', verb: 'move to Trash' },
}

interface FolderConfirmDialogProps {
  pending: PendingFolderAction
  onConfirm: () => void
  onCancel: () => void
}

export function FolderConfirmDialog({ pending, onConfirm, onCancel }: FolderConfirmDialogProps) {
  const { request, folder } = pending
  const copy = ACTION_COPY[request.action]
  if (!copy) return null

  const count = folder?.totalCount ?? 0
  const storageEstimateMB = count > 0 ? Math.round((count * 75_000) / (1024 * 1024)) : 0
  const isGlobal = !folder
  const scope = isGlobal ? 'all accounts' : folder.name

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel() }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 8 }}
        transition={{ duration: 0.15, ease: 'easeOut' }}
        className="w-80 rounded-2xl bg-[var(--color-background)] border border-[var(--color-border)] shadow-2xl p-5 space-y-4"
      >
        {/* Header */}
        <div>
          <h2 className="font-semibold text-base text-[var(--color-foreground)]">{copy.title}</h2>
          <p className="text-xs text-[var(--color-muted-foreground)] mt-0.5">{scope}</p>
        </div>

        {/* Details */}
        <div className="space-y-1.5 text-sm text-[var(--color-foreground)]">
          {count > 0 ? (
            <p>
              This will {copy.verb}{' '}
              <span className="font-semibold">{count.toLocaleString()} email{count !== 1 ? 's' : ''}</span>.
              {isGlobal && ' This affects all connected accounts.'}
            </p>
          ) : (
            <p>
              This will {copy.verb} all emails
              {isGlobal ? ' across all connected accounts' : ` in ${folder?.name ?? 'this folder'}`}.
            </p>
          )}
          {count > 0 && (
            <p className="text-xs text-[var(--color-muted-foreground)]">
              Estimated storage recovered: ~{storageEstimateMB} MB
            </p>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-2 pt-1">
          <button
            onClick={onCancel}
            className="flex-1 py-2 rounded-xl text-sm font-medium bg-[var(--color-muted)] text-[var(--color-foreground)] hover:bg-[var(--color-border)] transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 py-2 rounded-xl text-sm font-medium bg-red-500 text-white hover:bg-red-600 transition-colors"
          >
            Continue
          </button>
        </div>
      </motion.div>
    </div>
  )
}
