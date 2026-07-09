import { BrowserWindow, app, nativeImage, nativeTheme, shell } from 'electron'
import path from 'path'

let mainWindow: BrowserWindow | null = null

export function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    frame: process.platform !== 'darwin',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 14, y: 14 },
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0f0f11' : '#ffffff',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      devTools: !app.isPackaged,
    },
  })

  // Show after paint to avoid flash
  win.once('ready-to-show', () => {
    win.show()
    if (!app.isPackaged) {
      win.webContents.openDevTools({ mode: 'detach' })
    }
  })

  // Block navigation away from app
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('http://localhost') && !url.startsWith('file://')) {
      event.preventDefault()
    }
  })

  // Block new window creation — open externally instead
  win.webContents.setWindowOpenHandler(({ url }) => {
    const allowed = ['http:', 'https:', 'mailto:']
    if (allowed.some((p) => url.startsWith(p))) {
      void shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  mainWindow = win
  return win
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow
}

export function setBadgeCount(count: number): void {
  if (process.platform === 'darwin') {
    app.dock?.setBadge(count > 0 ? String(count) : '')
  }
  mainWindow?.setTitle(
    count > 0 ? `Universal Email Hub (${count})` : 'Universal Email Hub'
  )
}

export function flashFrame(): void {
  mainWindow?.flashFrame(true)
  setTimeout(() => mainWindow?.flashFrame(false), 2000)
}
