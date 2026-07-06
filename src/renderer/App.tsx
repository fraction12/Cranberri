import { useCallback, useEffect, useRef, useState } from 'react'
import { RepoRail } from './components/RepoRail'
import { Workspace } from './components/Workspace'
import { RightRail } from './components/RightRail'
import { Header } from './components/Header'
import { SettingsDialog } from './components/SettingsDialog'
import { AppStateProvider } from './state/appState'

const LEFT_RAIL_MIN_WIDTH = 256
const RIGHT_RAIL_MIN_WIDTH = 320
const RAIL_RESIZER_WIDTH = 7

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max))
}

export function App() {
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [leftRailWidth, setLeftRailWidth] = useState(LEFT_RAIL_MIN_WIDTH)
  const [rightRailWidth, setRightRailWidth] = useState(RIGHT_RAIL_MIN_WIDTH)
  const [centerMinWidth, setCenterMinWidth] = useState(0)
  const layoutRef = useRef<HTMLDivElement>(null)

  const measureCenterLimit = useCallback(() => {
    const layoutWidth = layoutRef.current?.clientWidth ?? window.innerWidth
    setCenterMinWidth((current) => current || Math.max(0, layoutWidth - LEFT_RAIL_MIN_WIDTH - RIGHT_RAIL_MIN_WIDTH - (RAIL_RESIZER_WIDTH * 2)))
  }, [])

  const clampRailsToLayout = useCallback(() => {
    const layoutWidth = layoutRef.current?.clientWidth ?? window.innerWidth
    const minimumCenter = centerMinWidth || Math.max(0, layoutWidth - LEFT_RAIL_MIN_WIDTH - RIGHT_RAIL_MIN_WIDTH - (RAIL_RESIZER_WIDTH * 2))
    const availableForRails = Math.max(LEFT_RAIL_MIN_WIDTH + RIGHT_RAIL_MIN_WIDTH, layoutWidth - minimumCenter - (RAIL_RESIZER_WIDTH * 2))

    setLeftRailWidth((currentLeft) => {
      const maxLeft = availableForRails - rightRailWidth
      return clamp(currentLeft, LEFT_RAIL_MIN_WIDTH, maxLeft)
    })
    setRightRailWidth((currentRight) => {
      const maxRight = availableForRails - leftRailWidth
      return clamp(currentRight, RIGHT_RAIL_MIN_WIDTH, maxRight)
    })
  }, [centerMinWidth, leftRailWidth, rightRailWidth])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === ',') {
        event.preventDefault()
        setSettingsOpen(true)
      }
      if (event.key === 'Escape' && settingsOpen) {
        setSettingsOpen(false)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [settingsOpen])

  useEffect(() => {
    measureCenterLimit()
    const onResize = () => clampRailsToLayout()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [clampRailsToLayout, measureCenterLimit])

  const startLeftResize = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    const pointerStart = event.clientX
    const widthStart = leftRailWidth
    const layoutWidth = layoutRef.current?.clientWidth ?? window.innerWidth
    const minimumCenter = centerMinWidth || Math.max(0, layoutWidth - LEFT_RAIL_MIN_WIDTH - RIGHT_RAIL_MIN_WIDTH - (RAIL_RESIZER_WIDTH * 2))
    const maxWidth = layoutWidth - rightRailWidth - minimumCenter - (RAIL_RESIZER_WIDTH * 2)

    const onPointerMove = (moveEvent: PointerEvent) => {
      setLeftRailWidth(clamp(widthStart + moveEvent.clientX - pointerStart, LEFT_RAIL_MIN_WIDTH, maxWidth))
    }
    const onPointerUp = () => {
      document.body.classList.remove('rail-resizing')
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
    }

    document.body.classList.add('rail-resizing')
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp, { once: true })
  }

  const startRightResize = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    const pointerStart = event.clientX
    const widthStart = rightRailWidth
    const layoutWidth = layoutRef.current?.clientWidth ?? window.innerWidth
    const minimumCenter = centerMinWidth || Math.max(0, layoutWidth - LEFT_RAIL_MIN_WIDTH - RIGHT_RAIL_MIN_WIDTH - (RAIL_RESIZER_WIDTH * 2))
    const maxWidth = layoutWidth - leftRailWidth - minimumCenter - (RAIL_RESIZER_WIDTH * 2)

    const onPointerMove = (moveEvent: PointerEvent) => {
      setRightRailWidth(clamp(widthStart + pointerStart - moveEvent.clientX, RIGHT_RAIL_MIN_WIDTH, maxWidth))
    }
    const onPointerUp = () => {
      document.body.classList.remove('rail-resizing')
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
    }

    document.body.classList.add('rail-resizing')
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp, { once: true })
  }

  return (
    <AppStateProvider>
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-app-bg text-app-text">
      <Header onOpenSettings={() => setSettingsOpen(true)} />
      <div ref={layoutRef} className="flex flex-1 min-h-0 w-full overflow-hidden">
        <div className="h-full shrink-0" style={{ width: leftRailWidth }}>
          <RepoRail />
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
            <Workspace />
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
          <RightRail />
        </div>
      </div>
      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
    </AppStateProvider>
  )
}