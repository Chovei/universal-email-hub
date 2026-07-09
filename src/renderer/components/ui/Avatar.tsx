import { cn, getInitials, getAvatarColor } from '../../lib/utils'

interface AvatarProps {
  name?: string | null
  email: string
  size?: 'xs' | 'sm' | 'md' | 'lg'
  className?: string
}

const sizes = {
  xs: 'w-5 h-5 text-[9px]',
  sm: 'w-7 h-7 text-[11px]',
  md: 'w-8 h-8 text-xs',
  lg: 'w-10 h-10 text-sm',
}

export function Avatar({ name, email, size = 'md', className }: AvatarProps) {
  const initials = getInitials(name, email)
  const color = getAvatarColor(email)

  return (
    <div
      className={cn(
        'flex items-center justify-center rounded-full font-semibold text-white shrink-0 select-none',
        sizes[size],
        className
      )}
      style={{ backgroundColor: color }}
      title={name ?? email}
    >
      {initials}
    </div>
  )
}
