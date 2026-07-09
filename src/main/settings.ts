import Store from 'electron-store'
import { DEFAULT_SETTINGS, type AppSettings } from '@shared/types/db'

const store = new Store<AppSettings>({
  name: 'settings',
  defaults: DEFAULT_SETTINGS,
  encryptionKey: undefined,
})

// H9: Allowlist of top-level keys prevents arbitrary key injection and
//     prototype pollution via dot-notation (e.g. __proto__, constructor).
const VALID_SETTING_KEYS = new Set<string>([
  'theme', 'accentColor', 'density', 'sidebarWidth', 'splitRatio',
  'notifications', 'composer', 'sync', 'shortcuts', 'language',
  'gmailClientId', 'gmailClientSecret', 'graphClientId', 'graphClientSecret',
] satisfies (keyof AppSettings)[])

export function getSettings(): AppSettings {
  return store.store
}

export function getSetting<K extends keyof AppSettings>(key: K): AppSettings[K] {
  return store.get(key)
}

export function setSetting(key: string, value: unknown): void {
  if (!VALID_SETTING_KEYS.has(key)) {
    throw new Error(`Unknown settings key: ${key}`)
  }
  store.set(key as keyof AppSettings, value as AppSettings[keyof AppSettings])
}

export function resetSettings(): void {
  store.clear()
  Object.entries(DEFAULT_SETTINGS).forEach(([k, v]) => store.set(k as keyof AppSettings, v as AppSettings[keyof AppSettings]))
}
