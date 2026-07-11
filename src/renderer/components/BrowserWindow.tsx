import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { ArrowLeft, ArrowRight, Camera, Check, Clipboard, Crosshair, ExternalLink, FileText, FolderOpen, Globe, Loader2, Maximize2, MessageSquare, Monitor, MoreHorizontal, RefreshCw, Search, Smartphone, Square, Tablet, X } from 'lucide-react'
import { toast } from 'sonner'
import type { BrowserBounds, BrowserElementInspection, BrowserPageState, BrowserScreenshot, BrowserSnapshot } from '@/shared/browser'
import type { CodexUserInput } from '@/shared/codex'
import type { WorkspaceWindow } from '../state/workspace'
import { BROWSER_VIEWPORT_PROFILES, type BrowserViewportMode, browserViewportFrame } from './browser-viewport'
import { browserInspectionChatContext, browserScreenshotChatContext, browserSnapshotChatContext } from './browser-chat-context'
import { createBrowserScreenshotContextCapturedEvent, createBrowserSnapshotContextCapturedEvent } from './browser-context-events'
import { cn, iconButton, menuSurface } from '../lib/ui'

interface BrowserWindowProps {
  windowState: WorkspaceWindow
  active: boolean
  obscured: boolean
  onPageState: (state: BrowserPageState) => void
  onViewportModeChange: (mode: BrowserViewportMode) => void
  onSendToChat: (text: string, inputParts?: CodexUserInput[]) => void
}

type SavedBrowserScreenshot = BrowserScreenshot & { path: string }

