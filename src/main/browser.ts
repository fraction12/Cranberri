import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { app, BrowserWindow, WebContentsView, ipcMain, nativeImage, session } from 'electron'
import {
  browserAttachParamsSchema,
  browserBoundsSchema,
  browserElementInspectionSchema,
  browserInspectElementParamsSchema,
  browserPageStateSchema,
  type BrowserAttachParams,
  type BrowserBounds,
  type BrowserElementInspection,
  type BrowserInspectElementParams,
  type BrowserPageState,
  type BrowserScreenshot,
  type BrowserSnapshot,
  taskBrowserAttachParamsSchema,
} from '../shared/browser'
import { assertImmutableExecutionBinding, resolveExecutionContext, type ExecutionContext } from './execution-context'

const DEFAULT_URL = 'about:blank'
const ALLOWED_PROTOCOLS = new Set(['about:', 'http:', 'https:', 'file:'])
const MAX_SNAPSHOT_TEXT = 4000
const INSPECT_CONSOLE_PREFIX = '__CRANBERRI_BROWSER_INSPECT__'
const SCREENSHOT_DIR = 'browser-captures'

interface BrowserEntry {
  view: WebContentsView
  windowId: string
  attached: boolean
  state: BrowserPageState
  inspectMode: boolean
  execution: Pick<ExecutionContext, 'projectId' | 'taskId' | 'checkoutId' | 'worktreeId'> | null
}

function blankState(windowId: string, url = DEFAULT_URL): BrowserPageState {
  return {
    windowId,
    url,
    title: 'Browser',
    loading: false,
    canGoBack: false,
    canGoForward: false,
    error: null,
  }
}

export function normalizeBrowserUrl(value: string | undefined, fallback = DEFAULT_URL): string {
  const raw = value?.trim() || fallback
  if (raw === 'about:blank') return raw
  const withProtocol = /^[a-zA-Z][a-zA-Z\d+.-]*:\/\//.test(raw)
    ? raw
    : /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|[\w.-]+):\d+(?:\/|$)/.test(raw)
      ? `http://${raw}`
      : /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(raw)
        ? raw
        : `https://${raw}`
  let parsed: URL
  try {
    parsed = new URL(withProtocol)
  } catch {
    throw new Error('Invalid browser URL')
  }
  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) throw new Error(`Unsupported browser URL protocol: ${parsed.protocol}`)
  return parsed.toString()
}

export function normalizeBrowserProfileId(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '')
  return normalized || 'default'
}

export function browserSessionPartition(profileId: string): string {
  return `persist:cranberri-browser:${normalizeBrowserProfileId(profileId)}`
}

