import { cn } from '../../lib/utils'

interface BadgeProps {
  count: number
  className?: string
}

export function UnreadBadge({ count, className }: BadgeProps) {
  if (count <= 0) return null
  return (
    <span
      className={cn(
        'inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[11px] font-semibold bg-[var(--color-primary)] text-white leading-none',
        className
      )}
    >
      {count > 99 ? '99+' : count}
    </span>
  )
}

export function UnreadDot({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'inline-block w-2 h-2 rounded-full bg-[var(--color-unread-dot)] shrink-0',
        className
      )}
    />
  )
}
