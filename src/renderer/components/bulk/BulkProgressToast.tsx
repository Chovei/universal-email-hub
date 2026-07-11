import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, CheckCircle, AlertCircle, Undo2 } from 'lucide-react'
import type { BulkAction, BulkProgress, BulkResult } from '@shared/types/ipc'

const VERB: Partial<Record<BulkAction, string>> = {
  archive: 'Archiving', delete: 'Deleting', move: 'Moving',
  markRead: 'Marking read', markUnread: 'Marking unread',
  star: 'Starring', unstar: 'Unstarring',
  spam: 'Marking as spam', notSpam: 'Removing spam flag',
  export: 'Exporting', copy: 'Copying',
}
const PAST: Partial<Record<BulkAction, string>> = {
  archive: 'archived', delete: 'moved to trash', move: 'moved',
  markRead: 'marked read', markUnread: 'marked unread',
  star: 'starred', unstar: 'unstarred',
  spam: 'marked as spam', notSpam: 'unmarked spam',
  export: 'exported', copy: 'copied',
}

interface Props {
  progress: BulkProgress | null
  result: BulkResult | null
  isRunning: boolean
  lastAction: BulkAction | null
  onCancel: () => void
  onUndo: (token: string) => void
  onDismiss: () => void
}

export function BulkProgressToast({ progress, result, isRunning, lastAction, onCancel, onUndo, onDismiss }: Props) {
  const [undoCountdown, setUndoCountdown] = useState<number | null>(null)
  const isVisible = isRunning || !!result

  useEffect(() => {
    if (!result?.undoToken) return
    setUndoCountdown(30)
    const id = setInterval(() => {
      setUndoCountdown((c) => {
        if (c === null || c <= 1) { clearInterval(id); return null }
        return c - 1
      })
    }, 1000)
    return () => clearInterval(id)
  }, [result])

  // Auto-dismiss non-undo results after 4 s
  useEffect(() => {
    if (result && !result.undoToken && result.failed === 0) {
      const t = setTimeout(onDismiss, 4000)
      return () => clearTimeout(t)
    }
  }, [result, onDismiss])

  const action = progress?.action ?? result?.action ?? lastAction

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          initial={{ opacity: 0, y: 8, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 8, scale: 0.97 }}
          transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
          className="fixed bottom-6 right-6 z-50 w-80"
        >
          <div className="rounded-2xl bg-[var(--color-background)] border border-[var(--color-border)] shadow-2xl p-4 space-y-3">
            {isRunning && progress && (
              <>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-[var(--color-foreground)]">
                    {VERB[progress.action] ?? 'Processing'}…
                  </span>
                  <button
                    onClick={onCancel}
                    className="text-xs text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] px-2 py-0.5 rounded hover:bg-[var(--color-muted)] transition-colors"
                  >
                    Cancel
                  </button>
                </div>
                <div className="h-1.5 bg-[var(--color-muted)] rounded-full overflow-hidden">
                  <motion.div
                    className="h-full bg-[var(--color-primary)] rounded-full origin-left"
                    animate={{ scaleX: progress.percentage / 100 }}
                    transition={{ duration: 0.3, ease: 'easeOut' }}
                    style={{ transformOrigin: 'left' }}
                  />
                </div>
                <div className="flex justify-between text-xs text-[var(--color-muted-foreground)]">
                  <span>{progress.completed.toLocaleString()} / {progress.total.toLocaleString()}</span>
                  {progress.estimatedSecondsRemaining > 0 && (
                    <span>~{progress.estimatedSecondsRemaining}s</span>
                  )}
                </div>
              </>
            )}

            {result && !isRunning && (
              <div className="flex items-center gap-3">
                {result.failed === 0
                  ? <CheckCircle className="w-5 h-5 text-green-500 shrink-0" />
                  : <AlertCircle className="w-5 h-5 text-amber-500 shrink-0" />}
                <p className="flex-1 text-sm text-[var(--color-foreground)]">
                  {result.succeeded.toLocaleString()} emails {PAST[action ?? 'archive'] ?? 'processed'}.
                  {result.failed > 0 && ` ${result.failed} failed.`}
                </p>
                {result.undoToken && undoCountdown !== null && (
                  <button
                    onClick={() => { onUndo(result.undoToken!); setUndoCountdown(null) }}
                    className="flex items-center gap-1 text-xs font-medium text-[var(--color-primary)] hover:underline shrink-0"
                  >
                    <Undo2 className="w-3.5 h-3.5" />
                    Undo ({undoCountdown}s)
                  </button>
                )}
                <button
                  onClick={onDismiss}
                  className="w-6 h-6 flex items-center justify-center rounded hover:bg-[var(--color-muted)] transition-colors shrink-0"
                >
                  <X className="w-3.5 h-3.5 text-[var(--color-muted-foreground)]" />
                </button>
              </div>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
