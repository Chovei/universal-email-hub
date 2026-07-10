import { create } from 'zustand'
import { persist } from 'zustand/middleware'

type Theme = 'light' | 'dark' | 'system'
type Density = 'compact' | 'comfortable' | 'spacious'
type ActivePanel = 'inbox' | 'search' | 'settings' | 'plugins' | 'verification'

interface UIStore {
  theme: Theme
  density: Density
  sidebarWidth: number
  splitRatio: number
  commandPaletteOpen: boolean
  activePanel: ActivePanel
  composerOpen: boolean
  isSidebarCollapsed: boolean
  accentColor: string

  setTheme: (theme: Theme) => void
  setDensity: (density: Density) => void
  setSidebarWidth: (width: number) => void
  setSplitRatio: (ratio: number) => void
  toggleCommandPalette: () => void
  openCommandPalette: () => void
  closeCommandPalette: () => void
  setActivePanel: (panel: ActivePanel) => void
  openComposer: () => void
  closeComposer: () => void
  toggleSidebar: () => void
  setAccentColor: (color: string) => void
}

export const useUIStore = create<UIStore>()(
  persist(
    (set) => ({
      theme: 'system',
      density: 'comfortable',
      sidebarWidth: 220,
      splitRatio: 0.38,
      commandPaletteOpen: false,
      activePanel: 'inbox',
      composerOpen: false,
      isSidebarCollapsed: false,
      accentColor: '#6366f1',

      setTheme: (theme) => set({ theme }),
      setDensity: (density) => set({ density }),
      setSidebarWidth: (sidebarWidth) => set({ sidebarWidth }),
      setSplitRatio: (splitRatio) => set({ splitRatio }),
      toggleCommandPalette: () =>
        set((state) => ({ commandPaletteOpen: !state.commandPaletteOpen })),
      openCommandPalette: () => set({ commandPaletteOpen: true }),
      closeCommandPalette: () => set({ commandPaletteOpen: false }),
      setActivePanel: (activePanel) => set({ activePanel }),
      openComposer: () => set({ composerOpen: true }),
      closeComposer: () => set({ composerOpen: false }),
      toggleSidebar: () =>
        set((state) => ({ isSidebarCollapsed: !state.isSidebarCollapsed })),
      setAccentColor: (accentColor) => set({ accentColor }),
    }),
    {
      name: 'ui-preferences',
      partialize: (state) => ({
        theme: state.theme,
        density: state.density,
        sidebarWidth: state.sidebarWidth,
        splitRatio: state.splitRatio,
        isSidebarCollapsed: state.isSidebarCollapsed,
        accentColor: state.accentColor,
      }),
    }
  )
)
