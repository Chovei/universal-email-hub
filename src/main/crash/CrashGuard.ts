import Store from 'electron-store'

interface CrashStore {
  launchCount: number
  safeMode: boolean
}

const store = new Store<CrashStore>({ name: 'crash-guard' })

export const crashGuard = {
  begin(): void {
    const count = (store.get('launchCount', 0)) + 1
    store.set('launchCount', count)
  },

  commitCleanShutdown(): void {
    store.set('launchCount', 0)
    store.set('safeMode', false)
  },

  isCrashLoop(): boolean {
    return (store.get('launchCount', 0)) >= 3
  },

  isSafeMode(): boolean {
    return store.get('safeMode', false)
  },

  setSafeMode(enabled: boolean): void {
    store.set('safeMode', enabled)
    store.set('launchCount', 0)
  },
}
