import { useEffect, useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Download, RefreshCw, AlertTriangle, CheckCircle2 } from 'lucide-react'
import type { UpdateStatus } from '@shared/types/ipc'
import { cn } from '../../lib/utils'

type VisibleStatus = Extract<UpdateStatus, { type: 'available' | 'downloading' | 'downloaded' | 'error' }>

export function UpdateDialog() {
  const [status, setStatus] = useState<VisibleStatus | null>(null)

  useEffect(() => {
    const unsub = window.emailAPI.updater.onStatus((s) => {
      if (s.type === 'checking' || s.type === 'not-available') return
      setStatus(s)
    })
    return unsub
  }, [])

  const dismiss = useCallback(() => setStatus(null), [])

  const handleSkip = useCallback(async () => {
    if (status?.type === 'available') {
      await window.emailAPI.updater.skipVersion(status.version)
    }
    dismiss()
  }, [status, dismiss])

  const handleInstall = useCallback(async () => {
    await window.emailAPI.updater.install()
  }, [])

  return (
    <AnimatePresence>
      {status && (
        <motion.div
          key="update-dialog"
          initial={{ opacity: 0, y: 16, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 16, scale: 0.97 }}
          transition={{ type: 'spring', stiffness: 400, damping: 28 }}
          className="fixed bottom-6 right-6 z-50 w-[340px] rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-card)] shadow-2xl overflow-hidden"
        >
          {/* Colour stripe */}
          <div
            className={cn(
              'h-1 w-full',
              status.type === 'error'
                ? 'bg-red-500'
                : status.type === 'downloaded'
                  ? 'bg-green-500'
                  : 'bg-[var(--color-primary)]'
            )}
          />

          <div className="p-4">
            {/* Header */}
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <StatusIcon type={status.type} />
                <div>
                  <p className="text-sm font-semibold text-[var(--color-foreground)]">
                    {titleFor(status)}
                  </p>
                  {(status.type === 'available' || status.type === 'downloaded') && (
                    <p className="text-xs text-[var(--color-muted-foreground)] mt-0.5">
                      Version {status.version}
                    </p>
                  )}
                </div>
              </div>
              {status.type !== 'downloading' && (
                <button
                  onClick={dismiss}
                  className="p-1 rounded-[var(--radius-sm)] text-[var(--color-muted-foreground)] hover:bg-[var(--color-muted)] hover:text-[var(--color-foreground)] transition-colors shrink-0"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Release notes (available state only) */}
            {status.type === 'available' && status.releaseNotes && (
              <div className="mt-3 text-xs text-[var(--color-muted-foreground)] leading-relaxed line-clamp-3">
                {cleanNotes(status.releaseNotes)}
              </div>
            )}

            {/* Progress bar */}
            {status.type === 'downloading' && (
              <div className="mt-3">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs text-[var(--color-muted-foreground)]">Downloading…</span>
                  <span className="text-xs font-medium text-[var(--color-foreground)]">
                    {status.progress}%
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-[var(--color-muted)] overflow-hidden">
                  <motion.div
                    className="h-full rounded-full bg-[var(--color-primary)]"
                    initial={{ width: 0 }}
                    animate={{ width: `${status.progress}%` }}
                    transition={{ duration: 0.3, ease: 'easeOut' }}
                  />
                </div>
              </div>
            )}

            {/* Error detail */}
            {status.type === 'error' && (
              <p className="mt-2 text-xs text-red-400 break-words line-clamp-2">{status.error}</p>
            )}

            {/* Actions */}
            <div className="mt-4 flex items-center justify-end gap-2">
              {status.type === 'available' && (
                <>
                  <button
                    onClick={() => void handleSkip()}
                    className="px-3 py-1.5 text-xs text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] transition-colors"
                  >
                    Skip version
                  </button>
                  <button
                    onClick={dismiss}
                    className="px-3 py-1.5 text-xs rounded-[var(--radius-md)] border border-[var(--color-border)] text-[var(--color-foreground)] hover:bg-[var(--color-muted)] transition-colors"
                  >
                    Later
                  </button>
                  <span className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-[var(--radius-md)] bg-[var(--color-primary)]/70 text-white cursor-default select-none">
                    <Download className="w-3 h-3" />
                    Downloading…
                  </span>
                </>
              )}

              {status.type === 'downloaded' && (
                <>
                  <button
                    onClick={dismiss}
                    className="px-3 py-1.5 text-xs text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] transition-colors"
                  >
                    Later
                  </button>
                  <button
                    onClick={() => void handleInstall()}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-[var(--radius-md)] bg-[var(--color-primary)] text-white hover:opacity-90 transition-opacity"
                  >
                    <RefreshCw className="w-3 h-3" />
                    Restart Now
                  </button>
                </>
              )}

              {status.type === 'error' && (
                <>
                  <button
                    onClick={dismiss}
                    className="px-3 py-1.5 text-xs text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] transition-colors"
                  >
                    Dismiss
                  </button>
                  <button
                    onClick={() => void window.emailAPI.updater.check()}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-[var(--radius-md)] border border-[var(--color-border)] text-[var(--color-foreground)] hover:bg-[var(--color-muted)] transition-colors"
                  >
                    <RefreshCw className="w-3 h-3" />
                    Retry
                  </button>
                </>
              )}
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function StatusIcon({ type }: { type: VisibleStatus['type'] }) {
  const cls = 'w-8 h-8 rounded-[var(--radius-lg)] flex items-center justify-center shrink-0'

  if (type === 'error') {
    return (
      <div className={cn(cls, 'bg-red-500/10')}>
        <AlertTriangle className="w-4 h-4 text-red-500" />
      </div>
    )
  }
  if (type === 'downloaded') {
    return (
      <div className={cn(cls, 'bg-green-500/10')}>
        <CheckCircle2 className="w-4 h-4 text-green-500" />
      </div>
    )
  }
  if (type === 'downloading') {
    return (
      <div className={cn(cls, 'bg-[var(--color-primary)]/10')}>
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 1.2, repeat: Infinity, ease: 'linear' }}
        >
          <Download className="w-4 h-4 text-[var(--color-primary)]" />
        </motion.div>
      </div>
    )
  }
  return (
    <div className={cn(cls, 'bg-[var(--color-primary)]/10')}>
      <Download className="w-4 h-4 text-[var(--color-primary)]" />
    </div>
  )
}

function titleFor(status: VisibleStatus): string {
  switch (status.type) {
    case 'available': return 'Update Available'
    case 'downloading': return 'Downloading Update'
    case 'downloaded': return 'Ready to Install'
    case 'error': return 'Update Failed'
  }
}

function cleanNotes(raw: string): string {
  return raw
    .replace(/#{1,6}\s+/g, '')
    .replace(/^\s*[-*+]\s+/gm, '• ')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/`(.+?)`/g, '$1')
    .trim()
    .slice(0, 200)
}
