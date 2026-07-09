import { useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Minimize2, Send, Trash2, Paperclip, ChevronDown } from 'lucide-react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import Link from '@tiptap/extension-link'
import Underline from '@tiptap/extension-underline'
import { useUIStore } from '../../stores/uiStore'
import { useComposeStore, type DraftState } from '../../stores/composeStore'
import { useAccountStore } from '../../stores/accountStore'
import { cn } from '../../lib/utils'

interface RecipientInputProps {
  label: string
  values: { address: string; name?: string }[]
  onChange: (values: { address: string; name?: string }[]) => void
}

function RecipientTag({ value, onRemove }: { value: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[var(--color-primary)] text-white text-xs font-medium">
      {value}
      <button onClick={onRemove} className="hover:text-white/70">
        <X className="w-3 h-3" />
      </button>
    </span>
  )
}

function RecipientInput({ label, values, onChange }: RecipientInputProps) {
  return (
    <div className="flex items-start gap-2 px-4 py-2 border-b border-[var(--color-border)]">
      <span className="text-xs text-[var(--color-muted-foreground)] shrink-0 pt-1.5 w-6">{label}</span>
      <div className="flex flex-1 flex-wrap gap-1 items-center">
        {values.map((v, i) => (
          <RecipientTag
            key={i}
            value={v.name ?? v.address}
            onRemove={() => onChange(values.filter((_, j) => j !== i))}
          />
        ))}
        <input
          type="text"
          placeholder={values.length === 0 ? 'Add recipient…' : ''}
          className="flex-1 min-w-[120px] text-sm outline-none bg-transparent text-[var(--color-foreground)] placeholder:text-[var(--color-muted-foreground)]"
          onKeyDown={(e) => {
            if ((e.key === 'Enter' || e.key === ',' || e.key === ' ') && e.currentTarget.value.trim()) {
              e.preventDefault()
              const addr = e.currentTarget.value.trim().replace(/,$/, '')
              if (addr.includes('@')) {
                onChange([...values, { address: addr }])
                e.currentTarget.value = ''
              }
            }
            if (e.key === 'Backspace' && !e.currentTarget.value && values.length > 0) {
              onChange(values.slice(0, -1))
            }
          }}
        />
      </div>
    </div>
  )
}

