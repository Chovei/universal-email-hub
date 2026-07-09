import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'

type ViewMode = 'unified' | 'per-account'
type SortOrder = 'date-desc' | 'date-asc'
type FolderFilter = 'inbox' | 'sent' | 'drafts' | 'trash' | 'spam' | 'archive' | 'starred' | 'all'

interface MailboxStore {
  selectedThreadId: string | null
  selectedMessageId: string | null
  selectedFolderType: FolderFilter
  viewMode: ViewMode
  sortOrder: SortOrder
  cursor: string | null
  isThreadPanelOpen: boolean

  selectThread: (threadId: string | null) => void
  selectMessage: (messageId: string | null) => void
  setFolderType: (type: FolderFilter) => void
  setViewMode: (mode: ViewMode) => void
  setSortOrder: (order: SortOrder) => void
  setCursor: (cursor: string | null) => void
  openThreadPanel: () => void
  closeThreadPanel: () => void
}

export const useMailboxStore = create<MailboxStore>()(
  subscribeWithSelector((set) => ({
    selectedThreadId: null,
    selectedMessageId: null,
    selectedFolderType: 'inbox',
    viewMode: 'unified',
    sortOrder: 'date-desc',
    cursor: null,
    isThreadPanelOpen: false,

    selectThread: (threadId) =>
      set({ selectedThreadId: threadId, selectedMessageId: null, isThreadPanelOpen: !!threadId }),

    selectMessage: (messageId) => set({ selectedMessageId: messageId }),

    setFolderType: (type) =>
      set({ selectedFolderType: type, selectedThreadId: null, cursor: null }),

    setViewMode: (mode) => set({ viewMode: mode }),

    setSortOrder: (order) => set({ sortOrder: order, cursor: null }),

    setCursor: (cursor) => set({ cursor }),

    openThreadPanel: () => set({ isThreadPanelOpen: true }),

    closeThreadPanel: () => set({ isThreadPanelOpen: false, selectedThreadId: null }),
  }))
)
