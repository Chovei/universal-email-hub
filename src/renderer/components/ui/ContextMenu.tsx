import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import { cn } from '../../lib/utils'

export interface ContextMenuItem {
  label: string
  icon?: React.ReactNode
  destructive?: boolean
  disabled?: boolean
  onClick: () => void
}

export interface ContextMenuGroup {
  items: ContextMenuItem[]
}

interface ContextMenuProps {
  x: number
  y: number
  groups: ContextMenuGroup[]
  onClose: () => void
}

export function ContextMenu({ x, y, groups, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null)

  // Adjust position so menu never overflows the viewport
  const adjustedX = Math.min(x, window.innerWidth - 208)
  const adjustedY = Math.min(y, window.innerHeight - 48 * groups.flatMap((g) => g.items).length)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    const onMouse = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onMouse)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onMouse)
    }
  }, [onClose])

  return createPortal(
    <motion.div
      ref={ref}
      initial={{ opacity: 0, scale: 0.95, y: -4 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95, y: -4 }}
      transition={{ duration: 0.1, ease: 'easeOut' }}
      style={{ position: 'fixed', left: adjustedX, top: adjustedY, zIndex: 9999 }}
      className="min-w-52 rounded-xl bg-[var(--color-background)] border border-[var(--color-border)] shadow-2xl py-1.5 overflow-hidden"
    >
      {groups.map((group, gi) => (
        <div key={gi}>
          {gi > 0 && <div className="my-1 border-t border-[var(--color-border)]" />}
          {group.items.map((item, ii) => (
            <button
              key={ii}
              disabled={item.disabled}
              onClick={() => { item.onClick(); onClose() }}
              className={cn(
                'w-full flex items-center gap-2.5 px-3 py-1.5 text-sm text-left transition-colors',
                item.destructive
                  ? 'text-red-500 hover:bg-red-500/10'
                  : 'text-[var(--color-foreground)] hover:bg-[var(--color-muted)]',
                item.disabled && 'opacity-40 cursor-not-allowed pointer-events-none',
              )}
            >
              {item.icon && <span className="shrink-0 opacity-70">{item.icon}</span>}
              {item.label}
            </button>
          ))}
        </div>
      ))}
    </motion.div>,
    document.body,
  )
}
