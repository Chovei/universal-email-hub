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

export const credentialStore = {
  set(key: string, value: string): void {
    if (isAvailable()) {
      const encrypted = safeStorage.encryptString(value)
      store.set(key, encrypted.toString('base64'))
    } else {
      store.set(key, Buffer.from(value).toString('base64'))
    }
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
}