function defaultState(windowId: string, url: string): BrowserPageState {
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

function boundsFromElement(element: HTMLElement): BrowserBounds {
  const rect = element.getBoundingClientRect()
  return {
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
  }
}

export function BrowserWindow({ windowState, active, obscured, onPageState, onViewportModeChange, onSendToChat }: BrowserWindowProps) {
  const initialUrl = windowState.browser?.url ?? 'about:blank'
  const profileId = windowState.browser?.profileId ?? 'default'
  const viewportMode = windowState.browser?.viewportMode ?? 'responsive'
  const [address, setAddress] = useState(initialUrl)
  const [state, setState] = useState<BrowserPageState>(() => defaultState(windowState.id, initialUrl))
  const [actionsMenuOpen, setActionsMenuOpen] = useState(false)
  const [actionsMenuPending, setActionsMenuPending] = useState(false)
  const [frozenSurfaceDataUrl, setFrozenSurfaceDataUrl] = useState<string | null>(null)
  const [capture, setCapture] = useState<{ screenshotDataUrl: string | null; screenshotSize: string | null; screenshotPath: string | null; snapshot: BrowserSnapshot | null }>({
    screenshotDataUrl: null,
    screenshotSize: null,
    screenshotPath: null,
    snapshot: null,
  })
  const [inspection, setInspection] = useState<BrowserElementInspection | null>(null)
  const [captureOpen, setCaptureOpen] = useState(false)
  const [inspectActive, setInspectActive] = useState(false)
  const [availableViewport, setAvailableViewport] = useState({ width: 1, height: 1 })
  const addressInputRef = useRef<HTMLInputElement>(null)
  const addressEditingRef = useRef(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const pendingBrowserActionRef = useRef<(() => void) | null>(null)
  const actionsMenuIntentRef = useRef(0)
  const actionsMenuPendingRef = useRef(false)
  const surfacePreviewCaptureRef = useRef<Promise<void> | null>(null)
  const frozenSurfaceCapturedAtRef = useRef(0)
  const shouldDetachSurfaceRef = useRef(!active || obscured || actionsMenuOpen)
  shouldDetachSurfaceRef.current = !active || obscured || actionsMenuOpen

  const viewportFrame = useMemo(() => browserViewportFrame(viewportMode, availableViewport), [availableViewport, viewportMode])
  const setNotice = useCallback((message: string | null) => {
    if (!message) return
    const options = { id: `browser-notice-${windowState.id}` }
    if (/failed|error|could not|not saved/i.test(message)) toast.error(message, options)
    else if (/click any page element/i.test(message)) toast.info(message, options)
    else toast.success(message, options)
  }, [windowState.id])

  const refreshFrozenSurface = useCallback((requireNewCapture = false): Promise<void> => {
    if (surfacePreviewCaptureRef.current) {
      const currentCapture = surfacePreviewCaptureRef.current
      return requireNewCapture
        ? currentCapture.then(() => refreshFrozenSurface())
        : currentCapture
    }

    const request = window.cranberri.browser.screenshot(windowState.id)
      .then((screenshot) => {
        setFrozenSurfaceDataUrl(screenshot.dataUrl)
        frozenSurfaceCapturedAtRef.current = Date.now()
      })
      .catch(() => {
        // A preview is opportunistic; the live BrowserView remains the source of truth.
      })
      .finally(() => {
        surfacePreviewCaptureRef.current = null
      })
    surfacePreviewCaptureRef.current = request
    return request
  }, [windowState.id])

  const attachParams = useMemo(() => ({
    windowId: windowState.id,
    profileId,
    initialUrl,
  }), [initialUrl, profileId, windowState.id])

  const attachBrowser = useCallback(async (): Promise<void> => {
    if (shouldDetachSurfaceRef.current) return
    const viewport = viewportRef.current
    if (!viewport) return
    const bounds = boundsFromElement(viewport)
    if (bounds.width < 1 || bounds.height < 1) return

    try {
      const nextState = await window.cranberri.browser.attach({ ...attachParams, bounds })
      if (shouldDetachSurfaceRef.current) {
        await window.cranberri.browser.detach(windowState.id).catch(() => undefined)
        return
      }
      setState(nextState)
      if (!addressEditingRef.current) setAddress(nextState.url)
      void refreshFrozenSurface()
      const pendingAction = pendingBrowserActionRef.current
      pendingBrowserActionRef.current = null
      pendingAction?.()
    } catch (error) {
      pendingBrowserActionRef.current = null
      setNotice(error instanceof Error ? error.message : 'Failed to attach browser')
    }
  }, [attachParams, refreshFrozenSurface, setNotice, windowState.id])

  useEffect(() => {
    return window.cranberri.browser.onEvent((event) => {
      if (event.type === 'inspection' && event.inspection.windowId === windowState.id) {
        setInspection(event.inspection)
        setInspectActive(false)
        setCaptureOpen(true)
        setNotice(`Inspected ${event.inspection.selector || event.inspection.tagName}`)
        return
      }
      if (event.type !== 'state' || event.state.windowId !== windowState.id) return
      setState(event.state)
      if (!addressEditingRef.current) setAddress(event.state.url)
      onPageState(event.state)
      if (active && !obscured && !actionsMenuOpen && !event.state.loading && !event.state.error) {
        requestAnimationFrame(() => { void refreshFrozenSurface() })
      }
    })
  }, [actionsMenuOpen, active, obscured, onPageState, refreshFrozenSurface, setNotice, windowState.id])

  useEffect(() => {
    if (!active) {
      window.cranberri.browser.detach(windowState.id).catch(() => undefined)
      return
    }

    const viewport = viewportRef.current
    const container = containerRef.current
    if (!viewport || !container) return

    const observer = new ResizeObserver(() => {
      const containerRect = container.getBoundingClientRect()
      setAvailableViewport({ width: containerRect.width, height: containerRect.height })
      const bounds = boundsFromElement(viewport)
      if (shouldDetachSurfaceRef.current || bounds.width < 1 || bounds.height < 1) return
      window.cranberri.browser.bounds(windowState.id, bounds).catch(() => undefined)
    })
    observer.observe(container)
    observer.observe(viewport)

    return () => {
      observer.disconnect()
      window.cranberri.browser.detach(windowState.id).catch(() => undefined)
    }
  }, [active, windowState.id])

  useEffect(() => {
    if (!active) return
    if (!obscured && !actionsMenuOpen) {
      void attachBrowser()
      return
    }

    const capturedForMenu = !obscured
      && actionsMenuOpen
      && Date.now() - frozenSurfaceCapturedAtRef.current < 250
    const previewReady = capturedForMenu ? Promise.resolve() : refreshFrozenSurface(true)
    void previewReady.finally(() => {
      if (shouldDetachSurfaceRef.current) {
        window.cranberri.browser.detach(windowState.id).catch(() => undefined)
      }
    })
  }, [actionsMenuOpen, active, attachBrowser, obscured, refreshFrozenSurface, windowState.id])

  const navigate = (target = address) => {
    setNotice(null)
    window.cranberri.browser.navigate(windowState.id, target)
      .then((nextState) => {
        setState(nextState)
        setAddress(nextState.url)
      })
      .catch((error) => setNotice(error instanceof Error ? error.message : 'Navigation failed'))
  }

  const captureScreenshot = () => {
    window.cranberri.browser.screenshot(windowState.id)
      .then((result) => {
        setCapture((current) => ({
          ...current,
          screenshotDataUrl: result.dataUrl,
          screenshotSize: `${result.width}x${result.height}`,
          screenshotPath: null,
        }))
        setCaptureOpen(true)
        setNotice(`Screenshot captured: ${result.width}x${result.height}`)
      })
      .catch((error) => setNotice(error instanceof Error ? error.message : 'Screenshot failed'))
  }

  const capturePageSnapshot = () => {
    window.cranberri.browser.snapshot(windowState.id)
      .then((snapshot) => {
        setCapture((current) => ({ ...current, snapshot }))
        window.dispatchEvent(createBrowserSnapshotContextCapturedEvent(snapshot))
        setCaptureOpen(true)
        setNotice(`Snapshot captured: ${snapshot.text.length.toLocaleString()} chars`)
      })
      .catch((error) => setNotice(error instanceof Error ? error.message : 'Snapshot failed'))
  }

  const captureSnapshot = () => {
    capturePageSnapshot()
  }

  const copySnapshot = () => {
    const snapshot = capture.snapshot
    if (!snapshot) return
    window.dispatchEvent(createBrowserSnapshotContextCapturedEvent(snapshot))
    navigator.clipboard.writeText(browserSnapshotChatContext(snapshot))
      .then(() => setNotice('Page context copied'))
      .catch(() => setNotice('Failed to copy page context'))
  }

  const copyInspection = () => {
    if (!inspection) return
    navigator.clipboard.writeText(browserInspectionChatContext(inspection))
      .then(() => setNotice('Element context copied'))
      .catch(() => setNotice('Failed to copy element context'))
  }

  const copyInspectionSelector = () => {
    const selector = inspection?.selector || inspection?.tagName
    if (!selector) return
    navigator.clipboard.writeText(selector)
      .then(() => setNotice('Element selector copied'))
      .catch(() => setNotice('Failed to copy element selector'))
  }

  const copyInspectionText = () => {
    const text = inspection?.text.trim()
    if (!text) return
    navigator.clipboard.writeText(text)
      .then(() => setNotice('Element text copied'))
      .catch(() => setNotice('Failed to copy element text'))
  }

  const sendCaptureToChat = () => {
    if (inspection) {
      onSendToChat(browserInspectionChatContext(inspection))
      setNotice('Element context sent to chat')
      return
    }
    if (!capture.snapshot) return
    window.dispatchEvent(createBrowserSnapshotContextCapturedEvent(capture.snapshot))
    onSendToChat(browserSnapshotChatContext(capture.snapshot))
    setNotice('Page context sent to chat')
  }

  const recordSavedScreenshot = (screenshot: BrowserScreenshot): SavedBrowserScreenshot => {
    const path = screenshot.path
    if (!path) throw new Error('Screenshot path was not saved')
    const savedScreenshot = { ...screenshot, path }
    setCapture((current) => ({
      ...current,
      screenshotDataUrl: savedScreenshot.dataUrl,
      screenshotSize: `${savedScreenshot.width}x${savedScreenshot.height}`,
      screenshotPath: savedScreenshot.path,
    }))
    window.dispatchEvent(createBrowserScreenshotContextCapturedEvent({
      screenshot: savedScreenshot,
      pageState: {
        title: state.title,
        url: state.url,
      },
    }))
    return savedScreenshot
  }

  const saveScreenshotArtifact = async () => {
    return recordSavedScreenshot(await window.cranberri.browser.saveScreenshot(windowState.id))
  }

  const sendScreenshotToChat = () => {
    saveScreenshotArtifact()
      .then((screenshot) => {
        onSendToChat(browserScreenshotChatContext(screenshot, state), [
          { type: 'localImage', path: screenshot.path, detail: 'high' },
        ])
        setNotice('Screenshot sent to chat')
      })
      .catch((error) => setNotice(error instanceof Error ? error.message : 'Failed to send screenshot'))
  }

  const withSavedScreenshotPath = async (action: (path: string) => Promise<unknown>, doneMessage: string) => {
    try {
      const path = capture.screenshotPath ?? (await saveScreenshotArtifact()).path
      if (!path) throw new Error('Screenshot path was not saved')
      await action(path)
      setNotice(doneMessage)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Screenshot handoff failed')
    }
  }

  const copyScreenshotPath = () => {
    void withSavedScreenshotPath((path) => navigator.clipboard.writeText(path), 'Screenshot path copied')
  }

  const openScreenshot = () => {
    void withSavedScreenshotPath((path) => window.cranberri.openPath(path), 'Screenshot opened')
  }

  const revealScreenshot = () => {
    void withSavedScreenshotPath((path) => window.cranberri.revealPath(path), 'Screenshot revealed')
  }

  const copyCurrentUrl = () => {
    navigator.clipboard.writeText(state.url)
      .then(() => setNotice('Browser URL copied'))
      .catch(() => setNotice('Failed to copy browser URL'))
  }

  const openCurrentUrlExternal = () => {
    window.cranberri.openExternal(state.url)
      .then(() => setNotice('Browser URL opened externally'))
      .catch((error) => setNotice(error instanceof Error ? error.message : 'Failed to open browser URL'))
  }

  const toggleInspectMode = () => {
    const action = inspectActive ? window.cranberri.browser.stopInspect(windowState.id) : window.cranberri.browser.startInspect(windowState.id)
    action
      .then(() => {
        setInspectActive(!inspectActive)
        setNotice(inspectActive ? 'Inspect mode stopped' : 'Click any page element to inspect it')
      })
      .catch((error) => setNotice(error instanceof Error ? error.message : 'Inspect mode failed'))
  }

  const selectViewportMode = (mode: BrowserViewportMode) => {
    onViewportModeChange(mode)
    setNotice(`Viewport: ${browserViewportFrame(mode, availableViewport).label}`)
  }

  const runAfterActionsMenuClose = (action: () => void) => {
    pendingBrowserActionRef.current = action
    setActionsMenuOpen(false)
  }

  const cancelActionsMenuOpen = useCallback(() => {
    actionsMenuIntentRef.current += 1
    actionsMenuPendingRef.current = false
    setActionsMenuPending(false)
    setActionsMenuOpen(false)
  }, [])

  const handleActionsMenuOpenChange = (open: boolean) => {
    if (!open) {
      cancelActionsMenuOpen()
      return
    }
    if (actionsMenuPendingRef.current) {
      cancelActionsMenuOpen()
      return
    }
    const intent = ++actionsMenuIntentRef.current
    actionsMenuPendingRef.current = true
    setActionsMenuPending(true)
    void refreshFrozenSurface(true).finally(() => {
      if (intent !== actionsMenuIntentRef.current) return
      actionsMenuPendingRef.current = false
      setActionsMenuPending(false)
      if (!shouldDetachSurfaceRef.current) setActionsMenuOpen(true)
    })
  }

  useEffect(() => {
    if ((!active || obscured) && (actionsMenuPendingRef.current || actionsMenuOpen)) cancelActionsMenuOpen()
  }, [actionsMenuOpen, active, cancelActionsMenuOpen, obscured])

  useEffect(() => {
    if (!actionsMenuPending) return
    const cancelOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      cancelActionsMenuOpen()
    }
    window.addEventListener('keydown', cancelOnEscape, true)
    return () => window.removeEventListener('keydown', cancelOnEscape, true)
  }, [actionsMenuPending, cancelActionsMenuOpen])

  return (
    <div className="flex h-full min-h-0 flex-col bg-app-bg text-app-text">
      <div className="flex h-10 shrink-0 items-center gap-1 bg-app-surface px-2 shadow-sm">
        <button
          type="button"
          onClick={() => window.cranberri.browser.back(windowState.id).catch(() => undefined)}
          disabled={!state.canGoBack}
          className={iconButton()}
          title="Back"
          aria-label="Back"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => window.cranberri.browser.forward(windowState.id).catch(() => undefined)}
          disabled={!state.canGoForward}
          className={iconButton()}
          title="Forward"
          aria-label="Forward"
        >
          <ArrowRight className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => state.loading ? window.cranberri.browser.stop(windowState.id) : window.cranberri.browser.reload(windowState.id)}
          className={iconButton()}
          title={state.loading ? 'Stop' : 'Reload'}
          aria-label={state.loading ? 'Stop' : 'Reload'}
        >
          {state.loading ? <Square className="h-4 w-4" /> : <RefreshCw className="h-4 w-4" />}
        </button>
        <form
          className="flex min-w-0 flex-1 items-center gap-2 rounded-md bg-app-bg px-2 ring-1 ring-app-border/75 focus-within:ring-2 focus-within:ring-app-accent/45"
          onSubmit={(event) => {
            event.preventDefault()
            const input = event.currentTarget.elements.namedItem('browser-address')
            const target = input instanceof HTMLInputElement ? input.value : address
            addressEditingRef.current = false
            addressInputRef.current?.blur()
            navigate(target)
          }}
        >
          <Globe className="h-3.5 w-3.5 shrink-0 text-app-text-muted" />
          <input
            ref={addressInputRef}
            value={address}
            name="browser-address"
            onFocus={() => { addressEditingRef.current = true }}
            onBlur={() => { addressEditingRef.current = false }}
            onChange={(event) => {
              addressEditingRef.current = true
              setAddress(event.target.value)
            }}
            className="h-7 min-w-0 flex-1 bg-transparent text-xs text-app-text outline-none"
            placeholder="https://localhost:5173"
          />
          <button
            type="submit"
            className={cn(iconButton(), 'h-6 w-6')}
            title="Navigate"
            aria-label="Navigate"
            onMouseDown={(event) => event.preventDefault()}
          >
            <Search className="h-3.5 w-3.5" />
          </button>
        </form>
        <button
          type="button"
          onClick={toggleInspectMode}
          className={iconButton({ tone: inspectActive ? 'active' : 'neutral' })}
          title={inspectActive ? 'Stop inspecting' : 'Inspect page element'}
          aria-label={inspectActive ? 'Stop inspecting' : 'Inspect page element'}
        >
          <Crosshair className="h-4 w-4" />
        </button>
        <BrowserActionsMenu
          open={actionsMenuOpen}
          pending={actionsMenuPending}
          onOpenChange={handleActionsMenuOpenChange}
          viewportMode={viewportMode}
          canUseUrl={Boolean(state.url)}
          canOpenUrl={Boolean(state.url && state.url !== 'about:blank')}
          onSelectViewport={selectViewportMode}
          onCopyUrl={copyCurrentUrl}
          onOpenUrl={openCurrentUrlExternal}
          onCaptureScreenshot={() => runAfterActionsMenuClose(captureScreenshot)}
          onCaptureSnapshot={() => runAfterActionsMenuClose(captureSnapshot)}
        />
      </div>
      {state.error && (
        <div className="bg-app-danger/8 px-3 py-2 text-xs text-app-danger" role="alert">
          {state.error}
        </div>
      )}
      <div className="flex min-h-0 flex-1 flex-col">
        <div ref={containerRef} className="min-h-0 flex-1 overflow-auto bg-app-bg p-3">
          <div
            ref={viewportRef}
            data-browser-viewport="true"
            data-browser-surface-obscured={obscured ? 'true' : undefined}
            className="relative mx-auto min-h-0 overflow-hidden bg-white shadow-[0_0_0_1px_var(--app-border)]"
            style={{ width: viewportFrame.width, height: viewportFrame.height }}
          >
            {!active && (
              <div className="absolute inset-0 flex items-center justify-center bg-app-bg text-sm text-app-text-muted">
                Browser paused
              </div>
            )}
            {active && (obscured || actionsMenuOpen) && (
              <div
                data-browser-surface-frozen="true"
                className="absolute inset-0 flex items-center justify-center overflow-hidden bg-app-surface text-sm text-app-text-muted"
              >
                {frozenSurfaceDataUrl ? (
                  <img
                    src={frozenSurfaceDataUrl}
                    alt=""
                    aria-hidden="true"
                    draggable={false}
                    className="h-full w-full object-fill"
                  />
                ) : (
                  <div className="flex items-center gap-2">
                    <Globe className="h-4 w-4" />
                    Browser view paused
                  </div>
                )}
              </div>
            )}
          </div>
          {active && viewportMode !== 'responsive' && (
            <div className="mx-auto mt-2 text-center text-micro text-app-text-muted" style={{ width: viewportFrame.width }}>
              {viewportFrame.label}
            </div>
          )}
        </div>
        {captureOpen && (
          <div className="grid max-h-72 shrink-0 grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-1 bg-app-surface-2/45 p-1">
            <div className="min-w-0 bg-app-surface">
              <CaptureHeader icon={Camera} label={capture.screenshotSize ? `Screenshot ${capture.screenshotSize}` : 'Screenshot'}>
                <button
                  type="button"
                  onClick={sendScreenshotToChat}
                  disabled={!capture.screenshotDataUrl}
                  className={iconButton()}
                  title="Send screenshot to chat"
                >
                  <MessageSquare className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={copyScreenshotPath}
                  disabled={!capture.screenshotDataUrl}
                  className={iconButton()}
                  title="Copy screenshot path"
                >
                  <Clipboard className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={openScreenshot}
                  disabled={!capture.screenshotDataUrl}
                  className={iconButton()}
                  title="Open screenshot"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={revealScreenshot}
                  disabled={!capture.screenshotDataUrl}
                  className={iconButton()}
                  title="Reveal screenshot in Finder"
                >
                  <FolderOpen className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setCaptureOpen(false)}
                  className={iconButton()}
                  title="Close captures"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </CaptureHeader>
              <div className="h-52 overflow-auto bg-app-bg p-2">
                {capture.screenshotDataUrl ? (
                  <img src={capture.screenshotDataUrl} alt="Captured browser screenshot" className="max-w-full rounded border border-app-border" />
                ) : (
                  <div className="flex h-full items-center justify-center text-xs text-app-text-muted">No screenshot captured yet.</div>
                )}
              </div>
            </div>
            <div className="min-w-0 bg-app-surface">
              <CaptureHeader icon={inspection ? Crosshair : FileText} label={inspection ? inspection.selector || inspection.tagName : capture.snapshot ? capture.snapshot.title || 'Page snapshot' : 'Page snapshot'}>
                <button
                  type="button"
                  onClick={sendCaptureToChat}
                  disabled={inspection ? false : !capture.snapshot}
                  className={iconButton()}
                  title={inspection ? 'Send element context to chat' : 'Send page text to chat'}
                >
                  <MessageSquare className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={inspection ? copyInspection : copySnapshot}
                  disabled={inspection ? false : !capture.snapshot?.text}
                  className={iconButton()}
                  title={inspection ? 'Copy element context' : 'Copy page context'}
                >
                  <Clipboard className="h-3.5 w-3.5" />
                </button>
                {inspection && (
                  <>
                    <button
                      type="button"
                      onClick={copyInspectionSelector}
                      disabled={!inspection.selector && !inspection.tagName}
                      className={iconButton()}
                      title="Copy element selector"
                    >
                      <Crosshair className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={copyInspectionText}
                      disabled={!inspection.text.trim()}
                      className={iconButton()}
                      title="Copy element text"
                    >
                      <FileText className="h-3.5 w-3.5" />
                    </button>
                  </>
                )}
              </CaptureHeader>
              {inspection ? (
                <ElementInspectionView inspection={inspection} />
              ) : (
                <pre className="h-52 overflow-auto whitespace-pre-wrap break-words bg-app-bg p-3 font-mono text-caption leading-relaxed text-app-text-muted">
                  {capture.snapshot?.text || 'No page text captured yet.'}
                </pre>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function ElementInspectionView({ inspection }: { inspection: BrowserElementInspection }) {
  const styleRows = [
    ['Display', inspection.styles.display],
    ['Font', `${inspection.styles.fontSize} / ${inspection.styles.fontWeight}`],
    ['Color', inspection.styles.color],
    ['Background', inspection.styles.backgroundColor],
    ['Margin', inspection.styles.margin],
    ['Padding', inspection.styles.padding],
    ['Radius', inspection.styles.borderRadius],
  ]

  return (
    <div className="h-52 overflow-auto bg-app-bg p-3 text-xs">
      <div className="grid grid-cols-2 gap-2">
        <InfoCell label="Tag" value={inspection.tagName} />
        <InfoCell label="Rect" value={`${inspection.rect.width}x${inspection.rect.height} @ ${inspection.rect.x},${inspection.rect.y}`} />
      </div>
      {inspection.text && (
        <pre className="mt-3 max-h-20 overflow-auto whitespace-pre-wrap break-words rounded bg-app-surface px-2 py-1.5 font-mono text-caption leading-relaxed text-app-text-muted">
          {inspection.text}
        </pre>
      )}
      <div className="mt-3 space-y-1">
        {styleRows.map(([label, value]) => (
          <div key={label} className="flex gap-3">
            <span className="w-20 shrink-0 text-app-text-muted">{label}</span>
            <span className="min-w-0 flex-1 break-words font-mono text-caption">{value || '-'}</span>
          </div>
        ))}
      </div>
      {Object.keys(inspection.attributes).length > 0 && (
        <div className="mt-3 rounded-md bg-app-surface px-2 py-2">
          <div className="mb-1 text-caption font-medium text-app-text-muted">Attributes</div>
          {Object.entries(inspection.attributes).slice(0, 8).map(([name, value]) => (
            <div key={name} className="flex gap-3">
              <span className="w-20 shrink-0 text-app-text-muted">{name}</span>
              <span className="min-w-0 flex-1 truncate font-mono text-caption" title={value}>{value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function InfoCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-app-surface px-2 py-1.5">
      <div className="text-caption text-app-text-muted">{label}</div>
      <div className="mt-1 truncate font-mono text-caption" title={value}>{value}</div>
    </div>
  )
}

function viewportModeIcon(mode: BrowserViewportMode): React.ElementType {
  switch (mode) {
    case 'mobile':
      return Smartphone
    case 'tablet':
      return Tablet
    case 'desktop':
      return Monitor
    default:
      return Maximize2
  }
}

function CaptureHeader({ icon: Icon, label, children }: { icon: React.ElementType; label: string; children?: React.ReactNode }) {
  return (
    <div className="flex h-9 items-center justify-between gap-2 px-3">
      <div className="flex min-w-0 items-center gap-2 text-xs font-medium">
        <Icon className="h-3.5 w-3.5 shrink-0 text-app-text-muted" />
        <span className="truncate" title={label}>{label}</span>
      </div>
      {children}
    </div>
  )
}

const BROWSER_MENU_ITEM = 'flex min-h-8 select-none items-center gap-2 rounded-md px-2 text-xs text-app-text outline-none data-[highlighted]:bg-app-surface-2 data-[disabled]:pointer-events-none data-[disabled]:opacity-40'

function BrowserActionsMenu({
  open,
  pending,
  onOpenChange,
  viewportMode,
  canUseUrl,
  canOpenUrl,
  onSelectViewport,
  onCopyUrl,
  onOpenUrl,
  onCaptureScreenshot,
  onCaptureSnapshot,
}: {
  open: boolean
  pending: boolean
  onOpenChange: (open: boolean) => void
  viewportMode: BrowserViewportMode
  canUseUrl: boolean
  canOpenUrl: boolean
  onSelectViewport: (mode: BrowserViewportMode) => void
  onCopyUrl: () => void
  onOpenUrl: () => void
  onCaptureScreenshot: () => void
  onCaptureSnapshot: () => void
}) {
  return (
    <DropdownMenu.Root open={open} onOpenChange={onOpenChange}>
      <DropdownMenu.Trigger asChild>
        <button type="button" className={iconButton()} title="Browser actions" aria-label={pending ? 'Cancel opening browser actions' : 'Browser actions'} aria-busy={pending}>
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <MoreHorizontal className="h-4 w-4" />}
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={6} collisionPadding={8} className={cn(menuSurface, 'z-[1300] w-56 text-xs outline-none')}>
          <DropdownMenu.Label className="px-2 pb-1 pt-0.5 text-caption font-medium text-app-text-muted">Viewport</DropdownMenu.Label>
          <DropdownMenu.RadioGroup value={viewportMode} onValueChange={(mode) => onSelectViewport(mode as BrowserViewportMode)}>
            {BROWSER_VIEWPORT_PROFILES.map((profile) => {
              const Icon = viewportModeIcon(profile.mode)
              return (
                <DropdownMenu.RadioItem key={profile.mode} value={profile.mode} className={BROWSER_MENU_ITEM}>
                  <Icon className="h-3.5 w-3.5 text-app-text-muted" />
                  <span className="flex-1">{profile.label}</span>
                  <DropdownMenu.ItemIndicator><Check className="h-3.5 w-3.5 text-app-accent" /></DropdownMenu.ItemIndicator>
                </DropdownMenu.RadioItem>
              )
            })}
          </DropdownMenu.RadioGroup>
          <DropdownMenu.Label className="mt-2 px-2 pb-1 pt-1 text-caption font-medium text-app-text-muted">Page</DropdownMenu.Label>
          <DropdownMenu.Item disabled={!canUseUrl} onSelect={onCopyUrl} className={BROWSER_MENU_ITEM} title="Copy browser URL">
            <Clipboard className="h-3.5 w-3.5 text-app-text-muted" /> Copy URL
          </DropdownMenu.Item>
          <DropdownMenu.Item disabled={!canOpenUrl} onSelect={onOpenUrl} className={BROWSER_MENU_ITEM} title="Open browser URL externally">
            <ExternalLink className="h-3.5 w-3.5 text-app-text-muted" /> Open externally
          </DropdownMenu.Item>
          <DropdownMenu.Item onSelect={onCaptureScreenshot} className={BROWSER_MENU_ITEM} title="Capture screenshot">
            <Camera className="h-3.5 w-3.5 text-app-text-muted" /> Capture screenshot
          </DropdownMenu.Item>
          <DropdownMenu.Item onSelect={onCaptureSnapshot} className={BROWSER_MENU_ITEM} title="Capture page text">
            <FileText className="h-3.5 w-3.5 text-app-text-muted" /> Capture page text
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
