import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { App } from './App'
import { useSyncStore } from './stores/syncStore'
import './styles/globals.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
})

// H2: Wire the badge-count push (main → renderer) to the sync store so the
//     sidebar unread badge shows the real count.
window.emailAPI.window.onBadgeCount((count) => {
  useSyncStore.getState().setTotalUnread(count)
})

// H1: Removed duplicate onSyncStatusChanged subscription that was here via
//     setupPushBridge(). useAccounts hook already subscribes and cleans up.

const root = document.getElementById('root')
if (!root) throw new Error('Root element #root not found')

ReactDOM.createRoot(root).render(
  <QueryClientProvider client={queryClient}>
    <App />
  </QueryClientProvider>
)
