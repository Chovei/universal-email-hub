import { motion } from 'framer-motion'
import { Paperclip, Star } from 'lucide-react'
import { cn, formatDate, truncate } from '../../lib/utils'
import { Avatar } from '../ui/Avatar'
import { UnreadDot } from '../ui/Badge'
import type { ThreadRow } from '@shared/types/db'

interface ThreadItemProps {
  thread: ThreadRow
  isSelected: boolean
  density: 'compact' | 'comfortable' | 'spacious'
  onClick: () => void
}

const paddingY = {
  compact: 'py-2',
  comfortable: 'py-3',
  spacious: 'py-4',
}

export function ThreadItem({ thread, isSelected, density, onClick }: ThreadItemProps) {
  const isUnread = thread.unreadCount > 0
  const firstParticipant = thread.participantAddresses[0]
  const displayName = firstParticipant?.name ?? firstParticipant?.address ?? 'Unknown'

  return (
    <motion.div
      layout
      onClick={onClick}
      whileTap={{ scale: 0.995 }}
      className={cn(
        'flex items-start gap-3 px-4 cursor-pointer transition-colors border-b border-[var(--color-border)]',
        paddingY[density],
        isSelected
          ? 'bg-[var(--color-thread-selected)]'
          : 'hover:bg-[var(--color-muted)] bg-[var(--color-background)]'
      )}
    >
      {/* Avatar */}
      <div className="relative shrink-0 mt-0.5">
        <Avatar
          name={firstParticipant?.name}
          email={firstParticipant?.address ?? ''}
          size="md"
        />
        {thread.messageCount > 1 && (
          <span className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-[var(--color-muted)] border border-[var(--color-border)] text-[9px] flex items-center justify-center font-semibold text-[var(--color-muted-foreground)]">
            {thread.messageCount > 99 ? '99' : thread.messageCount}
          </span>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        {/* Row 1: sender + date */}
        <div className="flex items-center gap-2 mb-0.5">
          <span
            className={cn(
              'flex-1 truncate text-sm',
              isUnread
                ? 'font-semibold text-[var(--color-foreground)]'
                : 'font-normal text-[var(--color-foreground)]'
            )}
          >
            {displayName}
          </span>
          <span className="shrink-0 text-[11px] text-[var(--color-muted-foreground)]">
            {formatDate(thread.lastMessageAt)}
          </span>
        </div>

        {/* Row 2: subject */}
        <div
          className={cn(
            'text-[13px] truncate mb-0.5',
            isUnread
              ? 'font-medium text-[var(--color-foreground)]'
              : 'font-normal text-[var(--color-foreground)] opacity-80'
          )}
        >
          {thread.subject || '(No Subject)'}
        </div>

        {/* Row 3: snippet + indicators */}
        <div className="flex items-center gap-1.5">
          <span className="flex-1 text-xs text-[var(--color-muted-foreground)] truncate">
            {thread.snippet}
          </span>
          <div className="flex items-center gap-1 shrink-0">
            {thread.hasAttachment && (
              <Paperclip className="w-3 h-3 text-[var(--color-muted-foreground)]" />
            )}
            {thread.isStarred && (
              <Star className="w-3 h-3 fill-yellow-400 text-yellow-400" />
            )}
            {isUnread && <UnreadDot />}
          </div>
        </div>

        {/* Labels */}
        {thread.labels.length > 0 && (
          <div className="flex gap-1 mt-1 flex-wrap">
            {thread.labels.slice(0, 3).map((label) => (
              <span
                key={label}
                className="inline-block px-1.5 py-0.5 rounded text-[10px] font-medium bg-[var(--color-muted)] text-[var(--color-muted-foreground)]"
              >
                {label}
              </span>
            ))}
          </div>
        )}
      </div>
    </motion.div>
  )
}
