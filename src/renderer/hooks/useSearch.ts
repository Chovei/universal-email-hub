import { useCallback, useEffect, useRef } from 'react'
import { useSearchStore } from '../stores/searchStore'
import type { SearchQuery } from '@shared/types/db'

const DEBOUNCE_MS = 300

export function useSearch() {
  const { query, setQuery, setResults, setSuggestions, setSearching, filters } =
    useSearchStore()
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const performSearch = useCallback(
    async (q: string) => {
      if (!q.trim() || q.length < 2) {
        setResults([])
        setSearching(false)
        return
      }

      setSearching(true)
      try {
        const payload: SearchQuery = { query: q, filters, limit: 50 }
        const result = await window.emailAPI.search.query(payload)
        setResults((result as { data?: typeof result extends { data?: infer T } ? T : never[] }).data ?? [])
      } catch {
        setResults([])
      } finally {
        setSearching(false)
      }
    },
    [filters, setResults, setSearching]
  )

  const getSuggestions = useCallback(
    async (q: string) => {
      if (q.length < 2) {
        setSuggestions([])
        return
      }
      try {
        const result = await window.emailAPI.search.suggest(q)
        setSuggestions((result as { data?: string[] }).data ?? [])
      } catch {
        setSuggestions([])
      }
    },
    [setSuggestions]
  )

  const handleQueryChange = useCallback(
    (q: string) => {
      setQuery(q)
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
      timeoutRef.current = setTimeout(() => {
        void performSearch(q)
        void getSuggestions(q)
      }, DEBOUNCE_MS)
    },
    [setQuery, performSearch, getSuggestions]
  )

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
    }
  }, [])

  return {
    query,
    handleQueryChange,
    performSearch,
  }
}
