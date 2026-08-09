import { app, BrowserWindow, session, dialog } from 'electron'
import path from 'path'
import { initLogger, logger } from './logger/Logger'
import { crashGuard } from './crash/CrashGuard'
import { initDatabase, closeDatabase } from './db/client'
import { registerAllIpcHandlers } from './ipc/registry'
import { createMainWindow, getMainWindow } from './window'
import { SyncEngine } from './sync/SyncEngine'
import { updaterService } from './updater/AutoUpdater'
import { getAllAccounts } from './db/queries/accounts'
import { reindexAllMessages } from './db/queries/search'

// Initialise logging before everything else so all console.* calls are captured
initLogger()

// Windows identifies an app by its AppUserModelID: it ties the running
// process to the Start Menu shortcut the NSIS installer created, which is
// what taskbar grouping, pinning and jump lists key off. Must match the
// electron-builder `appId`, and must be set before any window or
// notification exists. (This is app identity — it is NOT what enables
// toasts; the OS-level notification toggle governs that.)
if (process.platform === 'win32') {
  app.setAppUserModelId('com.universalemailhub.app')
}

// C1/H11: Catch unhandled errors before anything else
process.on('uncaughtException', (err) => {
  logger.error('[main] Uncaught exception:', err)
})
process.on('unhandledRejection', (reason) => {
  logger.error('[main] Unhandled rejection:', reason)
})

// Crash-loop detection: record this launch
crashGuard.begin()

if (!app.requestSingleInstanceLock()) {
  app.quit()
  process.exit(0)
}

app.on('second-instance', () => {
  const win = getMainWindow()
  if (win) {
    if (win.isMinimized()) win.restore()
    win.focus()
  }
})

// C2: Track whether one-time init has run so macOS re-activate doesn't
//     re-register IPC handlers or re-open the database.
let appInitialized = false

async function initApp(): Promise<void> {
  const isDev = !app.isPackaged
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const csp = isDev
      ? "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' ws://localhost:5173 http://localhost:5173; frame-src 'none';"
      : "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'none'; frame-src 'none';"
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [csp],
      },
    })
  })

  session.defaultSession.webRequest.onBeforeRequest(
    { urls: ['*://*/*'] },
    (details, callback) => {
      if (
        details.url.startsWith('http://localhost') ||
        details.url.startsWith('devtools://') ||
        details.url.startsWith('file://')
      ) {
        callback({ cancel: false })
        return
      }
      callback({ cancel: true })
    }
  )

  initDatabase()
  registerAllIpcHandlers()
}

// C2: Window creation is separate from one-time init so macOS activate
//     can call this without re-initialising the DB or IPC layer.
async function createWindow(): Promise<void> {
  const win = createMainWindow()

  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    await win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    await win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  // C1: Set the window reference BEFORE starting account sync so every
  //     push event during the initial sync has somewhere to go.
  const engine = SyncEngine.getInstance()
  engine.setWindow(win)

  updaterService.setWindow(win)
  if (app.isPackaged) {
    updaterService.init()
  }

  if (!crashGuard.isSafeMode()) {
    const accounts = getAllAccounts()
    for (const account of accounts) {
      if (account.isActive) {
        void engine.addAccount(account.id, account.provider, undefined)
      }
    }
  } else {
    logger.warn('[bootstrap] Safe mode active — skipping account sync startup')
  }

  setImmediate(() => {
    try {
      reindexAllMessages()
    } catch (err) {
      logger.warn('[bootstrap] FTS re-index failed:', err)
    }
  })
}

async function bootstrap(): Promise<void> {
  await app.whenReady()

  if (!appInitialized) {
    appInitialized = true

    // Offer safe mode if we detected a crash loop
    if (crashGuard.isCrashLoop() && !crashGuard.isSafeMode()) {
      const { response } = await dialog.showMessageBox({
        type: 'warning',
        title: 'Universal Email Hub',
        message: 'The app crashed on previous launches.',
        detail: 'Start in safe mode to disable background sync and diagnose the issue?',
        buttons: ['Start in Safe Mode', 'Start Normally'],
        defaultId: 0,
        cancelId: 1,
      })
      if (response === 0) {
        crashGuard.setSafeMode(true)
      } else {
        crashGuard.setSafeMode(false)
      }
    }

    await initApp()
  }

  await createWindow()
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// C2: Only create a new window on activate — do NOT call bootstrap() which
//     would re-run initApp() and double-register all IPC handlers.
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    void createWindow()
  }
})

// Each shutdown step is isolated: closing the database performs the WAL
// checkpoint that folds recent writes back into emails.db, so it must run
// even if an earlier step throws. It previously did not — a throw inside
// SyncEngine.shutdown() skipped closeDatabase() entirely, leaving every
// write stranded in an ever-growing WAL.
app.on('before-quit', () => {
  const steps: Array<[string, () => void]> = [
    ['crashGuard', () => crashGuard.commitCleanShutdown()],
    ['updater', () => updaterService.destroy()],
    ['syncEngine', () => SyncEngine.getInstance().shutdown()],
    ['database', () => closeDatabase()],
  ]
  for (const [name, run] of steps) {
    try {
      run()
    } catch (err) {
      logger.error(`[main] shutdown step "${name}" failed:`, err)
    }
  }
})

bootstrap().catch((err: unknown) => {
  // Without this, a failed bootstrap leaves the app running with no window
  // and no explanation — indistinguishable from "nothing happened".
  logger.error('[main] bootstrap failed:', err)
  dialog.showErrorBox(
    'Universal Email Hub could not start',
    `Something went wrong during startup:\n\n${err instanceof Error ? err.message : String(err)}\n\nPlease restart the app. If this keeps happening, reinstall or report the issue.`
  )
  app.quit()
})
