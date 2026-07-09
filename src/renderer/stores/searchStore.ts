import { create } from 'zustand'
import type { SearchResult, SearchFilters } from '@shared/types/db'

interface SearchStore {
  query: string
  results: SearchResult[]
  suggestions: string[]
  isSearching: boolean
  filters: SearchFilters
  isSearchMode: boolean

  setQuery: (q: string) => void
  setResults: (results: SearchResult[]) => void
  setSuggestions: (suggestions: string[]) => void
  setSearching: (searching: boolean) => void
  setFilters: (filters: Partial<SearchFilters>) => void
  clearFilters: () => void
  enterSearchMode: () => void
  exitSearchMode: () => void
  clearSearch: () => void
}

export const useSearchStore = create<SearchStore>()((set) => ({
  query: '',
  results: [],
  suggestions: [],
  isSearching: false,
  filters: {},
  isSearchMode: false,

  setQuery: (query) => set({ query }),
  setResults: (results) => set({ results }),
  setSuggestions: (suggestions) => set({ suggestions }),
  setSearching: (isSearching) => set({ isSearching }),
  setFilters: (filters) => set((state) => ({ filters: { ...state.filters, ...filters } })),
  clearFilters: () => set({ filters: {} }),
  enterSearchMode: () => set({ isSearchMode: true }),
  exitSearchMode: () => set({ isSearchMode: false, query: '', results: [] }),
  clearSearch: () => set({ query: '', results: [], isSearching: false }),
}))