export function browserScreenshotPath(userDataPath: string, windowId: string, timestamp = Date.now()): string {
  const safeWindowId = windowId.trim().replace(/[^a-zA-Z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '') || 'browser'
  return path.join(userDataPath, SCREENSHOT_DIR, `${safeWindowId}-${timestamp}.png`)
}

export function normalizeBrowserInspectionPayload(windowId: string, payload: unknown, page: { url: string; title: string }): BrowserElementInspection {
  return browserElementInspectionSchema.parse({
    ...(typeof payload === 'object' && payload !== null ? payload : {}),
    windowId,
    url: page.url,
    title: page.title,
  })
}

function normalizeBounds(bounds: BrowserBounds): BrowserBounds {
  const parsed = browserBoundsSchema.parse(bounds)
  return {
    x: Math.max(0, Math.round(parsed.x)),
    y: Math.max(0, Math.round(parsed.y)),
    width: Math.max(0, Math.round(parsed.width)),
    height: Math.max(0, Math.round(parsed.height)),
  }
}

export class BrowserManager {
  private readonly entries = new Map<string, BrowserEntry>()

  constructor(private readonly mainWindowGetter: () => BrowserWindow | null) {}

  attach(params: BrowserAttachParams, execution: ExecutionContext | null = null): BrowserPageState {
    const parsed = browserAttachParamsSchema.parse(params)
    const win = this.requireWindow()
    let entry = this.entries.get(parsed.windowId)
    if (!entry) {
      entry = this.createEntry(parsed.windowId, parsed.profileId, execution)
      this.entries.set(parsed.windowId, entry)
    } else if (execution && entry.execution) {
      assertImmutableExecutionBinding(entry.execution, execution, 'Browser')
    }

    if (!entry.attached) {
      win.contentView.addChildView(entry.view)
      entry.attached = true
    }
    entry.view.setBounds(normalizeBounds(parsed.bounds))

    const targetUrl = normalizeBrowserUrl(parsed.initialUrl, DEFAULT_URL)
    const currentUrl = entry.view.webContents.getURL()
    if (!currentUrl || currentUrl === DEFAULT_URL && targetUrl !== DEFAULT_URL) {
      void entry.view.webContents.loadURL(targetUrl)
      entry.state = { ...entry.state, url: targetUrl, loading: true, error: null }
      this.emit(entry)
    }

    return entry.state
  }

  setBounds(windowId: string, bounds: BrowserBounds): BrowserPageState {
    const entry = this.requireEntry(windowId)
    entry.view.setBounds(normalizeBounds(bounds))
    return entry.state
  }

  detach(windowId: string): void {
    const entry = this.entries.get(windowId)
    const win = this.mainWindowGetter()
    if (!entry || !win || !entry.attached) return
    win.contentView.removeChildView(entry.view)
    entry.attached = false
  }

  destroy(windowId: string): void {
    const entry = this.entries.get(windowId)
    if (!entry) return
    this.detach(windowId)
    if (!entry.view.webContents.isDestroyed()) entry.view.webContents.close({ waitForBeforeUnload: false })
    this.entries.delete(windowId)
  }

  navigate(windowId: string, url: string): BrowserPageState {
    const entry = this.requireEntry(windowId)
    const targetUrl = normalizeBrowserUrl(url)
    void entry.view.webContents.loadURL(targetUrl)
    entry.state = { ...entry.state, url: targetUrl, loading: true, error: null }
    this.emit(entry)
    return entry.state
  }

  reload(windowId: string): BrowserPageState {
    const entry = this.requireEntry(windowId)
    entry.view.webContents.reload()
    return entry.state
  }

  stop(windowId: string): BrowserPageState {
    const entry = this.requireEntry(windowId)
    entry.view.webContents.stop()
    entry.state = this.readState(entry, { loading: false })
    this.emit(entry)
    return entry.state
  }

  goBack(windowId: string): BrowserPageState {
    const entry = this.requireEntry(windowId)
    if (entry.view.webContents.navigationHistory.canGoBack()) entry.view.webContents.navigationHistory.goBack()
    return entry.state
  }

  goForward(windowId: string): BrowserPageState {
    const entry = this.requireEntry(windowId)
    if (entry.view.webContents.navigationHistory.canGoForward()) entry.view.webContents.navigationHistory.goForward()
    return entry.state
  }

  state(windowId: string): BrowserPageState {
    return this.requireEntry(windowId).state
  }

  async screenshot(windowId: string): Promise<BrowserScreenshot> {
    const entry = this.requireEntry(windowId)
    const image = await entry.view.webContents.capturePage()
    const size = image.getSize()
    return {
      windowId,
      dataUrl: image.isEmpty() ? nativeImage.createEmpty().toDataURL() : image.toDataURL(),
      width: size.width,
      height: size.height,
    }
  }

  async saveScreenshot(windowId: string): Promise<BrowserScreenshot> {
    const entry = this.requireEntry(windowId)
    const image = await entry.view.webContents.capturePage()
    const size = image.getSize()
    const screenshotPath = browserScreenshotPath(app.getPath('userData'), windowId)
    await mkdir(path.dirname(screenshotPath), { recursive: true })
    await writeFile(screenshotPath, image.isEmpty() ? nativeImage.createEmpty().toPNG() : image.toPNG())
    return {
      windowId,
      dataUrl: image.isEmpty() ? nativeImage.createEmpty().toDataURL() : image.toDataURL(),
      width: size.width,
      height: size.height,
      path: screenshotPath,
    }
  }

  async snapshot(windowId: string): Promise<BrowserSnapshot> {
    const entry = this.requireEntry(windowId)
    return entry.view.webContents.executeJavaScript(`
      (() => ({
        windowId: ${JSON.stringify(windowId)},
        url: location.href,
        title: document.title || '',
        viewport: { width: window.innerWidth, height: window.innerHeight },
        text: (document.body?.innerText || '').slice(0, ${MAX_SNAPSHOT_TEXT})
      }))()
    `, true) as Promise<BrowserSnapshot>
  }

  async startInspect(windowId: string): Promise<{ ok: true }> {
    const entry = this.requireEntry(windowId)
    await entry.view.webContents.executeJavaScript(inspectScript(), true)
    entry.inspectMode = true
    return { ok: true }
  }

  async inspectElement(windowId: string, params?: BrowserInspectElementParams): Promise<BrowserElementInspection> {
    const entry = this.requireEntry(windowId)
    const parsed = browserInspectElementParamsSchema.parse(params)
    const payload = await entry.view.webContents.executeJavaScript(elementInspectionScript(parsed), true)
    const inspection = normalizeBrowserInspectionPayload(windowId, payload, {
      url: entry.view.webContents.getURL() || entry.state.url,
      title: entry.view.webContents.getTitle() || entry.state.title,
    })
    this.emitInspection(inspection)
    return inspection
  }

  async stopInspect(windowId: string): Promise<{ ok: true }> {
    const entry = this.requireEntry(windowId)
    await entry.view.webContents.executeJavaScript(`
      (() => {
        window.__cranberriInspectMode?.cleanup?.()
        return true
      })()
    `, true)
    entry.inspectMode = false
    return { ok: true }
  }

  private createEntry(windowId: string, profileId: string, execution: ExecutionContext | null): BrowserEntry {
    const browserSession = session.fromPartition(browserSessionPartition(profileId))
    const view = new WebContentsView({
      webPreferences: {
        session: browserSession,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
      },
    })
    const entry: BrowserEntry = {
      view,
      windowId,
      attached: false,
      inspectMode: false,
      state: blankState(windowId),
      execution: execution ? {
        projectId: execution.projectId,
        taskId: execution.taskId,
        checkoutId: execution.checkoutId,
        worktreeId: execution.worktreeId,
      } : null,
    }

    view.webContents.on('did-start-loading', () => {
      entry.state = this.readState(entry, { loading: true, error: null })
      this.emit(entry)
    })
    view.webContents.on('did-stop-loading', () => {
      entry.state = this.readState(entry, { loading: false, error: null })
      this.emit(entry)
    })
    view.webContents.on('page-title-updated', (_event, title) => {
      entry.state = this.readState(entry, { title })
      this.emit(entry)
    })
    view.webContents.on('did-navigate', (_event, url) => {
      entry.state = this.readState(entry, { url, error: null })
      this.emit(entry)
    })
    view.webContents.on('did-navigate-in-page', (_event, url) => {
      entry.state = this.readState(entry, { url, error: null })
      this.emit(entry)
    })
    view.webContents.on('did-fail-load', (_event, _code, description, url, isMainFrame) => {
      if (!isMainFrame) return
      entry.state = this.readState(entry, { url, loading: false, error: description })
      this.emit(entry)
    })
    view.webContents.on('console-message', (_event, ...args: unknown[]) => {
      const message = args.find((arg): arg is string => typeof arg === 'string' && arg.startsWith(INSPECT_CONSOLE_PREFIX))
      if (!message) return
      const rawPayload = message.slice(INSPECT_CONSOLE_PREFIX.length)
      try {
        const inspection = normalizeBrowserInspectionPayload(entry.windowId, JSON.parse(rawPayload), {
          url: entry.view.webContents.getURL() || entry.state.url,
          title: entry.view.webContents.getTitle() || entry.state.title,
        })
        entry.inspectMode = false
        this.emitInspection(inspection)
      } catch (error) {
        entry.inspectMode = false
        entry.state = this.readState(entry, { error: error instanceof Error ? error.message : 'Failed to inspect element' })
        this.emit(entry)
      }
    })

    return entry
  }

  private readState(entry: BrowserEntry, patch: Partial<BrowserPageState> = {}): BrowserPageState {
    const webContents = entry.view.webContents
    return browserPageStateSchema.parse({
      ...entry.state,
      windowId: entry.windowId,
      url: patch.url ?? (webContents.getURL() || entry.state.url),
      title: patch.title ?? (webContents.getTitle() || entry.state.title),
      loading: patch.loading ?? webContents.isLoading(),
      canGoBack: webContents.navigationHistory.canGoBack(),
      canGoForward: webContents.navigationHistory.canGoForward(),
      error: patch.error ?? entry.state.error,
    })
  }

  private emit(entry: BrowserEntry): void {
    const win = this.mainWindowGetter()
    if (!win || win.isDestroyed()) return
    win.webContents.send('browser:event', { type: 'state', state: entry.state })
  }

  private emitInspection(inspection: BrowserElementInspection): void {
    const win = this.mainWindowGetter()
    if (!win || win.isDestroyed()) return
    win.webContents.send('browser:event', { type: 'inspection', inspection })
  }

  private requireWindow(): BrowserWindow {
    const win = this.mainWindowGetter()
    if (!win || win.isDestroyed()) throw new Error('Main window is not available')
    return win
  }

  private requireEntry(windowId: string): BrowserEntry {
    const entry = this.entries.get(windowId)
    if (!entry) throw new Error('Browser window is not attached')
    return entry
  }
}

export function initBrowserIpc(mainWindowGetter: () => BrowserWindow | null): void {
  const manager = new BrowserManager(mainWindowGetter)

  ipcMain.handle('browser:attach', (_, params: BrowserAttachParams) => manager.attach(params))
  ipcMain.handle('browser:task:attach', (_, params: unknown) => {
    const parsed = taskBrowserAttachParamsSchema.parse(params)
    return manager.attach(parsed, resolveExecutionContext(parsed.taskId))
  })
  ipcMain.handle('browser:bounds', (_, windowId: string, bounds: BrowserBounds) => manager.setBounds(windowId, bounds))
  ipcMain.handle('browser:detach', (_, windowId: string) => {
    manager.detach(windowId)
    return { ok: true }
  })
  ipcMain.handle('browser:destroy', (_, windowId: string) => {
    manager.destroy(windowId)
    return { ok: true }
  })
  ipcMain.handle('browser:navigate', (_, windowId: string, url: string) => manager.navigate(windowId, url))
  ipcMain.handle('browser:reload', (_, windowId: string) => manager.reload(windowId))
  ipcMain.handle('browser:stop', (_, windowId: string) => manager.stop(windowId))
  ipcMain.handle('browser:back', (_, windowId: string) => manager.goBack(windowId))
  ipcMain.handle('browser:forward', (_, windowId: string) => manager.goForward(windowId))
  ipcMain.handle('browser:state', (_, windowId: string) => manager.state(windowId))
  ipcMain.handle('browser:screenshot', (_, windowId: string) => manager.screenshot(windowId))
  ipcMain.handle('browser:screenshot:save', (_, windowId: string) => manager.saveScreenshot(windowId))
  ipcMain.handle('browser:snapshot', (_, windowId: string) => manager.snapshot(windowId))
  ipcMain.handle('browser:inspect:start', (_, windowId: string) => manager.startInspect(windowId))
  ipcMain.handle('browser:inspect:element', (_, windowId: string, params?: BrowserInspectElementParams) => manager.inspectElement(windowId, params))
  ipcMain.handle('browser:inspect:stop', (_, windowId: string) => manager.stopInspect(windowId))
}

function elementInspectionScript(params?: BrowserInspectElementParams): string {
  return `
    (() => {
      const selectorFor = (element) => {
        if (!(element instanceof Element)) return ''
        if (element.id) return '#' + CSS.escape(element.id)
        const segments = []
        let current = element
        while (current && current.nodeType === Node.ELEMENT_NODE && segments.length < 5) {
          const tag = current.localName
          const className = Array.from(current.classList || []).slice(0, 2).map((name) => '.' + CSS.escape(name)).join('')
          const parent = current.parentElement
          const siblings = parent ? Array.from(parent.children).filter((child) => child.localName === tag) : []
          const nth = siblings.length > 1 ? ':nth-of-type(' + (siblings.indexOf(current) + 1) + ')' : ''
          segments.unshift(tag + className + nth)
          current = parent
        }
        return segments.join(' > ')
      }

      const readElement = (element) => {
        const rect = element.getBoundingClientRect()
        const style = getComputedStyle(element)
        return {
          selector: selectorFor(element),
          tagName: element.tagName.toLowerCase(),
          text: (element.innerText || element.textContent || '').trim().slice(0, 800),
          rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          styles: {
            display: style.display,
            fontFamily: style.fontFamily,
            fontSize: style.fontSize,
            fontWeight: style.fontWeight,
            color: style.color,
            backgroundColor: style.backgroundColor,
            margin: style.margin,
            padding: style.padding,
            borderRadius: style.borderRadius,
          },
          attributes: Object.fromEntries(Array.from(element.attributes || []).slice(0, 20).map((attribute) => [attribute.name, attribute.value])),
        }
      }

      const x = ${params?.x != null ? JSON.stringify(params.x) : 'Math.max(1, Math.floor(window.innerWidth / 2))'}
      const y = ${params?.y != null ? JSON.stringify(params.y) : 'Math.max(1, Math.min(window.innerHeight - 1, Math.floor(window.innerHeight / 3)))'}
      const element = document.elementFromPoint(x, y) || document.body || document.documentElement
      return readElement(element)
    })()
  `
}

function inspectScript(): string {
  return `
    (() => {
      const PREFIX = ${JSON.stringify(INSPECT_CONSOLE_PREFIX)}
      const KEY = '__cranberriInspectMode'
      window[KEY]?.cleanup?.()

      const overlay = document.createElement('div')
      overlay.setAttribute('data-cranberri-inspect-overlay', 'true')
      Object.assign(overlay.style, {
        position: 'fixed',
        zIndex: '2147483647',
        pointerEvents: 'none',
        border: '2px solid #22c55e',
        background: 'rgba(34, 197, 94, 0.12)',
        borderRadius: '3px',
        display: 'none',
      })
      document.documentElement.appendChild(overlay)

      const selectorFor = (element) => {
        if (!(element instanceof Element)) return ''
        if (element.id) return '#' + CSS.escape(element.id)
        const segments = []
        let current = element
        while (current && current.nodeType === Node.ELEMENT_NODE && segments.length < 5) {
          const tag = current.localName
          const className = Array.from(current.classList || []).slice(0, 2).map((name) => '.' + CSS.escape(name)).join('')
          const parent = current.parentElement
          const siblings = parent ? Array.from(parent.children).filter((child) => child.localName === tag) : []
          const nth = siblings.length > 1 ? ':nth-of-type(' + (siblings.indexOf(current) + 1) + ')' : ''
          segments.unshift(tag + className + nth)
          current = parent
        }
        return segments.join(' > ')
      }

      const readElement = (element) => {
        const rect = element.getBoundingClientRect()
        const style = getComputedStyle(element)
        return {
          selector: selectorFor(element),
          tagName: element.tagName.toLowerCase(),
          text: (element.innerText || element.textContent || '').trim().slice(0, 800),
          rect: {
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          },
          styles: {
            display: style.display,
            fontFamily: style.fontFamily,
            fontSize: style.fontSize,
            fontWeight: style.fontWeight,
            color: style.color,
            backgroundColor: style.backgroundColor,
            margin: style.margin,
            padding: style.padding,
            borderRadius: style.borderRadius,
          },
          attributes: Object.fromEntries(Array.from(element.attributes || []).slice(0, 30).map((attribute) => [attribute.name, attribute.value.slice(0, 300)])),
        }
      }

      const updateOverlay = (event) => {
        const target = event.target
        if (!(target instanceof Element)) return
        const rect = target.getBoundingClientRect()
        Object.assign(overlay.style, {
          display: 'block',
          left: rect.x + 'px',
          top: rect.y + 'px',
          width: rect.width + 'px',
          height: rect.height + 'px',
        })
      }

      const cleanup = () => {
        document.removeEventListener('mousemove', updateOverlay, true)
        document.removeEventListener('click', capture, true)
        document.removeEventListener('keydown', onKeydown, true)
        overlay.remove()
        window[KEY] = null
      }

      const capture = (event) => {
        event.preventDefault()
        event.stopPropagation()
        const target = event.target
        if (target instanceof Element) {
          console.info(PREFIX + JSON.stringify(readElement(target)))
        }
        cleanup()
      }

      const onKeydown = (event) => {
        if (event.key === 'Escape') cleanup()
      }

      document.addEventListener('mousemove', updateOverlay, true)
      document.addEventListener('click', capture, true)
      document.addEventListener('keydown', onKeydown, true)
      window[KEY] = { cleanup }
      return true
    })()
  `
}
