import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import type { AccountRow, SyncStatus } from '@shared/types/db'

interface AccountStore {
  accounts: AccountRow[]
  activeAccountId: string | 'unified'
  syncStatus: Record<string, SyncStatus>

  setAccounts: (accounts: AccountRow[]) => void
  addAccount: (account: AccountRow) => void
  removeAccount: (id: string) => void
  updateAccount: (id: string, patch: Partial<AccountRow>) => void
  setActiveAccount: (id: string | 'unified') => void
  updateSyncStatus: (accountId: string, status: SyncStatus) => void
}

export const useAccountStore = create<AccountStore>()(
  subscribeWithSelector((set) => ({
    accounts: [],
    activeAccountId: 'unified',
    syncStatus: {},

    setAccounts: (accounts) => set({ accounts }),

    addAccount: (account) =>
      set((state) => ({ accounts: [...state.accounts, account] })),

    removeAccount: (id) =>
      set((state) => ({
        accounts: state.accounts.filter((a) => a.id !== id),
        activeAccountId:
          state.activeAccountId === id ? 'unified' : state.activeAccountId,
      })),

    updateAccount: (id, patch) =>
      set((state) => ({
        accounts: state.accounts.map((a) => (a.id === id ? { ...a, ...patch } : a)),
      })),

    setActiveAccount: (id) => set({ activeAccountId: id }),

    updateSyncStatus: (accountId, status) =>
      set((state) => ({
        syncStatus: { ...state.syncStatus, [accountId]: status },
      })),
  }))
)
