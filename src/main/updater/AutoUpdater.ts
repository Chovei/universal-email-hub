import { autoUpdater } from 'electron-updater'
import type { BrowserWindow} from 'electron';
import { app } from 'electron'
import { IPC } from '@shared/constants/ipc-channels'
import type { UpdateStatus } from '@shared/types/ipc'
import { logger } from '../logger/Logger'
import Store from 'electron-store'

interface UpdaterStore {
  skippedVersion: string | null
}

const store = new Store<UpdaterStore>({ name: 'updater' })

class AutoUpdaterService {
  private win: BrowserWindow | null = null
  private checkInterval: ReturnType<typeof setInterval> | null = null
  private initialized = false

  setWindow(win: BrowserWindow): void {
    this.win = win
  }

  init(): void {
    if (this.initialized) return
    this.initialized = true

    autoUpdater.logger = logger
    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true

    autoUpdater.on('checking-for-update', () => {
      logger.debug('[updater] Checking for update...')
      this.send({ type: 'checking' })
    })

    autoUpdater.on('update-available', (info) => {
      const skipped = store.get('skippedVersion', null)
      if (skipped === info.version) {
        logger.info('[updater] Skipping version', info.version)
        return
      }
      logger.info('[updater] Update available:', info.version)
      this.send({
        type: 'available',
        version: info.version,
        releaseNotes: this.extractNotes(info.releaseNotes),
      })
    })

    autoUpdater.on('update-not-available', () => {
      logger.debug('[updater] App is up to date.')
      this.send({ type: 'not-available' })
    })

    autoUpdater.on('download-progress', (progress) => {
      this.send({ type: 'downloading', progress: Math.round(progress.percent) })
    })

    autoUpdater.on('update-downloaded', (info) => {
      logger.info('[updater] Update downloaded:', info.version)
      this.send({
        type: 'downloaded',
        version: info.version,
        releaseNotes: this.extractNotes(info.releaseNotes),
      })
    })

    autoUpdater.on('error', (err) => {
      logger.error('[updater] Error:', err)
      this.send({ type: 'error', error: err.message })
    })

    // First check 10s after startup, then every 4 hours
    setTimeout(() => { void this.checkForUpdates() }, 10_000)
    this.checkInterval = setInterval(() => { void this.checkForUpdates() }, 4 * 60 * 60 * 1_000)
  }

  async checkForUpdates(): Promise<void> {
    if (!app.isPackaged) return
    try {
      await autoUpdater.checkForUpdates()
    } catch (err) {
      logger.error('[updater] checkForUpdates failed:', err)
    }
  }

  quitAndInstall(): void {
    autoUpdater.quitAndInstall(false, true)
  }

  skipVersion(version: string): void {
    store.set('skippedVersion', version)
    logger.info('[updater] Skipping version:', version)
  }

  destroy(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval)
      this.checkInterval = null
    }
  }

  private send(status: UpdateStatus): void {
    if (this.win && !this.win.isDestroyed()) {
      this.win.webContents.send(IPC.UPDATER_STATUS, status)
    }
  }

  // The GitHub provider returns the release body rendered as HTML; convert
  // to readable plain text. Never return empty — an update should always
  // have a human-visible description.
  private extractNotes(raw: unknown): string {
    const FALLBACK = 'Bug fixes and improvements.'
    let text: string | null = null
    if (typeof raw === 'string') {
      text = raw
    } else if (Array.isArray(raw)) {
      text = raw
        .map((r) => (typeof r === 'object' && r !== null && 'note' in r ? String((r as Record<string, unknown>).note) : ''))
        .filter(Boolean)
        .join('\n')
    }
    if (!text) return FALLBACK

    const plain = text
      .replace(/<li[^>]*>/gi, '\n• ')
      .replace(/<\/(h[1-6]|p|div|ul|ol)>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\n{3,}/g, '\n\n')
      .trim()

    return plain || FALLBACK
  }
}

export const updaterService = new AutoUpdaterService()
