import { lazy, memo, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { RepoRail } from './components/RepoRail'
import { Workspace } from './components/Workspace'
import { RightRail } from './components/RightRail'
import { Header } from './components/Header'
import { AppStateProvider } from './state/appState'
import type { SettingsTabValue } from './components/SettingsDialog'
import { AppToaster } from './components/AppToaster'
import { UpdateResultToast } from './components/UpdateResultToast'
import { useRepoWatchInvalidation } from './state/search'
import { availableRailWidth, LEFT_RAIL_MIN_WIDTH, RAIL_RESIZER_WIDTH, railMaxWidth, RIGHT_RAIL_MIN_WIDTH } from './app-layout'

const SettingsDialog = lazy(() => import('./components/SettingsDialog').then((module) => ({ default: module.SettingsDialog })))
const CommandPalette = lazy(() => import('./components/CommandPalette').then((module) => ({ default: module.CommandPalette })))
const StableRepoRail = memo(RepoRail)
const StableWorkspace = memo(Workspace)
const StableRightRail = memo(RightRail)

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max))
}

interface RailResizeOptions {
  initialWidth: number
  widthAt: (clientX: number) => number
  onWidth: (width: number) => void
  onFinish: () => void
}

function beginRailResize({ initialWidth, widthAt, onWidth, onFinish }: RailResizeOptions): () => void {
  let frame: number | null = null
  let pendingWidth = initialWidth
  let disposed = false

  const onPointerMove = (event: PointerEvent) => {
    pendingWidth = widthAt(event.clientX)
    if (frame !== null) return
    frame = requestAnimationFrame(() => {
      frame = null
      if (!disposed) onWidth(pendingWidth)
    })
  }
  const cleanup = () => {
    if (disposed) return
    disposed = true
    if (frame !== null) cancelAnimationFrame(frame)
    document.body.classList.remove('rail-resizing')
    window.removeEventListener('pointermove', onPointerMove)
    window.removeEventListener('pointerup', finish)
    window.removeEventListener('pointercancel', finish)
    window.removeEventListener('blur', finish)
  }
  const finish = () => {
    if (disposed) return
    const finalWidth = pendingWidth
    cleanup()
    onWidth(finalWidth)
    onFinish()
  }

  document.body.classList.add('rail-resizing')
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', finish, { once: true })
  window.addEventListener('pointercancel', finish, { once: true })
  window.addEventListener('blur', finish, { once: true })
  return cleanup
}

