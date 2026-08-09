import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Archive, Trash2, Star, ChevronLeft, Mail } from 'lucide-react'
import { MessageBubble } from './MessageBubble'
import { MessageSkeleton } from '../ui/Skeleton'
import { cn } from '../../lib/utils'
import { useThread } from '../../hooks/useThread'
import { useMailboxStore } from '../../stores/mailboxStore'
import { useComposeStore } from '../../stores/composeStore'

export function MessageReader() {
  const { selectedThreadId, closeThreadPanel } = useMailboxStore()
  const { thread, messages, isLoading, markRead, star, deleteMessages } =
    useThread(selectedThreadId)
  const { openComposer } = useComposeStore()

  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())

  // Auto-expand latest message and mark as read
  useEffect(() => {
    if (messages.length > 0) {
      const last = messages[0] // newest first
      setExpandedIds(new Set([last.id]))

      const unreadIds = messages.filter((m) => !m.isRead).map((m) => m.id)
      if (unreadIds.length > 0) {
        void markRead({ messageIds: unreadIds, read: true })
      }
    }
  }, [messages, markRead])

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  if (!selectedThreadId) {
    return <EmptyReaderState />
  }

  if (isLoading) {
    return (
      <div className="flex flex-col h-full bg-[var(--color-background)]">
        <div className="h-14 border-b border-[var(--color-border)] bg-[var(--color-background)] shrink-0" />
        <MessageSkeleton />
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full bg-[var(--color-background)]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)] shrink-0 bg-[var(--color-background)]">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <button
            onClick={closeThreadPanel}
            className="p-1.5 rounded-[var(--radius-md)] hover:bg-[var(--color-muted)] transition-colors md:hidden"
          >
            <ChevronLeft className="w-4 h-4 text-[var(--color-muted-foreground)]" />
          </button>
          <h1 className="text-sm font-semibold text-[var(--color-foreground)] truncate">
            {thread?.subject ?? '(No Subject)'}
          </h1>
          {thread && thread.messageCount > 1 && (
            <span className="text-xs text-[var(--color-muted-foreground)] shrink-0">
              {thread.messageCount} messages
            </span>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 shrink-0">
          <ActionButton
            icon={<Archive className="w-4 h-4" />}
            label="Archive"
            onClick={() => {
              if (messages.length > 0) {
                void window.emailAPI.messages.archive(messages.map((m) => m.id))
                closeThreadPanel()
              }
            }}
          />
          <ActionButton
            icon={<Trash2 className="w-4 h-4" />}
            label="Delete"
            onClick={() => {
              if (messages.length > 0) {
                void deleteMessages(messages.map((m) => m.id))
                closeThreadPanel()
              }
            }}
            className="text-[var(--color-destructive)] hover:bg-red-50 dark:hover:bg-red-950"
          />
          <ActionButton
            icon={<Star className={cn('w-4 h-4', thread?.isStarred && 'fill-yellow-400 text-yellow-400')} />}
            label="Star"
            onClick={() => {
              if (messages.length > 0) {
                void star({ messageIds: messages.map((m) => m.id), starred: !thread?.isStarred })
              }
            }}
          />
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-4 py-4 space-y-3">
          <AnimatePresence initial={false}>
            {[...messages].reverse().map((message, idx) => (
              <motion.div
                key={message.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.04, duration: 0.2 }}
              >
                <MessageBubble
                  message={message}
                  isExpanded={expandedIds.has(message.id)}
                  isLast={idx === messages.length - 1}
                  onToggle={() => toggleExpand(message.id)}
                  onReply={() => openComposer({ replyTo: message })}
                  onForward={() => openComposer({ forward: message })}
                  onStar={() => void star({ messageIds: [message.id], starred: !message.isStarred })}
                  onDelete={() => void deleteMessages([message.id])}
                />
              </motion.div>
            ))}
          </AnimatePresence>

          {/* Reply bar */}
          <div
            onClick={() => {
              const lastMsg = messages[0]
              if (lastMsg) openComposer({ replyTo: lastMsg })
            }}
            className="flex items-center gap-3 px-4 py-3 border border-[var(--color-border)] rounded-[var(--radius-lg)] cursor-text hover:shadow-sm transition-shadow bg-[var(--color-card)]"
          >
            <Mail className="w-4 h-4 text-[var(--color-muted-foreground)] shrink-0" />
            <span className="text-sm text-[var(--color-muted-foreground)]">
              Reply to thread…
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

function ActionButton({
  icon,
  label,
  onClick,
  className,
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
  className?: string
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      className={cn(
        'p-1.5 rounded-[var(--radius-md)] hover:bg-[var(--color-muted)] transition-colors text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]',
        className
      )}
    >
      {icon}
    </button>
  )
}

function EmptyReaderState() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="flex flex-col items-center justify-center h-full gap-3 text-center px-8"
    >
      <div className="w-16 h-16 rounded-2xl bg-[var(--color-muted)] flex items-center justify-center">
        <Mail className="w-8 h-8 text-[var(--color-muted-foreground)]" />
      </div>
      <div>
        <p className="text-sm font-medium text-[var(--color-foreground)]">
          Select a conversation
        </p>
        <p className="text-xs text-[var(--color-muted-foreground)] mt-1">
          Choose a thread from the list to read it here
        </p>
      </div>
    </motion.div>
  )
}
