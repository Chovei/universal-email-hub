import { useVirtualizer } from '@tanstack/react-virtual'
import { useRef } from 'react'
import { Mail, Loader2 } from 'lucide-react'
import { useSearchStore } from '../../stores/searchStore'
import { useMailboxStore } from '../../stores/mailboxStore'
import { useUIStore } from '../../stores/uiStore'
import { cn, formatDate } from '../../lib/utils'
import type { SearchResult } from '@shared/types/db'

// H6: Must match SNIPPET_OPEN / SNIPPET_CLOSE in src/main/db/queries/search.ts
const MARK_OPEN = String.fromCharCode(2)
const MARK_CLOSE = String.fromCharCode(3)
const RE_OPEN = new RegExp(MARK_OPEN, 'g')
const RE_CLOSE = new RegExp(MARK_CLOSE, 'g')

function safeSnippet(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(RE_OPEN, '<mark>')
    .replace(RE_CLOSE, '</mark>')
}

export function SearchResults() {
  const { results, isSearching, query } = useSearchStore()
  const { selectThread } = useMailboxStore()
  const { setActivePanel } = useUIStore()
  const parentRef = useRef<HTMLDivElement>(null)

  const virtualizer = useVirtualizer({
    count: results.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 80,
    overscan: 5,
  })

  const handleSelect = (result: SearchResult) => {
    selectThread(result.threadId)
    setActivePanel('inbox')
  }

  if (isSearching) {
    return (
      <div className="flex items-center justify-center h-40 gap-3 text-[var(--color-muted-foreground)]">
        <Loader2 className="w-5 h-5 animate-spin" />
        <span className="text-sm">Searching…</span>
      </div>
    )
  }

  if (!query.trim()) {
    return (
      <div className="flex flex-col items-center justify-center h-40 gap-2 text-center px-8">
        <Mail className="w-8 h-8 text-[var(--color-muted-foreground)]" />
        <p className="text-sm text-[var(--color-muted-foreground)]">
          Type to search across all your emails
        </p>
        <p className="text-xs text-[var(--color-muted-foreground)]">
          Try: <span className="font-mono">from:name</span>, <span className="font-mono">subject:topic</span>
        </p>
      </div>
    )
  }

  if (results.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-40 gap-2 text-center px-8">
        <p className="text-sm font-medium text-[var(--color-foreground)]">No results found</p>
        <p className="text-xs text-[var(--color-muted-foreground)]">
          Try different keywords or check your spelling
        </p>
      </div>
    )
  }

  return (
    <div ref={parentRef} className="overflow-y-auto flex-1">
      <p className="px-4 py-2 text-xs text-[var(--color-muted-foreground)]">
        {results.length} result{results.length !== 1 ? 's' : ''}
      </p>
      <div
        style={{ height: virtualizer.getTotalSize() }}
        className="relative"
      >
        {virtualizer.getVirtualItems().map((vItem) => {
          const result = results[vItem.index]!
          return (
            <div
              key={vItem.key}
              data-index={vItem.index}
              ref={virtualizer.measureElement}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${vItem.start}px)`,
              }}
            >
              <SearchResultItem result={result} onSelect={() => handleSelect(result)} />
            </div>
          )
        })}
      </div>
    </div>
  )
}

function SearchResultItem({
  result,
  onSelect,
}: {
  result: SearchResult
  onSelect: () => void
}) {
  return (
    <button
      onClick={onSelect}
      className="w-full text-left px-4 py-3 hover:bg-[var(--color-muted)] transition-colors border-b border-[var(--color-border)] last:border-0"
    >
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2 mb-0.5">
            <span className="text-sm font-semibold text-[var(--color-foreground)] truncate">
              {result.fromName ?? result.fromAddress}
            </span>
            <span className="text-[11px] text-[var(--color-muted-foreground)] shrink-0">
              {formatDate(result.date)}
            </span>
          </div>
          <p className="text-xs font-medium text-[var(--color-foreground)] truncate mb-0.5">
            {result.subject}
          </p>
          {result.snippet && (
            <p
              className="text-xs text-[var(--color-muted-foreground)] line-clamp-2 [&_mark]:bg-yellow-200 [&_mark]:text-yellow-900 dark:[&_mark]:bg-yellow-900 dark:[&_mark]:text-yellow-100 [&_mark]:rounded-sm"
              dangerouslySetInnerHTML={{ __html: safeSnippet(result.snippet) }}
            />
          )}
        </div>
      </div>
    </button>
  )
}