function AppShell() {
  useRepoWatchInvalidation()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsTab, setSettingsTab] = useState<SettingsTabValue>('general')
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false)
  const [leftRailWidth, setLeftRailWidth] = useState(LEFT_RAIL_MIN_WIDTH)
  const [rightRailWidth, setRightRailWidth] = useState(RIGHT_RAIL_MIN_WIDTH)
  const leftRailWidthRef = useRef(leftRailWidth)
  const rightRailWidthRef = useRef(rightRailWidth)
  const activeRailResizeCleanupRef = useRef<(() => void) | null>(null)
  const layoutRef = useRef<HTMLDivElement>(null)

  const updateLeftRailWidth = useCallback((width: number) => {
    leftRailWidthRef.current = width
    setLeftRailWidth(width)
  }, [])

  const updateRightRailWidth = useCallback((width: number) => {
    rightRailWidthRef.current = width
    setRightRailWidth(width)
  }, [])

  const startRailResize = useCallback((options: Omit<RailResizeOptions, 'onFinish'>) => {
    activeRailResizeCleanupRef.current?.()
    let cleanup: () => void = () => undefined
    cleanup = beginRailResize({
      ...options,
      onFinish: () => {
        if (activeRailResizeCleanupRef.current === cleanup) activeRailResizeCleanupRef.current = null
      },
    })
    activeRailResizeCleanupRef.current = cleanup
  }, [])

  const openSettings = useCallback((tab: SettingsTabValue = 'general') => {
    setSettingsTab(tab)
    setSettingsOpen(true)
  }, [])
  const openToolsSettings = useCallback(() => openSettings('tools'), [openSettings])

  const clampRailsToLayout = useCallback(() => {
    const layoutWidth = layoutRef.current?.clientWidth ?? window.innerWidth
    const availableForRails = availableRailWidth(layoutWidth)
    updateLeftRailWidth(clamp(
      leftRailWidthRef.current,
      LEFT_RAIL_MIN_WIDTH,
      railMaxWidth(availableForRails, rightRailWidthRef.current, LEFT_RAIL_MIN_WIDTH),
    ))
    updateRightRailWidth(clamp(
      rightRailWidthRef.current,
      RIGHT_RAIL_MIN_WIDTH,
      railMaxWidth(availableForRails, leftRailWidthRef.current, RIGHT_RAIL_MIN_WIDTH),
    ))
  }, [updateLeftRailWidth, updateRightRailWidth])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === ',') {
        event.preventDefault()
        openSettings()
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setCommandPaletteOpen((open) => !open)
      }
      if (event.key === 'Escape' && settingsOpen) {
        setSettingsOpen(false)
      }
      if (event.key === 'Escape' && commandPaletteOpen) {
        setCommandPaletteOpen(false)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [commandPaletteOpen, openSettings, settingsOpen])

  useEffect(() => {
    const onResize = () => clampRailsToLayout()
    clampRailsToLayout()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [clampRailsToLayout])

  useEffect(() => {
    const cleanupRef = activeRailResizeCleanupRef
    return () => cleanupRef.current?.()
  }, [])

  const startLeftResize = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    const pointerStart = event.clientX
    const widthStart = leftRailWidthRef.current
    const layoutWidth = layoutRef.current?.clientWidth ?? window.innerWidth
    const maxWidth = railMaxWidth(availableRailWidth(layoutWidth), rightRailWidthRef.current, LEFT_RAIL_MIN_WIDTH)
    startRailResize({
      initialWidth: widthStart,
      widthAt: (clientX) => clamp(widthStart + clientX - pointerStart, LEFT_RAIL_MIN_WIDTH, maxWidth),
      onWidth: updateLeftRailWidth,
    })
  }

  const startRightResize = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    const pointerStart = event.clientX
    const widthStart = rightRailWidthRef.current
    const layoutWidth = layoutRef.current?.clientWidth ?? window.innerWidth
    const maxWidth = railMaxWidth(availableRailWidth(layoutWidth), leftRailWidthRef.current, RIGHT_RAIL_MIN_WIDTH)
    startRailResize({
      initialWidth: widthStart,
      widthAt: (clientX) => clamp(widthStart + pointerStart - clientX, RIGHT_RAIL_MIN_WIDTH, maxWidth),
      onWidth: updateRightRailWidth,
    })
  }

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-app-bg text-app-text">
      <Header
        commandPaletteOpen={commandPaletteOpen}
        onOpenSettings={() => openSettings()}
        onOpenCommandPalette={() => setCommandPaletteOpen(true)}
      />
      <div ref={layoutRef} className="flex flex-1 min-h-0 w-full overflow-hidden">
        <div className="h-full shrink-0" style={{ width: leftRailWidth }}>
          <StableRepoRail />
        </div>
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize repo rail"
          className="group relative h-full shrink-0 cursor-col-resize bg-app-border/40 transition-colors hover:bg-app-border"
          style={{ width: RAIL_RESIZER_WIDTH }}
          onPointerDown={startLeftResize}
        >
          <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-app-border group-hover:bg-app-text-muted" />
        </div>
        <div className="flex-1 min-w-0 flex h-full min-h-0 overflow-hidden">
          <div className="flex-1 min-w-0 h-full overflow-hidden">
            <StableWorkspace browserSurfaceObscured={settingsOpen || commandPaletteOpen} />
          </div>
        </div>
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize files rail"
          className="group relative h-full shrink-0 cursor-col-resize bg-app-border/40 transition-colors hover:bg-app-border"
          style={{ width: RAIL_RESIZER_WIDTH }}
          onPointerDown={startRightResize}
        >
          <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-app-border group-hover:bg-app-text-muted" />
        </div>
        <div className="h-full overflow-hidden border-l border-app-border bg-app-surface shrink-0" style={{ width: rightRailWidth }}>
          <StableRightRail onOpenToolsSettings={openToolsSettings} />
        </div>
      </div>
      {settingsOpen && (
        <Suspense fallback={null}>
          <SettingsDialog open initialTab={settingsTab} onClose={() => setSettingsOpen(false)} />
        </Suspense>
      )}
      <Suspense fallback={null}>
        <CommandPalette
          open={commandPaletteOpen}
          onOpenChange={setCommandPaletteOpen}
          onOpenSettings={openSettings}
        />
      </Suspense>
      <UpdateResultToast />
      <AppToaster />
    </div>
  )
}

export function App() {
  return (
    <AppStateProvider>
      <AppShell />
    </AppStateProvider>
  )
}
