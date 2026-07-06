import { app, BrowserWindow, ipcMain } from 'electron'
import path from 'node:path'
import { initRepoIpc } from './repos'
import { initGitIpc } from './git'
import { initCodexIpc } from './codex/ipc'
import { initSettingsIpc } from './settings'
import { initTerminalIpc, killAllTerminals } from './terminal'

let mainWindow: BrowserWindow | null = null

export function getMainWindow(): BrowserWindow | null {
  return mainWindow
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 12, y: 12 },
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  mainWindow = win

  if (!app.isPackaged) {
    const devUrl = process.env.ELECTRON_VITE_DEV_SERVER_URL ?? 'http://localhost:5173'
    win.loadURL(devUrl)
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  win.on('closed', () => {
    mainWindow = null
  })
}

app.whenReady().then(() => {
  initRepoIpc()
  initGitIpc()
  initSettingsIpc()
  initCodexIpc(getMainWindow)
  initTerminalIpc()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  killAllTerminals()
  if (process.platform !== 'darwin') app.quit()
})

ipcMain.handle('app:get-version', () => app.getVersion())
