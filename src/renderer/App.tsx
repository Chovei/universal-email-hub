import { useEffect } from 'react'
import { AppShell } from './components/layout/AppShell'
import { UpdateDialog } from './components/updater/UpdateDialog'
import { useUIStore } from './stores/uiStore'

function applyTheme(theme: 'light' | 'dark' | 'system') {
  const root = document.documentElement
  if (theme === 'dark') {
    root.classList.add('dark')
  } else if (theme === 'light') {
    root.classList.remove('dark')
  } else {
    // system
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
    root.classList.toggle('dark', prefersDark)
  }
}

export function App() {
  const theme = useUIStore((s) => s.theme)

  // Apply theme on mount and when it changes
  useEffect(() => {
    applyTheme(theme)

    if (theme === 'system') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)')
      const handler = (e: MediaQueryListEvent) => {
        document.documentElement.classList.toggle('dark', e.matches)
      }
      mq.addEventListener('change', handler)
      return () => mq.removeEventListener('change', handler)
    }
  }, [theme])

  return (
    <>
      <AppShell />
      <UpdateDialog />
    </>
  )
}
