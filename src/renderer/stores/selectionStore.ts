import { create } from 'zustand'

interface SelectionState {
  selectedIds: Set<string>
  anchorId: string | null
  toggleOne: (id: string) => void
  selectOne: (id: string) => void
  deselectOne: (id: string) => void
  selectRange: (fromId: string, toId: string, orderedIds: string[]) => void
  selectAll: (ids: string[]) => void
  deselectAll: () => void
  invertSelection: (allIds: string[]) => void
  setAnchor: (id: string | null) => void
}

export const useSelectionStore = create<SelectionState>()((set) => ({
  selectedIds: new Set<string>(),
  anchorId: null,

  toggleOne: (id) =>
    set((s) => {
      const next = new Set(s.selectedIds)
      next.has(id) ? next.delete(id) : next.add(id)
      return { selectedIds: next, anchorId: id }
    }),

  selectOne: (id) =>
    set((s) => ({ selectedIds: new Set(s.selectedIds).add(id), anchorId: id })),

  deselectOne: (id) =>
    set((s) => {
      const next = new Set(s.selectedIds)
      next.delete(id)
      return { selectedIds: next }
    }),

  selectRange: (fromId, toId, orderedIds) =>
    set((s) => {
      const fromIdx = orderedIds.indexOf(fromId)
      const toIdx = orderedIds.indexOf(toId)
      if (fromIdx === -1 || toIdx === -1) return {}
      const [start, end] = fromIdx <= toIdx ? [fromIdx, toIdx] : [toIdx, fromIdx]
      const next = new Set(s.selectedIds)
      for (let i = start; i <= end; i++) {
        const id = orderedIds[i]
        if (id !== undefined) next.add(id)
      }
      return { selectedIds: next, anchorId: toId }
    }),

  selectAll: (ids) =>
    set({ selectedIds: new Set(ids), anchorId: ids[ids.length - 1] ?? null }),

  deselectAll: () => set({ selectedIds: new Set<string>(), anchorId: null }),

  invertSelection: (allIds) =>
    set((s) => {
      const next = new Set<string>()
      for (const id of allIds) {
        if (!s.selectedIds.has(id)) next.add(id)
      }
      return { selectedIds: next, anchorId: null }
    }),

  setAnchor: (id) => set({ anchorId: id }),
}))

// Stable selector functions — pass these to useSelectionStore() to avoid
// re-renders when unrelated state changes.
export const selectIsSelectionMode = (s: SelectionState): boolean => s.selectedIds.size > 0
export const selectSelectedCount = (s: SelectionState): number => s.selectedIds.size
export const selectIsBulkSelected = (id: string) => (s: SelectionState): boolean =>
  s.selectedIds.has(id)
