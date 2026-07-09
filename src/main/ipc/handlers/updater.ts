import { ipcMain, app } from 'electron'
import { IPC } from '@shared/constants/ipc-channels'
import { updaterService } from '../../updater/AutoUpdater'
import { crashGuard } from '../../crash/CrashGuard'

export function registerUpdaterHandlers(): void {
  ipcMain.handle(IPC.UPDATER_CHECK, async () => {
    try {
      await updaterService.checkForUpdates()
      return { data: null }
    } catch (err) {
      return { error: { code: 'CHECK_ERROR', message: String(err) } }
    }
  })

  ipcMain.handle(IPC.UPDATER_INSTALL, () => {
    updaterService.quitAndInstall()
    return { data: null }
  })

  ipcMain.handle(IPC.UPDATER_SKIP_VERSION, (_event, version: string) => {
    if (typeof version !== 'string') {
      return { error: { code: 'INVALID_VERSION', message: 'Version must be a string' } }
    }
    updaterService.skipVersion(version)
    return { data: null }
  })

  ipcMain.handle(IPC.UPDATER_GET_APP_INFO, () => {
    return {
      data: {
        version: app.getVersion(),
        isSafeMode: crashGuard.isSafeMode(),
      },
    }
  })
}
