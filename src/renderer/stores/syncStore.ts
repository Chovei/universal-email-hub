import { create } from 'zustand'
import type { SyncStatus } from '@shared/types/db'

interface SyncStore {
  syncStatus: Record<string, SyncStatus>
  unreadCounts: Record<string, number>
  totalUnread: number

  updateSyncStatus: (accountId: string, status: SyncStatus) => void
  updateUnreadCount: (folderId: string, count: number, delta: number) => void
  setTotalUnread: (count: number) => void
}

export const useSyncStore = create<SyncStore>()((set, get) => ({
  syncStatus: {},
  unreadCounts: {},
  totalUnread: 0,

  updateSyncStatus: (accountId, status) =>
    set((state) => ({
      syncStatus: { ...state.syncStatus, [accountId]: status },
    })),

  updateUnreadCount: (folderId, count, _delta) =>
    set((state) => {
      const counts = { ...state.unreadCounts, [folderId]: count }
      const total = Object.values(counts).reduce((sum, n) => sum + n, 0)
      return { unreadCounts: counts, totalUnread: total }
    }),

  setTotalUnread: (totalUnread) => set({ totalUnread }),
}))
