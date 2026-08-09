import { safeStorage } from 'electron'
import Store from 'electron-store'

interface CredentialStore {
  [key: string]: string
}

const store = new Store<CredentialStore>({
  name: 'credentials',
  encryptionKey: undefined,
})

// M6: Memoise the availability check — safeStorage.isEncryptionAvailable()
//     returns the same value for the entire process lifetime.
let _encryptionAvailable: boolean | null = null
function isAvailable(): boolean {
  if (_encryptionAvailable === null) {
    try {
      _encryptionAvailable = safeStorage.isEncryptionAvailable()
    } catch {
      _encryptionAvailable = false
    }
  }
  return _encryptionAvailable
}

export interface CredentialProtection {
  /** true when the OS encrypts credentials at rest via safeStorage */
  encrypted: boolean
  /** Human-readable mechanism name for the Settings → Security display */
  method: string
}

export function getCredentialProtection(): CredentialProtection {
  if (!isAvailable()) {
    return { encrypted: false, method: 'None — OS encryption unavailable' }
  }
  switch (process.platform) {
    case 'win32':
      return { encrypted: true, method: 'Windows DPAPI' }
    case 'darwin':
      return { encrypted: true, method: 'macOS Keychain' }
    default: {
      // Linux: kwallet/gnome-libsecret/basic-text depending on desktop
      try {
        const backend = safeStorage.getSelectedStorageBackend()
        if (backend === 'basic_text') {
          return { encrypted: false, method: 'None — no secret service available' }
        }
        return { encrypted: true, method: `Secret Service (${backend})` }
      } catch {
        return { encrypted: true, method: 'Secret Service' }
      }
    }
  }
}

export const credentialStore = {
  set(key: string, value: string): void {
    if (isAvailable()) {
      const encrypted = safeStorage.encryptString(value)
      store.set(key, encrypted.toString('base64'))
    } else {
      store.set(key, Buffer.from(value).toString('base64'))
    }
  },

  /**
   * Store several credentials in one write.
   *
   * electron-store persists the whole file on every set, so importing fifty
   * authenticators one at a time means fifty rewrites of a file that grows as
   * it goes. It also narrows the window in which a crash could leave some of
   * a batch written and the rest not.
   */
  setMany(entries: Record<string, string>): void {
    const encoded: Record<string, string> = {}
    for (const [key, value] of Object.entries(entries)) {
      encoded[key] = isAvailable()
        ? safeStorage.encryptString(value).toString('base64')
        : Buffer.from(value).toString('base64')
    }
    store.set(encoded)
  },

  get(key: string): string | null {
    const stored = store.get(key) as string | undefined
    if (!stored) return null

    try {
      const buf = Buffer.from(stored, 'base64')
      if (isAvailable()) {
        return safeStorage.decryptString(buf)
      }
      return buf.toString('utf-8')
    } catch {
      return null
    }
  },

  delete(key: string): void {
    store.delete(key)
  },

  has(key: string): boolean {
    return store.has(key)
  },

  /** Stored key names (not values) — used to find credentials left behind. */
  keys(): string[] {
    return Object.keys(store.store)
  },

  /** Removes every stored credential whose key begins with `prefix`. */
  deleteByPrefix(prefix: string): number {
    let removed = 0
    for (const key of Object.keys(store.store)) {
      if (key.startsWith(prefix)) {
        store.delete(key)
        removed++
      }
    }
    return removed
  },
}
