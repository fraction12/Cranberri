import { app, BrowserWindow, ipcMain, shell, protocol } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { initRepoIpc } from './repos'
import { initGitIpc } from './git'
import { initGitHubIpc } from './github'
import { initCodexIpc, stopCodexClient } from './codex/ipc'
import { initSettingsIpc } from './settings'
import { initTerminalIpc, killAllTerminals } from './terminal'
import { initProcessesIpc } from './processes'
import { initHealthIpc } from './health'
import { initAppStateIpc } from './appState'
import { initTelemetryIpc } from './telemetry'
import { initUpdaterIpc } from './updater'
import { buildInfo } from '@/shared/buildInfo'

const APP_SCHEME = 'cranberri'

protocol.registerSchemesAsPrivileged([
  { scheme: APP_SCHEME, privileges: { secure: true, standard: true, supportFetchAPI: true, allowServiceWorkers: true, corsEnabled: true } },
])

let mainWindow: BrowserWindow | null = null

export function getMainWindow(): BrowserWindow | null {
  return mainWindow
}

function resolveRendererFile(urlPath: string): string {
  // Map cranberri://host/path to app.asar/out/renderer/path
  let relativePath = urlPath.replace(/^\/+/, '')
  if (!relativePath || relativePath.endsWith('/')) relativePath += 'index.html'
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'app.asar', 'out', 'renderer', relativePath)
  }
  return path.join(__dirname, '../renderer', relativePath)
}

function registerAppProtocol(): void {
  protocol.handle(APP_SCHEME, async (request) => {
    const url = new URL(request.url)
    const filePath = resolveRendererFile(url.pathname)
    try {
      const data = await fs.promises.readFile(filePath)
      const ext = path.extname(filePath).toLowerCase()
      const mimeTypes: Record<string, string> = {
        '.html': 'text/html',
        '.js': 'application/javascript',
        '.mjs': 'application/javascript',
        '.css': 'text/css',
        '.json': 'application/json',
        '.svg': 'image/svg+xml',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif': 'image/gif',
        '.webp': 'image/webp',
        '.woff2': 'font/woff2',
        '.woff': 'font/woff',
        '.ttf': 'font/ttf',
        '.otf': 'font/otf',
      }
      return new Response(data, { headers: { 'Content-Type': mimeTypes[ext] ?? 'application/octet-stream' } })
    } catch (error) {
      console.error('[protocol] failed to serve', filePath, error)
      return new Response('Not found', { status: 404 })
    }
  })
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
    win.loadURL(`${APP_SCHEME}://renderer/index.html`)
  }

  win.on('closed', () => {
    mainWindow = null
  })
}

app.whenReady().then(() => {
  if (app.isPackaged) {
    registerAppProtocol()
  }
  initRepoIpc()
  initGitIpc()
  initGitHubIpc()
  initSettingsIpc()
  initCodexIpc(getMainWindow)
  initTerminalIpc()
  initProcessesIpc()
  initHealthIpc()
  initAppStateIpc()
  initTelemetryIpc()
  initUpdaterIpc()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  killAllTerminals()
  stopCodexClient()
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  stopCodexClient()
})

ipcMain.handle('app:get-version', () => app.getVersion())
ipcMain.handle('app:open-external', async (_, url: string) => shell.openExternal(url))
ipcMain.handle('app:build-info', () => buildInfo)
