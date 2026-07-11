import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'

type ViewMode = 'unified' | 'per-account'
type SortOrder = 'date-desc' | 'date-asc'
export type FolderFilter = 'inbox' | 'sent' | 'drafts' | 'trash' | 'spam' | 'archive' | 'starred' | 'all'

interface MailboxStore {
  selectedThreadId: string | null
  selectedMessageId: string | null
  selectedFolderType: FolderFilter
  /** Set when the user navigates to a specific per-account folder row */
  selectedFolderId: string | null
  /** Account the selected folder belongs to */
  selectedFolderAccountId: string | null
  viewMode: ViewMode
  sortOrder: SortOrder
  cursor: string | null
  isThreadPanelOpen: boolean

  selectThread: (threadId: string | null) => void
  selectMessage: (messageId: string | null) => void
  setFolderType: (type: FolderFilter) => void
  /** Navigate to a specific folder row (per-account). Clears selectedThreadId. */
  setFolder: (folderId: string, accountId: string, folderType?: FolderFilter) => void
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
    selectedFolderId: null,
    selectedFolderAccountId: null,
    viewMode: 'unified',
    sortOrder: 'date-desc',
    cursor: null,
    isThreadPanelOpen: false,

    selectThread: (threadId) =>
      set({ selectedThreadId: threadId, selectedMessageId: null, isThreadPanelOpen: !!threadId }),

    selectMessage: (messageId) => set({ selectedMessageId: messageId }),

    setFolderType: (type) =>
      set({
        selectedFolderType: type,
        selectedFolderId: null,
        selectedFolderAccountId: null,
        selectedThreadId: null,
        cursor: null,
      }),

    setFolder: (folderId, accountId, folderType = 'all') =>
      set({
        selectedFolderId: folderId,
        selectedFolderAccountId: accountId,
        selectedFolderType: folderType,
        selectedThreadId: null,
        cursor: null,
      }),

    setViewMode: (mode) => set({ viewMode: mode }),

    setSortOrder: (order) => set({ sortOrder: order, cursor: null }),

    setCursor: (cursor) => set({ cursor }),

    openThreadPanel: () => set({ isThreadPanelOpen: true }),

    closeThreadPanel: () => set({ isThreadPanelOpen: false, selectedThreadId: null }),
  }))
)
