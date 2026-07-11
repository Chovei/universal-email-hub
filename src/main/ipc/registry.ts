import { registerAccountHandlers } from './handlers/accounts'
import { registerMessageHandlers } from './handlers/messages'
import { registerFolderHandlers } from './handlers/folders'
import { registerComposeHandlers } from './handlers/compose'
import { registerSearchHandlers } from './handlers/search'
import { registerSyncHandlers } from './handlers/sync'
import { registerPluginHandlers } from './handlers/plugins'
import { registerSettingsHandlers } from './handlers/settings'
import { registerShellHandlers } from './handlers/shell'
import { registerUpdaterHandlers } from './handlers/updater'
import { registerVerificationHandlers } from './handlers/verificationCodes'
import { registerBulkHandlers } from './handlers/bulk'
import { registerFolderActionHandlers } from './handlers/folder-actions'

export function registerAllIpcHandlers(): void {
  registerAccountHandlers()
  registerMessageHandlers()
  registerFolderHandlers()
  registerComposeHandlers()
  registerSearchHandlers()
  registerSyncHandlers()
  registerPluginHandlers()
  registerSettingsHandlers()
  registerShellHandlers()
  registerUpdaterHandlers()
  registerVerificationHandlers()
  registerBulkHandlers()
  registerFolderActionHandlers()
}
