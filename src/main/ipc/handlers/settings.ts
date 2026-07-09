import { ipcMain } from 'electron'
import { IPC } from '@shared/constants/ipc-channels'
import { getSettings, setSetting, resetSettings } from '../../settings'

export function registerSettingsHandlers(): void {
  ipcMain.handle(IPC.SETTINGS_GET, async () => {
    try {
      return { data: getSettings() }
    } catch (err) {
      return { error: { code: 'SETTINGS_ERROR', message: String(err) } }
    }
  })

  ipcMain.handle(IPC.SETTINGS_SET, async (_event, key: string, value: unknown) => {
    try {
      if (typeof key !== 'string' || key.length === 0 || key.length > 200) {
        return { error: { code: 'INVALID_KEY', message: 'Invalid settings key' } }
      }
      setSetting(key, value)
      return { data: null }
    } catch (err) {
      return { error: { code: 'SET_ERROR', message: String(err) } }
    }
  })

  ipcMain.handle(IPC.SETTINGS_RESET, async () => {
    try {
      resetSettings()
      return { data: null }
    } catch (err) {
      return { error: { code: 'RESET_ERROR', message: String(err) } }
    }
  })
}
