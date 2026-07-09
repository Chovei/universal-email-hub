import { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronDown, ChevronUp, Star, Reply, Forward, Paperclip, Download } from 'lucide-react'
import { cn, formatDateLong, formatBytes } from '../../lib/utils'
import { Avatar } from '../ui/Avatar'
import { useSettings } from '../../hooks/useSettings'
import type { MessageRow, AttachmentRow } from '@shared/types/db'

interface MessageBubbleProps {
  message: MessageRow & { attachments: AttachmentRow[] }
  isExpanded: boolean
  isLast: boolean
  onToggle: () => void
  onReply: () => void
  onForward: () => void
  onStar: () => void
  onDelete: () => void
}

export function MessageBubble({
  message,
  isExpanded,
  isLast,
  onToggle,
  onReply,
  onForward,
  onStar,
  onDelete,
}: MessageBubbleProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [iframeHeight, setIframeHeight] = useState(200)
  const { settings } = useSettings()
  const showRemoteImages = settings?.sync?.showRemoteImages ?? false

  useEffect(() => {
    // M4: Reset height when collapsing so re-expansion doesn't flash at
    //     the stale previous height before the load event fires.
    if (!isExpanded) {
      setIframeHeight(200)
      return
    }
    if (!iframeRef.current || !message.bodyHtml) return

    const iframe = iframeRef.current
    const remoteImageBlock = showRemoteImages
      ? ''
      : `img[src^="http://"], img[src^="https://"], img[src^="//"] { display: none !important; }`
    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <style>
            * { box-sizing: border-box; margin: 0; padding: 0; }
            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
              font-size: 14px;
              line-height: 1.6;
              color: #18181b;
              padding: 0;
              word-break: break-word;
            }
            a { color: #6366f1; }
            img { max-width: 100%; height: auto; }
            blockquote {
              border-left: 3px solid #e4e4e7;
              padding-left: 12px;
              margin: 8px 0;
              color: #71717a;
            }
            pre { overflow-x: auto; }
            ${remoteImageBlock}
          </style>
        </head>
        <body>${message.bodyHtml}</body>
      </html>
    `
    iframe.srcdoc = html

    const onLoad = () => {
      try {
        const h = iframe.contentDocument?.body.scrollHeight ?? 200
        setIframeHeight(Math.min(h + 40, 2000))
      } catch {
        setIframeHeight(400)
      }
    }

    iframe.addEventListener('load', onLoad)
    return () => iframe.removeEventListener('load', onLoad)
  }, [isExpanded, message.bodyHtml, showRemoteImages])

  const toNames = message.toAddresses
    .map((a) => a.name ?? a.address)
    .join(', ')

  return (
    <div
      className={cn(
        'border border-[var(--color-border)] rounded-[var(--radius-lg)] overflow-hidden bg-[var(--color-card)] transition-shadow',
        isLast && 'shadow-sm'
      )}
    >
      {/* Header */}
      <div
        className="flex items-start gap-3 p-4 cursor-pointer hover:bg-[var(--color-muted)] transition-colors"
        onClick={onToggle}
      >
        <Avatar
          name={message.fromName}
          email={message.fromAddress}
          size="md"
          className="shrink-0 mt-0.5"
        />

        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <span className="font-semibold text-sm text-[var(--color-foreground)]">
              {message.fromName ?? message.fromAddress}
            </span>
            <span className="text-[11px] text-[var(--color-muted-foreground)] shrink-0">
              {formatDateLong(message.date)}
            </span>
          </div>
          {!isExpanded && (
            <p className="text-xs text-[var(--color-muted-foreground)] truncate mt-0.5">
              {message.bodyText?.slice(0, 120) ?? ''}
            </p>
          )}
          {isExpanded && (
            <p className="text-xs text-[var(--color-muted-foreground)] mt-0.5">
              to {toNames}
            </p>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {message.hasAttachment && (
            <Paperclip className="w-3.5 h-3.5 text-[var(--color-muted-foreground)]" />
          )}
          {message.isStarred && (
            <Star className="w-3.5 h-3.5 fill-yellow-400 text-yellow-400" />
          )}
          {isExpanded ? (
            <ChevronUp className="w-4 h-4 text-[var(--color-muted-foreground)]" />
          ) : (
            <ChevronDown className="w-4 h-4 text-[var(--color-muted-foreground)]" />
          )}
        </div>
      </div>

      {/* Body */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeInOut' }}
          >
            {/* Email body */}
            <div className="px-4 pb-2">
              {message.bodyHtml ? (
                <iframe
                  ref={iframeRef}
                  sandbox="allow-same-origin"
                  className="w-full border-0 block"
                  style={{ height: iframeHeight }}
                  title="Email content"
                />
              ) : (
                <pre className="text-sm text-[var(--color-foreground)] whitespace-pre-wrap font-sans leading-relaxed py-2">
                  {message.bodyText ?? '(Empty message)'}
                </pre>
              )}
            </div>

            {/* Attachments */}
            {message.attachments.length > 0 && (
              <div className="px-4 pb-4 pt-2 border-t border-[var(--color-border)]">
                <p className="text-xs font-medium text-[var(--color-muted-foreground)] mb-2">
                  {message.attachments.length} attachment{message.attachments.length !== 1 ? 's' : ''}
                </p>
                <div className="flex flex-wrap gap-2">
                  {message.attachments.map((att) => (
                    <AttachmentChip key={att.id} attachment={att} />
                  ))}
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center gap-1 px-4 py-2.5 border-t border-[var(--color-border)] bg-[var(--color-muted)]">
              <button
                onClick={(e) => { e.stopPropagation(); onReply() }}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-[var(--radius-md)] bg-[var(--color-card)] border border-[var(--color-border)] hover:bg-[var(--color-background)] transition-colors text-[var(--color-foreground)]"
              >
                <Reply className="w-3.5 h-3.5" />
                Reply
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); onForward() }}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-[var(--radius-md)] bg-[var(--color-card)] border border-[var(--color-border)] hover:bg-[var(--color-background)] transition-colors text-[var(--color-foreground)]"
              >
                <Forward className="w-3.5 h-3.5" />
                Forward
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); onStar() }}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-[var(--radius-md)] hover:bg-[var(--color-card)] border border-transparent hover:border-[var(--color-border)] transition-colors text-[var(--color-muted-foreground)]"
              >
                <Star className={cn('w-3.5 h-3.5', message.isStarred && 'fill-yellow-400 text-yellow-400')} />
                {message.isStarred ? 'Unstar' : 'Star'}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function AttachmentChip({ attachment }: { attachment: AttachmentRow }) {
  const handleDownload = async () => {
    try {
      await window.emailAPI.attachments.download(attachment.id)
    } catch {
      // handle error
    }
  }

  const handleOpen = async () => {
    try {
      const result = await window.emailAPI.attachments.download(attachment.id)
      if (result.localPath) await window.emailAPI.attachments.open(result.localPath)
    } catch {
      // handle error
    }
  }

  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-card)] hover:bg-[var(--color-muted)] transition-colors group cursor-pointer"
      onClick={handleOpen}
    >
      <div className="shrink-0">
        <Paperclip className="w-3.5 h-3.5 text-[var(--color-muted-foreground)]" />
      </div>
      <div className="min-w-0">
        <p className="text-xs font-medium text-[var(--color-foreground)] truncate max-w-[120px]">
          {attachment.filename}
        </p>
        <p className="text-[10px] text-[var(--color-muted-foreground)]">
          {formatBytes(attachment.size)}
        </p>
      </div>
      <button
        onClick={(e) => { e.stopPropagation(); void handleDownload() }}
        className="opacity-0 group-hover:opacity-100 transition-opacity"
      >
        <Download className="w-3.5 h-3.5 text-[var(--color-muted-foreground)] hover:text-[var(--color-primary)]" />
      </button>
    </div>
  )
}
