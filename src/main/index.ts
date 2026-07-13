import { app, BrowserWindow, ipcMain, nativeTheme, protocol } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { randomUUID } from 'node:crypto'
import { initAppIpc } from './appIpc'
import { initRepoIpc } from './repos'
import { initGitIpc } from './git'
import { initGitHubIpc } from './github'
import { initCodexIpc, stopCodexClient } from './codex/ipc'
import { recoverStartupRuntime } from './worktree-runtime'
import { initSettingsIpc } from './settings'
import { initTerminalIpc, killAllTerminals } from './terminal'
import { initProcessesIpc } from './processes'
import { initHealthIpc } from './health'
import { initAppStateIpc } from './appState'
import { initComposerDraftsIpc } from './composer-drafts'
import { initTelemetryIpc } from './telemetry'
import { initUpdaterIpc } from './updater'
import { initSearchIpc } from './search'
import { initBrowserIpc } from './browser'
import { initEnvironmentIpc } from './environments/ipc'
import { initStartupRecoveryIpc } from './startup-recovery'
import {
  persistenceFlushAcknowledgementSchema,
  persistenceFlushFailureSchema,
  persistenceFlushReasonSchema,
  persistenceFlushRequestSchema,
  type PersistenceFlushRequest,
} from '../shared/appState'
import { buildInfo } from '../shared/buildInfo'
import { resolveUserDataPath } from './user-data-path'

const APP_SCHEME = 'cranberri'
const MEDIA_SCHEME = 'cranberri-media'

protocol.registerSchemesAsPrivileged([
  { scheme: APP_SCHEME, privileges: { secure: true, standard: true, supportFetchAPI: true, allowServiceWorkers: true, corsEnabled: true } },
  { scheme: MEDIA_SCHEME, privileges: { secure: true, standard: true, supportFetchAPI: true, corsEnabled: true } },
])

let mainWindow: BrowserWindow | null = null
let allowWindowClose = false
let windowCloseInFlight = false
let allowAppQuit = false
let appQuitInFlight = false

interface PendingPersistenceFlush {
  resolve: () => void
  reject: (error: Error) => void
  timeout: ReturnType<typeof setTimeout>
}

export class RendererPersistenceFlushCoordinator {
  private readonly pending = new Map<string, PendingPersistenceFlush>()

  constructor(private readonly timeoutMs = 5_000) {}

  request(
    webContents: Pick<Electron.WebContents, 'isDestroyed' | 'send'>,
    reason: PersistenceFlushRequest['reason'],
  ): Promise<void> {
    if (webContents.isDestroyed()) return Promise.reject(new Error('Renderer is unavailable for persistence flush'))
    const request = persistenceFlushRequestSchema.parse({ requestId: randomUUID(), reason })
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(request.requestId)
        reject(new Error(`Renderer persistence flush timed out during ${reason}`))
      }, this.timeoutMs)
      this.pending.set(request.requestId, { resolve, reject, timeout })
      try {
        webContents.send('app:persistence-flush-request', request)
      } catch (error) {
        clearTimeout(timeout)
        this.pending.delete(request.requestId)
        reject(error instanceof Error ? error : new Error('Failed to request renderer persistence flush'))
      }
    })
  }

  acknowledge(raw: unknown): { ok: boolean } {
    const acknowledgement = persistenceFlushAcknowledgementSchema.parse(raw)
    const pending = this.pending.get(acknowledgement.requestId)
    if (!pending) return { ok: false }
    clearTimeout(pending.timeout)
    this.pending.delete(acknowledgement.requestId)
    if (acknowledgement.errorMessage) pending.reject(new Error(acknowledgement.errorMessage))
    else pending.resolve()
    return { ok: true }
  }
}

const persistenceFlushCoordinator = new RendererPersistenceFlushCoordinator()

function reportPersistenceFlushFailure(
  win: BrowserWindow,
  reason: PersistenceFlushRequest['reason'],
  error: unknown,
): void {
  const failure = persistenceFlushFailureSchema.parse({
    reason,
    message: error instanceof Error ? error.message : 'Workspace persistence failed',
  })
  if (!win.webContents.isDestroyed()) win.webContents.send('app:persistence-flush-failed', failure)
}

const userDataPath = resolveUserDataPath({
  appDataPath: app.getPath('appData'),
  channel: buildInfo.channel,
  commit: buildInfo.commit,
  explicitPath: process.env.CRANBERRI_USER_DATA_DIR,
  taskStoreVersion: buildInfo.schemas.taskStore,
  tempPath: os.tmpdir(),
})
if (userDataPath) app.setPath('userData', userDataPath)

const ownsApplicationInstance = app.requestSingleInstanceLock?.() ?? true
if (!ownsApplicationInstance) app.quit()
app.on('second-instance', () => {
  const existing = BrowserWindow.getAllWindows()[0]
  if (!existing) return
  if (existing.isMinimized()) existing.restore()
  existing.focus()
})

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

