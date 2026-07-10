import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Paperclip, Star, Check } from 'lucide-react'
import { cn, formatDate } from '../../lib/utils'
import { Avatar } from '../ui/Avatar'
import { UnreadDot } from '../ui/Badge'
import type { ThreadRow } from '@shared/types/db'

interface ThreadItemProps {
  thread: ThreadRow
  isSelected: boolean          // reading selection — opens in reader pane
  isBulkSelected: boolean      // bulk selection — checkbox state
  isSelectionMode: boolean     // true when any item is bulk-selected
  density: 'compact' | 'comfortable' | 'spacious'
  onClick: () => void          // reading selection click
  onBulkToggle: (id: string, e: React.MouseEvent) => void
}

const paddingY = {
  compact: 'py-2',
  comfortable: 'py-3',
  spacious: 'py-4',
}

export function ThreadItem({
  thread, isSelected, isBulkSelected, isSelectionMode,
  density, onClick, onBulkToggle,
}: ThreadItemProps) {
  const isUnread = thread.unreadCount > 0
  const firstParticipant = thread.participantAddresses[0]
  const displayName = firstParticipant?.name ?? firstParticipant?.address ?? 'Unknown'
  const [isHovered, setIsHovered] = useState(false)

  const showCheckbox = isHovered || isBulkSelected || isSelectionMode

  const handleRowClick = (e: React.MouseEvent) => {
    if (e.ctrlKey || e.metaKey || e.shiftKey) {
      onBulkToggle(thread.id, e)
      return
    }
    onClick()
  }

  return (
    <motion.div
      layout
      onClick={handleRowClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      whileTap={{ scale: 0.995 }}
      className={cn(
        'flex items-start gap-3 px-4 cursor-pointer transition-colors border-b border-[var(--color-border)]',
        paddingY[density],
        isBulkSelected
          ? 'bg-[var(--color-primary)]/8'
          : isSelected
          ? 'bg-[var(--color-thread-selected)]'
          : 'hover:bg-[var(--color-muted)] bg-[var(--color-background)]'
      )}
    >
      {/* Avatar / Checkbox area — fixed width so layout never shifts */}
      <div
        className="relative shrink-0 mt-0.5 w-9 h-9 flex items-center justify-center"
        onClick={(e) => { e.stopPropagation(); onBulkToggle(thread.id, e) }}
      >
        <AnimatePresence mode="wait" initial={false}>
          {showCheckbox ? (
            <motion.div
              key="checkbox"
              initial={{ opacity: 0, scale: 0.75 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.75 }}
              transition={{ duration: 0.15, ease: 'easeOut' }}
              className={cn(
                'w-5 h-5 rounded-full border-2 flex items-center justify-center cursor-pointer transition-colors',
                isBulkSelected
                  ? 'bg-[var(--color-primary)] border-[var(--color-primary)]'
                  : 'border-[var(--color-muted-foreground)] hover:border-[var(--color-primary)]'
              )}
            >
              {isBulkSelected && <Check className="w-3 h-3 text-white" strokeWidth={3} />}
            </motion.div>
          ) : (
            <motion.div
              key="avatar"
              initial={{ opacity: 0, scale: 0.75 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.75 }}
              transition={{ duration: 0.15, ease: 'easeOut' }}
              className="relative"
            >
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
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Content — unchanged from before */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className={cn(
            'flex-1 truncate text-sm',
            isUnread ? 'font-semibold text-[var(--color-foreground)]' : 'font-normal text-[var(--color-foreground)]'
          )}>
            {displayName}
          </span>
          <span className="shrink-0 text-[11px] text-[var(--color-muted-foreground)]">
            {formatDate(thread.lastMessageAt)}
          </span>
        </div>

        <div className={cn(
          'text-[13px] truncate mb-0.5',
          isUnread ? 'font-medium text-[var(--color-foreground)]' : 'font-normal text-[var(--color-foreground)] opacity-80'
        )}>
          {thread.subject || '(No Subject)'}
        </div>

        <div className="flex items-center gap-1.5">
          <span className="flex-1 text-xs text-[var(--color-muted-foreground)] truncate">
            {thread.snippet}
          </span>
          <div className="flex items-center gap-1 shrink-0">
            {thread.hasAttachment && <Paperclip className="w-3 h-3 text-[var(--color-muted-foreground)]" />}
            {thread.isStarred && <Star className="w-3 h-3 fill-yellow-400 text-yellow-400" />}
            {isUnread && <UnreadDot />}
          </div>
        </div>

        {thread.labels.length > 0 && (
          <div className="flex gap-1 mt-1 flex-wrap">
            {thread.labels.slice(0, 3).map((label) => (
              <span key={label} className="inline-block px-1.5 py-0.5 rounded text-[10px] font-medium bg-[var(--color-muted)] text-[var(--color-muted-foreground)]">
                {label}
              </span>
            ))}
          </div>
        )}
      </div>
    </motion.div>
  )
}
