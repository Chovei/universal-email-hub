import { create } from 'zustand'
import { monotonicFactory } from 'ulid'
import { useAccountStore } from './accountStore'
import type { MessageRow } from '@shared/types/db'

const ulid = monotonicFactory()

export interface DraftState {
  id: string
  fromAccountId: string
  to: { name?: string; address: string }[]
  cc: { name?: string; address: string }[]
  bcc: { name?: string; address: string }[]
  subject: string
  bodyHtml: string
  attachments: { localPath: string; filename: string; mimeType: string; size: number }[]
  inReplyToRemoteId?: string
  inReplyToThread?: string
  remoteId?: string
  isDirty: boolean
  isSending: boolean
  lastSavedAt?: number
  isMinimized: boolean
}

interface ComposeStore {
  drafts: Map<string, DraftState>
  activeDraftId: string | null

  openComposer: (opts?: {
    fromAccountId?: string
    replyTo?: MessageRow
    forward?: MessageRow
  }) => string
  closeComposer: (draftId: string) => void
  minimizeComposer: (draftId: string) => void
  restoreComposer: (draftId: string) => void
  updateDraft: (draftId: string, patch: Partial<DraftState>) => void
  setActiveDraft: (draftId: string | null) => void
  markSending: (draftId: string) => void
  markSent: (draftId: string) => void
}

export const useComposeStore = create<ComposeStore>()((set, get) => ({
  drafts: new Map(),
  activeDraftId: null,

  openComposer: (opts = {}) => {
    // M5: Fall back to the first connected account rather than an empty
    //     string so Send doesn't silently fail on new composers.
    const defaultAccount = useAccountStore.getState().accounts[0]?.id ?? ''
    const id = ulid()
    const draft: DraftState = {
      id,
      fromAccountId: opts.fromAccountId ?? defaultAccount,
      to: opts.replyTo
        ? [{ address: opts.replyTo.fromAddress, name: opts.replyTo.fromName ?? undefined }]
        : [],
      cc: [],
      bcc: [],
      subject: opts.replyTo
        ? (opts.replyTo.subject.startsWith('Re:')
          ? opts.replyTo.subject
          : `Re: ${opts.replyTo.subject}`)
        : opts.forward
        ? `Fwd: ${opts.forward.subject}`
        : '',
      bodyHtml: opts.replyTo || opts.forward
        ? `<br/><br/><blockquote>${opts.replyTo?.bodyHtml ?? opts.forward?.bodyHtml ?? ''}</blockquote>`
        : '',
      attachments: [],
      inReplyToRemoteId: opts.replyTo?.remoteId,
      inReplyToThread: opts.replyTo?.threadId,
      isDirty: false,
      isSending: false,
      isMinimized: false,
    }

    const drafts = new Map(get().drafts)
    drafts.set(id, draft)
    set({ drafts, activeDraftId: id })
    return id
  },

  closeComposer: (draftId) => {
    const drafts = new Map(get().drafts)
    drafts.delete(draftId)
    const activeDraftId =
      get().activeDraftId === draftId
        ? ([...drafts.keys()].pop() ?? null)
        : get().activeDraftId
    set({ drafts, activeDraftId })
  },

  minimizeComposer: (draftId) => {
    const drafts = new Map(get().drafts)
    const draft = drafts.get(draftId)
    if (draft) {
      drafts.set(draftId, { ...draft, isMinimized: true })
      set({ drafts })
    }
  },

  restoreComposer: (draftId) => {
    const drafts = new Map(get().drafts)
    const draft = drafts.get(draftId)
    if (draft) {
      drafts.set(draftId, { ...draft, isMinimized: false })
      set({ drafts, activeDraftId: draftId })
    }
  },

  updateDraft: (draftId, patch) => {
    const drafts = new Map(get().drafts)
    const draft = drafts.get(draftId)
    if (draft) {
      drafts.set(draftId, { ...draft, ...patch, isDirty: true })
      set({ drafts })
    }
  },

  setActiveDraft: (activeDraftId) => set({ activeDraftId }),

  markSending: (draftId) => {
    const drafts = new Map(get().drafts)
    const draft = drafts.get(draftId)
    if (draft) {
      drafts.set(draftId, { ...draft, isSending: true })
      set({ drafts })
    }
  },

  markSent: (draftId) => {
    const drafts = new Map(get().drafts)
    drafts.delete(draftId)
    set({ drafts, activeDraftId: null })
  },
}))