function mediaMimeType(filePath: string): string | null {
  const mimeTypes: Record<string, string> = {
    '.apng': 'image/apng',
    '.avif': 'image/avif',
    '.gif': 'image/gif',
    '.jpeg': 'image/jpeg',
    '.jpg': 'image/jpeg',
    '.m4v': 'video/x-m4v',
    '.mov': 'video/quicktime',
    '.mp4': 'video/mp4',
    '.ogg': 'video/ogg',
    '.ogv': 'video/ogg',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.webm': 'video/webm',
    '.webp': 'image/webp',
  }
  return mimeTypes[path.extname(filePath).toLowerCase()] ?? null
}

function registerMediaProtocol(): void {
  protocol.handle(MEDIA_SCHEME, async (request) => {
    const url = new URL(request.url)
    const filePath = url.searchParams.get('path')
    if (!filePath || !path.isAbsolute(filePath)) return new Response('Not found', { status: 404 })

    const contentType = mediaMimeType(filePath)
    if (!contentType) return new Response('Unsupported media type', { status: 415 })

    try {
      const stat = await fs.promises.stat(filePath)
      if (!stat.isFile()) return new Response('Not found', { status: 404 })
      const data = await fs.promises.readFile(filePath)
      return new Response(data, { headers: { 'Content-Type': contentType } })
    } catch (error) {
      console.error('[media-protocol] failed to serve', filePath, error)
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
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#111113' : '#fcfcfd',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 12, y: 12 },
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  mainWindow = win

  const syncWindowBackground = () => {
    win.setBackgroundColor(nativeTheme.shouldUseDarkColors ? '#111113' : '#fcfcfd')
  }
  nativeTheme.on('updated', syncWindowBackground)

  win.on('close', (event) => {
    if (allowWindowClose) return
    event.preventDefault()
    if (windowCloseInFlight) return
    windowCloseInFlight = true
    void persistenceFlushCoordinator.request(win.webContents, 'window-close')
      .then(() => {
        allowWindowClose = true
        win.close()
      })
      .catch((error) => {
        console.error('[persistence] window close blocked:', error)
        reportPersistenceFlushFailure(win, 'window-close', error)
      })
      .finally(() => { windowCloseInFlight = false })
  })

  if (!app.isPackaged) {
    const devUrl = process.env.ELECTRON_VITE_DEV_SERVER_URL ?? 'http://localhost:5173'
    win.loadURL(devUrl)
  } else {
    win.loadURL(`${APP_SCHEME}://renderer/index.html`)
  }

  win.on('closed', () => {
    nativeTheme.removeListener('updated', syncWindowBackground)
    mainWindow = null
    allowWindowClose = false
  })
}

if (ownsApplicationInstance) app.whenReady().then(async () => {
  if (app.isPackaged) {
    registerAppProtocol()
  }
  registerMediaProtocol()
  const recoveryReport = await recoverStartupRuntime()
  console.info('[startup-recovery]', JSON.stringify(recoveryReport))
  initRepoIpc()
  initAppIpc()
  initGitIpc()
  initGitHubIpc()
  initSettingsIpc()
  initCodexIpc(getMainWindow)
  initTerminalIpc()
  initEnvironmentIpc(getMainWindow)
  initProcessesIpc()
  initSearchIpc()
  initBrowserIpc(getMainWindow)
  initHealthIpc()
  initAppStateIpc()
  initComposerDraftsIpc()
  initStartupRecoveryIpc()
  ipcMain.handle('app:persistence-flush-ack', (event, raw: unknown) => {
    if (event.sender !== mainWindow?.webContents) throw new Error('Unauthorized persistence flush acknowledgement')
    return persistenceFlushCoordinator.acknowledge(raw)
  })
  ipcMain.handle('app:persistence-force-close', (event, raw: unknown) => {
    if (event.sender !== mainWindow?.webContents) throw new Error('Unauthorized persistence close request')
    const reason = persistenceFlushReasonSchema.parse(raw)
    if (reason === 'app-quit') {
      allowAppQuit = true
      allowWindowClose = true
      stopCodexClient()
      app.quit()
    } else if (mainWindow) {
      allowWindowClose = true
      mainWindow.close()
    }
    return { ok: true }
  })
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

app.on('before-quit', (event) => {
  if (allowAppQuit) {
    stopCodexClient()
    return
  }
  const win = mainWindow
  if (!win || win.webContents.isDestroyed()) {
    stopCodexClient()
    return
  }
  event.preventDefault()
  if (appQuitInFlight) return
  appQuitInFlight = true
  void persistenceFlushCoordinator.request(win.webContents, 'app-quit')
    .then(() => {
      allowAppQuit = true
      allowWindowClose = true
      stopCodexClient()
      app.quit()
    })
    .catch((error) => {
      console.error('[persistence] app quit blocked:', error)
      reportPersistenceFlushFailure(win, 'app-quit', error)
    })
    .finally(() => { appQuitInFlight = false })
})
