import { useRef, useEffect, useCallback } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { RefreshCw, Inbox } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { ThreadItem } from './ThreadItem'
import { ThreadItemSkeleton } from '../ui/Skeleton'
import { cn } from '../../lib/utils'
import { useMessages } from '../../hooks/useMessages'
import { useMailboxStore } from '../../stores/mailboxStore'
import { useAccountStore } from '../../stores/accountStore'
import { useUIStore } from '../../stores/uiStore'
import type { ThreadRow } from '@shared/types/db'

const ITEM_HEIGHT = { compact: 68, comfortable: 88, spacious: 108 }

interface ThreadListProps {
  className?: string
}

export function ThreadList({ className }: ThreadListProps) {
  const { activeAccountId } = useAccountStore()
  const { selectedFolderType, selectedThreadId, selectThread } = useMailboxStore()
  const { density } = useUIStore()
  const parentRef = useRef<HTMLDivElement>(null)

  const singleAccountId = activeAccountId === 'unified' ? null : activeAccountId

  const isStarred = selectedFolderType === 'starred'
  const { threads, isLoading, isFetchingNextPage, hasNextPage, fetchNextPage } = useMessages({
    accountId: singleAccountId ?? undefined,
    folderType: isStarred ? undefined : selectedFolderType,
    starredOnly: isStarred ? true : undefined,
    limit: 50,
  })

  const itemHeight = ITEM_HEIGHT[density]

  const virtualizer = useVirtualizer({
    count: threads.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => itemHeight,
    overscan: 10,
  })

  // Infinite scroll — trigger at 80% scroll depth
  const handleScroll = useCallback(() => {
    const el = parentRef.current
    if (!el || !hasNextPage || isFetchingNextPage) return
    const { scrollTop, scrollHeight, clientHeight } = el
    if (scrollTop + clientHeight >= scrollHeight * 0.8) {
      void fetchNextPage()
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])

  useEffect(() => {
    const el = parentRef.current
    if (!el) return
    el.addEventListener('scroll', handleScroll, { passive: true })
    return () => el.removeEventListener('scroll', handleScroll)
  }, [handleScroll])

  // Keyboard navigation
  // M1: Guard against intercepting arrow keys when focus is inside an input,
  //     textarea, or contenteditable (composer, search bar, etc.).
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable
      ) return
      if (!threads.length) return
      const current = selectedThreadId ? threads.findIndex((t) => t.id === selectedThreadId) : -1
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        const next = threads[current + 1]
        if (next) selectThread(next.id)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        const prev = threads[current - 1]
        if (prev) selectThread(prev.id)
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [threads, selectedThreadId, selectThread])

  if (isLoading) {
    return (
      <div className={cn('flex flex-col h-full bg-[var(--color-background)]', className)}>
        <ThreadListHeader threadCount={0} isLoading />
        {Array.from({ length: 8 }).map((_, i) => (
          <ThreadItemSkeleton key={i} />
        ))}
      </div>
    )
  }

  return (
    <div className={cn('flex flex-col h-full bg-[var(--color-background)]', className)}>
      <ThreadListHeader threadCount={threads.length} isLoading={false} />

      {threads.length === 0 ? (
        <EmptyState />
      ) : (
        <div ref={parentRef} className="flex-1 overflow-y-auto">
          <div
            style={{ height: `${virtualizer.getTotalSize()}px`, position: 'relative' }}
          >
            {virtualizer.getVirtualItems().map((virtualItem) => {
              const thread = threads[virtualItem.index]!
              return (
                <div
                  key={virtualItem.key}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    transform: `translateY(${virtualItem.start}px)`,
                  }}
                >
                  <ThreadItem
                    thread={thread}
                    isSelected={selectedThreadId === thread.id}
                    density={density}
                    onClick={() => selectThread(thread.id)}
                  />
                </div>
              )
            })}
          </div>

          {isFetchingNextPage && (
            <div className="flex items-center justify-center py-4">
              <RefreshCw className="w-4 h-4 animate-spin text-[var(--color-muted-foreground)]" />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function ThreadListHeader({
  threadCount,
  isLoading,
}: {
  threadCount: number
  isLoading: boolean
}) {
  const { selectedFolderType } = useMailboxStore()
  const folderLabel = selectedFolderType.charAt(0).toUpperCase() + selectedFolderType.slice(1)

  return (
    <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)] bg-[var(--color-background)] shrink-0">
      <div>
        <h2 className="text-sm font-semibold text-[var(--color-foreground)]">{folderLabel}</h2>
        {!isLoading && (
          <p className="text-[11px] text-[var(--color-muted-foreground)] mt-0.5">
            {threadCount === 0 ? 'No messages' : `${threadCount} conversations`}
          </p>
        )}
      </div>
    </div>
  )
}

function EmptyState() {
  const { selectedFolderType } = useMailboxStore()

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col items-center justify-center flex-1 gap-3 px-8 text-center"
    >
      <div className="w-14 h-14 rounded-2xl bg-[var(--color-muted)] flex items-center justify-center">
        <Inbox className="w-7 h-7 text-[var(--color-muted-foreground)]" />
      </div>
      <div>
        <p className="text-sm font-medium text-[var(--color-foreground)]">All caught up!</p>
        <p className="text-xs text-[var(--color-muted-foreground)] mt-1">
          No messages in {selectedFolderType}
        </p>
      </div>
    </motion.div>
  )
}
