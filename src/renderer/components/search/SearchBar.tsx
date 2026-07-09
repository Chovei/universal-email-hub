import { useRef, useEffect, useCallback } from 'react'
import { Search, X, Loader2 } from 'lucide-react'
import { useSearch } from '../../hooks/useSearch'
import { useSearchStore } from '../../stores/searchStore'
import { useUIStore } from '../../stores/uiStore'
import { cn } from '../../lib/utils'

interface SearchBarProps {
  autoFocus?: boolean
  className?: string
}

export function SearchBar({ autoFocus, className }: SearchBarProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const { query, handleQueryChange } = useSearch()
  const { isSearching, isSearchMode, enterSearchMode, exitSearchMode } = useSearchStore()
  const { setActivePanel } = useUIStore()

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus()
  }, [autoFocus])

  // Global keyboard shortcut: / to focus search
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === '/' && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
        e.preventDefault()
        inputRef.current?.focus()
        enterSearchMode()
        setActivePanel('search')
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [enterSearchMode, setActivePanel])

  const handleFocus = useCallback(() => {
    enterSearchMode()
    setActivePanel('search')
  }, [enterSearchMode, setActivePanel])

  const handleClear = useCallback(() => {
    handleQueryChange('')
    exitSearchMode()
    inputRef.current?.blur()
  }, [handleQueryChange, exitSearchMode])

  return (
    <div
      className={cn(
        'flex items-center gap-2 px-3 py-2 rounded-[var(--radius-lg)] border transition-all',
        isSearchMode
          ? 'border-[var(--color-primary)] bg-[var(--color-card)] shadow-sm'
          : 'border-[var(--color-border)] bg-[var(--color-muted)] hover:border-[var(--color-muted-foreground)]',
        className
      )}
    >
      {isSearching ? (
        <Loader2 className="w-3.5 h-3.5 text-[var(--color-primary)] shrink-0 animate-spin" />
      ) : (
        <Search className="w-3.5 h-3.5 text-[var(--color-muted-foreground)] shrink-0" />
      )}

      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => handleQueryChange(e.target.value)}
        onFocus={handleFocus}
        placeholder="Search emails… (/)"
        className="flex-1 min-w-0 text-sm bg-transparent outline-none text-[var(--color-foreground)] placeholder:text-[var(--color-muted-foreground)]"
      />

      {query && (
        <button
          onClick={handleClear}
          className="shrink-0 p-0.5 rounded text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] transition-colors"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  )
}
