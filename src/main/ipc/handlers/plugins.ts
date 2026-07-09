import { ipcMain } from 'electron'
import { IPC } from '@shared/constants/ipc-channels'
import { PluginRegistry } from '../../plugins/PluginRegistry'

export function registerPluginHandlers(): void {
  ipcMain.handle(IPC.PLUGINS_LIST, async () => {
    try {
      const plugins = PluginRegistry.getInstance().listPlugins()
      return { data: plugins }
    } catch (err) {
      return { error: { code: 'PLUGINS_ERROR', message: String(err) } }
    }
  })

  ipcMain.handle(IPC.PLUGINS_INSTALL, async (_event, manifestPath: string) => {
    try {
      const plugin = await PluginRegistry.getInstance().install(manifestPath)
      return { data: plugin }
    } catch (err) {
      return { error: { code: 'INSTALL_ERROR', message: String(err) } }
    }
  })

  ipcMain.handle(IPC.PLUGINS_UNINSTALL, async (_event, pluginId: string) => {
    try {
      await PluginRegistry.getInstance().uninstall(pluginId)
      return { data: null }
    } catch (err) {
      return { error: { code: 'UNINSTALL_ERROR', message: String(err) } }
    }
  })

  ipcMain.handle(IPC.PLUGINS_SEND, async (_event, pluginId: string, message: unknown) => {
    try {
      return { data: null }
    } catch (err) {
      return { error: { code: 'PLUGIN_SEND_ERROR', message: String(err) } }
    }
  })
}