function ComposerWindow({ draft }: { draft: DraftState }) {
  const { updateDraft, closeComposer, minimizeComposer, markSending, markSent } =
    useComposeStore()
  const { accounts } = useAccountStore()

  const editor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({ placeholder: 'Write your message…' }),
      Link.configure({ openOnClick: false }),
      Underline,
    ],
    content: draft.bodyHtml,
    onUpdate: ({ editor }) => {
      updateDraft(draft.id, { bodyHtml: editor.getHTML() })
    },
    editorProps: {
      attributes: {
        class:
          'min-h-[200px] outline-none text-sm text-[var(--color-foreground)] [&_.ProseMirror-selectednode]:outline-none prose prose-sm max-w-none',
      },
    },
  })

  const handleSend = useCallback(async () => {
    if (!draft.to.length) return
    markSending(draft.id)
    try {
      await window.emailAPI.compose.send({
        fromAccountId: (draft.fromAccountId || accounts[0]?.id) ?? '',
        to: draft.to,
        cc: draft.cc,
        bcc: draft.bcc,
        subject: draft.subject,
        bodyHtml: draft.bodyHtml,
        inReplyToRemoteId: draft.inReplyToRemoteId,
        attachmentPaths: draft.attachments.map((a) => a.localPath),
      })
      markSent(draft.id)
    } catch {
      markSending(draft.id) // reset
    }
  }, [draft, accounts, markSending, markSent])

  // H8: Was calling showSaveDialog (DIALOG_SAVE_FILE which had no handler,
  //     causing the invoke to hang forever).  Now uses showOpenDialog which
  //     maps to the registered DIALOG_OPEN_FILE handler.
  const handleAttachment = useCallback(async () => {
    const result = await window.emailAPI.shell.showOpenDialog()
    const paths = (result as { data?: string[] })?.data ?? []
    for (const filePath of paths) {
      try {
        const uploaded = await window.emailAPI.compose.uploadAttachment({
          accountId: (draft.fromAccountId || accounts[0]?.id) ?? '',
          filePath,
        })
        const data = (uploaded as { data?: { localPath: string; filename: string; mimeType: string; size: number } })?.data
        if (data) {
          updateDraft(draft.id, { attachments: [...draft.attachments, data] })
        }
      } catch {
        // ignore individual file failures
      }
    }
  }, [draft, accounts, updateDraft])

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 20, scale: 0.95 }}
      animate={draft.isMinimized ? { height: '44px' } : { opacity: 1, y: 0, scale: 1, height: 'auto' }}
      exit={{ opacity: 0, y: 20, scale: 0.95 }}
      className={cn(
        'bg-[var(--color-card)] rounded-t-[var(--radius-xl)] shadow-2xl border border-[var(--color-border)] w-[540px] flex flex-col overflow-hidden',
        draft.isMinimized ? 'h-11' : 'max-h-[520px]'
      )}
    >
      {/* Title bar */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)] bg-[var(--color-muted)] shrink-0">
        <span className="text-sm font-medium text-[var(--color-foreground)] truncate">
          {draft.subject || 'New Message'}
        </span>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => minimizeComposer(draft.id)}
            className="p-1 rounded hover:bg-[var(--color-border)] transition-colors text-[var(--color-muted-foreground)]"
          >
            <Minimize2 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => closeComposer(draft.id)}
            className="p-1 rounded hover:bg-[var(--color-border)] transition-colors text-[var(--color-muted-foreground)]"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {!draft.isMinimized && (
        <>
          {/* Recipients */}
          <RecipientInput
            label="To"
            values={draft.to}
            onChange={(to) => updateDraft(draft.id, { to })}
          />
          <RecipientInput
            label="Cc"
            values={draft.cc}
            onChange={(cc) => updateDraft(draft.id, { cc })}
          />

          {/* Subject */}
          <div className="px-4 py-2 border-b border-[var(--color-border)]">
            <input
              type="text"
              placeholder="Subject"
              value={draft.subject}
              onChange={(e) => updateDraft(draft.id, { subject: e.target.value })}
              className="w-full text-sm font-medium outline-none bg-transparent text-[var(--color-foreground)] placeholder:text-[var(--color-muted-foreground)]"
            />
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto px-4 py-3 min-h-[160px]">
            <EditorContent editor={editor} />
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between px-4 py-3 border-t border-[var(--color-border)] shrink-0 bg-[var(--color-muted)]">
            <div className="flex items-center gap-1">
              <button
                onClick={handleAttachment}
                className="p-1.5 rounded-[var(--radius-md)] hover:bg-[var(--color-border)] transition-colors text-[var(--color-muted-foreground)]"
                title="Attach file"
              >
                <Paperclip className="w-4 h-4" />
              </button>
              <button
                onClick={() => closeComposer(draft.id)}
                className="p-1.5 rounded-[var(--radius-md)] hover:bg-[var(--color-border)] transition-colors text-[var(--color-muted-foreground)]"
                title="Discard"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
            <button
              onClick={() => void handleSend()}
              disabled={draft.to.length === 0 || draft.isSending}
              className="flex items-center gap-2 px-4 py-1.5 bg-[var(--color-primary)] text-white text-sm font-medium rounded-[var(--radius-md)] hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Send className="w-3.5 h-3.5" />
              {draft.isSending ? 'Sending…' : 'Send'}
            </button>
          </div>
        </>
      )}
    </motion.div>
  )
}

export function ComposerManager() {
  const { drafts } = useComposeStore()
  const draftsArray = [...drafts.values()]

  if (draftsArray.length === 0) return null

  return (
    <div className="fixed bottom-0 right-6 z-30 flex items-end gap-3">
      <AnimatePresence>
        {draftsArray.map((draft) => (
          <ComposerWindow key={draft.id} draft={draft} />
        ))}
      </AnimatePresence>
    </div>
  )
}
