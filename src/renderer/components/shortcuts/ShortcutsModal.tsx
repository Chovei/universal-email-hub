import { motion } from 'framer-motion'
import { Keyboard, X } from 'lucide-react'

interface ShortcutRow {
  keys: string[]
  label: string
}

interface ShortcutGroup {
  title: string
  rows: ShortcutRow[]
}

// Only shortcuts that are actually wired up — this list is the contract
const GROUPS: ShortcutGroup[] = [
  {
    title: 'General',
    rows: [
      { keys: ['Ctrl', 'Shift', 'P'], label: 'Open command palette' },
      { keys: ['/'], label: 'Focus search' },
      { keys: ['Ctrl', 'Shift', 'V'], label: 'Open Verification Center' },
      { keys: ['Ctrl', '/'], label: 'Show this overview' },
      { keys: ['Esc'], label: 'Close dialogs / clear selection' },
    ],
  },
  {
    title: 'Mail list',
    rows: [
      { keys: ['↑', '↓'], label: 'Move between conversations' },
      { keys: ['Ctrl', 'A'], label: 'Select all conversations' },
    ],
  },
  {
    title: 'Verification Center',
    rows: [{ keys: ['C'], label: 'Copy the newest code' }],
  },
]

export function ShortcutsModal({ onClose }: { onClose: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.12 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: -8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: -8 }}
        transition={{ duration: 0.15, ease: 'easeOut' }}
        className="w-[440px] max-w-[90vw] max-h-[80vh] overflow-y-auto rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2.5 px-5 py-4 border-b border-[var(--color-border)]">
          <Keyboard className="w-4 h-4 text-[var(--color-primary)]" />
          <h2 className="flex-1 text-sm font-semibold text-[var(--color-foreground)]">
            Keyboard shortcuts
          </h2>
          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-[var(--color-accent)] text-[var(--color-muted-foreground)] transition-colors"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-4 flex flex-col gap-5">
          {GROUPS.map((group) => (
            <div key={group.title}>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--color-muted-foreground)] mb-2">
                {group.title}
              </p>
              <div className="flex flex-col gap-1.5">
                {group.rows.map((row) => (
                  <div key={row.label} className="flex items-center justify-between gap-4">
                    <span className="text-sm text-[var(--color-foreground)]">{row.label}</span>
                    <span className="flex items-center gap-1 shrink-0">
                      {row.keys.map((key) => (
                        <kbd
                          key={key}
                          className="min-w-[22px] text-center text-[11px] font-mono bg-[var(--color-muted)] text-[var(--color-foreground)] border border-[var(--color-border)] px-1.5 py-0.5 rounded"
                        >
                          {key}
                        </kbd>
                      ))}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </motion.div>
    </motion.div>
  )
}
