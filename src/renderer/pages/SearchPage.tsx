import { SearchBar } from '../components/search/SearchBar'
import { SearchResults } from '../components/search/SearchResults'
import { useSearchStore } from '../stores/searchStore'
import { useUIStore } from '../stores/uiStore'
import { ArrowLeft } from 'lucide-react'

export function SearchPage() {
  const { exitSearchMode } = useSearchStore()
  const { setActivePanel } = useUIStore()

  const handleBack = () => {
    exitSearchMode()
    setActivePanel('inbox')
  }

  return (
    <div className="flex flex-col h-full bg-[var(--color-background)]">
      {/* Search header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--color-border)] bg-[var(--color-background)] shrink-0">
        <button
          onClick={handleBack}
          className="p-1.5 rounded-[var(--radius-md)] hover:bg-[var(--color-muted)] transition-colors text-[var(--color-muted-foreground)]"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <SearchBar autoFocus className="flex-1" />
      </div>

      {/* Results */}
      <SearchResults />
    </div>
  )
}
