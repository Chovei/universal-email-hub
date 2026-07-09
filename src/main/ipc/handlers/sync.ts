import { ipcMain, BrowserWindow } from 'electron'
import { IPC } from '@shared/constants/ipc-channels'
import { SyncEngine } from '../../sync/SyncEngine'

export function registerSyncHandlers(): void {
  ipcMain.handle(IPC.SYNC_FORCE, async (_event, accountId?: string) => {
    try {
      await SyncEngine.getInstance().forceSync(accountId)
      return { data: null }
    } catch (err) {
      return { error: { code: 'SYNC_ERROR', message: String(err) } }
    }
  })

  ipcMain.handle(IPC.SYNC_GET_STATUS, async () => {
    try {
      const status = SyncEngine.getInstance().getAllStatus()
      return { data: status }
    } catch (err) {
      return { error: { code: 'STATUS_ERROR', message: String(err) } }
    }
  })

  ipcMain.handle(IPC.SYNC_PAUSE, async (_event, accountId: string) => {
    try {
      SyncEngine.getInstance().pauseAccount(accountId)
      return { data: null }
    } catch (err) {
      return { error: { code: 'PAUSE_ERROR', message: String(err) } }
    }
  })

  ipcMain.handle(IPC.SYNC_RESUME, async (_event, accountId: string) => {
    try {
      SyncEngine.getInstance().resumeAccount(accountId)
      return { data: null }
    } catch (err) {
      return { error: { code: 'RESUME_ERROR', message: String(err) } }
    }
  })
}

export function broadcastSyncProgress(
  win: BrowserWindow,
  payload: { accountId: string; message: string; progress: number }
): void {
  win.webContents.send(IPC.SYNC_PROGRESS, payload)
}
