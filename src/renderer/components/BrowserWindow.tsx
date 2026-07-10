import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, Camera, Clipboard, Crosshair, ExternalLink, FileText, FolderOpen, Globe, Maximize2, MessageSquare, Monitor, RefreshCw, Search, Smartphone, Square, Tablet, X } from 'lucide-react'
import type { BrowserBounds, BrowserElementInspection, BrowserPageState, BrowserScreenshot, BrowserSnapshot } from '@/shared/browser'
import type { CodexUserInput } from '@/shared/codex'
import type { WorkspaceWindow } from '../state/workspace'
import { BROWSER_VIEWPORT_PROFILES, type BrowserViewportMode, browserViewportFrame } from './browser-viewport'
import { browserInspectionChatContext, browserScreenshotChatContext, browserSnapshotChatContext } from './browser-chat-context'
import { createBrowserScreenshotContextCapturedEvent, createBrowserSnapshotContextCapturedEvent } from './browser-context-events'

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
  const [notice, setNotice] = useState<string | null>(null)
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

  const viewportFrame = useMemo(() => browserViewportFrame(viewportMode, availableViewport), [availableViewport, viewportMode])

  const attachParams = useMemo(() => ({
    windowId: windowState.id,
    profileId,
    initialUrl,
  }), [initialUrl, profileId, windowState.id])

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
    })
  }, [onPageState, windowState.id])

  useEffect(() => {
    if (!active || obscured) {
      window.cranberri.browser.detach(windowState.id).catch(() => undefined)
      return
    }

    const viewport = viewportRef.current
    const container = containerRef.current
    if (!viewport || !container) return

    const attach = () => {
      const bounds = boundsFromElement(viewport)
      if (bounds.width < 1 || bounds.height < 1) return
      window.cranberri.browser.attach({ ...attachParams, bounds })
        .then((nextState) => {
          setState(nextState)
          if (!addressEditingRef.current) setAddress(nextState.url)
        })
        .catch((error) => setNotice(error instanceof Error ? error.message : 'Failed to attach browser'))
    }

    attach()
    const observer = new ResizeObserver(() => {
      const containerRect = container.getBoundingClientRect()
      setAvailableViewport({ width: containerRect.width, height: containerRect.height })
      const bounds = boundsFromElement(viewport)
      if (bounds.width < 1 || bounds.height < 1) return
      window.cranberri.browser.bounds(windowState.id, bounds).catch(() => undefined)
    })
    observer.observe(container)
    observer.observe(viewport)

    return () => {
      observer.disconnect()
      window.cranberri.browser.detach(windowState.id).catch(() => undefined)
    }
  }, [active, attachParams, obscured, viewportFrame.height, viewportFrame.width, windowState.id])

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

  return (
    <div className="flex h-full min-h-0 flex-col bg-app-bg text-app-text">
      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-app-border bg-app-surface px-2">
        <button
          type="button"
          onClick={() => window.cranberri.browser.back(windowState.id).catch(() => undefined)}
          disabled={!state.canGoBack}
          className="rounded p-1.5 text-app-text-muted hover:bg-app-surface-2 hover:text-app-text disabled:opacity-35"
          title="Back"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => window.cranberri.browser.forward(windowState.id).catch(() => undefined)}
          disabled={!state.canGoForward}
          className="rounded p-1.5 text-app-text-muted hover:bg-app-surface-2 hover:text-app-text disabled:opacity-35"
          title="Forward"
        >
          <ArrowRight className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => state.loading ? window.cranberri.browser.stop(windowState.id) : window.cranberri.browser.reload(windowState.id)}
          className="rounded p-1.5 text-app-text-muted hover:bg-app-surface-2 hover:text-app-text"
          title={state.loading ? 'Stop' : 'Reload'}
        >
          {state.loading ? <Square className="h-4 w-4" /> : <RefreshCw className="h-4 w-4" />}
        </button>
        <form
          className="flex min-w-0 flex-1 items-center gap-2 rounded-md border border-app-border bg-app-bg px-2"
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
            className="rounded p-1 text-app-text-muted hover:text-app-text"
            title="Navigate"
            onMouseDown={(event) => event.preventDefault()}
          >
            <Search className="h-3.5 w-3.5" />
          </button>
        </form>
        <button
          type="button"
          onClick={copyCurrentUrl}
          disabled={!state.url}
          className="rounded p-1.5 text-app-text-muted hover:bg-app-surface-2 hover:text-app-text disabled:opacity-35"
          title="Copy browser URL"
        >
          <Clipboard className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={openCurrentUrlExternal}
          disabled={!state.url || state.url === 'about:blank'}
          className="rounded p-1.5 text-app-text-muted hover:bg-app-surface-2 hover:text-app-text disabled:opacity-35"
          title="Open browser URL externally"
        >
          <ExternalLink className="h-4 w-4" />
        </button>
        <div className="flex shrink-0 items-center rounded-md border border-app-border bg-app-bg p-0.5" title={`Viewport: ${viewportFrame.label}`}>
          {BROWSER_VIEWPORT_PROFILES.map((profile) => {
            const Icon = viewportModeIcon(profile.mode)
            const selected = profile.mode === viewportMode
            return (
              <button
                key={profile.mode}
                type="button"
                onClick={() => selectViewportMode(profile.mode)}
                className={`flex h-7 w-7 items-center justify-center rounded text-app-text-muted hover:bg-app-surface-2 hover:text-app-text ${selected ? 'bg-app-surface-2 text-app-text' : ''}`}
                title={profile.label}
                aria-label={`Use ${profile.label} viewport`}
              >
                <Icon className="h-3.5 w-3.5" />
              </button>
            )
          })}
        </div>
        <button
          type="button"
          onClick={captureScreenshot}
          className="rounded p-1.5 text-app-text-muted hover:bg-app-surface-2 hover:text-app-text"
          title="Capture screenshot"
        >
          <Camera className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={captureSnapshot}
          className="rounded p-1.5 text-app-text-muted hover:bg-app-surface-2 hover:text-app-text"
          title="Capture page text"
        >
          <FileText className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={toggleInspectMode}
          className={`rounded p-1.5 text-app-text-muted hover:bg-app-surface-2 hover:text-app-text ${inspectActive ? 'bg-app-surface-2 text-app-accent' : ''}`}
          title={inspectActive ? 'Stop inspecting' : 'Inspect page element'}
        >
          <Crosshair className="h-4 w-4" />
        </button>
      </div>
      {(notice || state.error) && (
        <div className={`border-b border-app-border px-3 py-1.5 text-xs ${state.error ? 'text-app-danger' : 'text-app-text-muted'}`}>
          {state.error ?? notice}
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
          </div>
          {active && viewportMode !== 'responsive' && (
            <div className="mx-auto mt-2 text-center text-micro text-app-text-muted" style={{ width: viewportFrame.width }}>
              {viewportFrame.label}
            </div>
          )}
        </div>
        {captureOpen && (
          <div className="grid max-h-72 shrink-0 grid-cols-[minmax(0,1fr)_minmax(0,1fr)] border-t border-app-border bg-app-surface">
            <div className="min-w-0 border-r border-app-border">
              <CaptureHeader icon={Camera} label={capture.screenshotSize ? `Screenshot ${capture.screenshotSize}` : 'Screenshot'}>
                <button
                  type="button"
                  onClick={sendScreenshotToChat}
                  disabled={!capture.screenshotDataUrl}
                  className="rounded p-1 text-app-text-muted hover:bg-app-surface-2 hover:text-app-text disabled:opacity-40"
                  title="Send screenshot to chat"
                >
                  <MessageSquare className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={copyScreenshotPath}
                  disabled={!capture.screenshotDataUrl}
                  className="rounded p-1 text-app-text-muted hover:bg-app-surface-2 hover:text-app-text disabled:opacity-40"
                  title="Copy screenshot path"
                >
                  <Clipboard className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={openScreenshot}
                  disabled={!capture.screenshotDataUrl}
                  className="rounded p-1 text-app-text-muted hover:bg-app-surface-2 hover:text-app-text disabled:opacity-40"
                  title="Open screenshot"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={revealScreenshot}
                  disabled={!capture.screenshotDataUrl}
                  className="rounded p-1 text-app-text-muted hover:bg-app-surface-2 hover:text-app-text disabled:opacity-40"
                  title="Reveal screenshot in Finder"
                >
                  <FolderOpen className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setCaptureOpen(false)}
                  className="rounded p-1 text-app-text-muted hover:bg-app-surface-2 hover:text-app-text"
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
            <div className="min-w-0">
              <CaptureHeader icon={inspection ? Crosshair : FileText} label={inspection ? inspection.selector || inspection.tagName : capture.snapshot ? capture.snapshot.title || 'Page snapshot' : 'Page snapshot'}>
                <button
                  type="button"
                  onClick={sendCaptureToChat}
                  disabled={inspection ? false : !capture.snapshot}
                  className="rounded p-1 text-app-text-muted hover:bg-app-surface-2 hover:text-app-text disabled:opacity-40"
                  title={inspection ? 'Send element context to chat' : 'Send page text to chat'}
                >
                  <MessageSquare className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={inspection ? copyInspection : copySnapshot}
                  disabled={inspection ? false : !capture.snapshot?.text}
                  className="rounded p-1 text-app-text-muted hover:bg-app-surface-2 hover:text-app-text disabled:opacity-40"
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
                      className="rounded p-1 text-app-text-muted hover:bg-app-surface-2 hover:text-app-text disabled:opacity-40"
                      title="Copy element selector"
                    >
                      <Crosshair className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={copyInspectionText}
                      disabled={!inspection.text.trim()}
                      className="rounded p-1 text-app-text-muted hover:bg-app-surface-2 hover:text-app-text disabled:opacity-40"
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
        <div className="mt-3 border-t border-app-border pt-2">
          <div className="mb-1 text-micro uppercase text-app-text-muted">Attributes</div>
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
    <div className="rounded border border-app-border bg-app-surface px-2 py-1.5">
      <div className="text-micro uppercase text-app-text-muted">{label}</div>
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
    <div className="flex h-9 items-center justify-between gap-2 border-b border-app-border px-3">
      <div className="flex min-w-0 items-center gap-2 text-xs font-medium">
        <Icon className="h-3.5 w-3.5 shrink-0 text-app-text-muted" />
        <span className="truncate" title={label}>{label}</span>
      </div>
      {children}
    </div>
  )
}
