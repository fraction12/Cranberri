import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown, ChevronRight, Zap } from 'lucide-react'
import type { CodexTurnSettings } from '@/shared/codex'
import { CODEX_EFFORTS, CODEX_MODELS, CODEX_SPEEDS } from '@/shared/codex'

type PopoverPosition = { top: number; left: number }
type ModelSelectorProps = { settings: CodexTurnSettings; onChange: (settings: CodexTurnSettings) => void }

const MAIN_POPOVER_WIDTH = 208, MODEL_SUBMENU_WIDTH = 208, SPEED_SUBMENU_WIDTH = 176, POPOVER_GAP = 6, VIEWPORT_PADDING = 8
const POPOVER_SHELL = 'rounded-xl border border-[var(--app-border)] bg-[var(--app-surface)] text-xs text-[var(--app-text)] shadow-2xl shadow-black/40'
const ROW_CLASS = 'flex w-full items-center justify-between rounded-md px-1.5 py-1.5 text-left hover:bg-[var(--app-surface-2)]'
const TRIGGER_CLASS = 'flex items-center gap-1.5 rounded-full px-2 py-1 text-xs text-[var(--app-text)] hover:bg-[var(--app-surface-2)] hover:text-[var(--app-text)]'

export function ModelSelector({ settings, onChange }: ModelSelectorProps) {
  const [open, setOpen] = useState(false)
  const [submenu, setSubmenu] = useState<'model' | 'speed' | null>(null)
  const [mainPosition, setMainPosition] = useState<PopoverPosition | null>(null)
  const [submenuPosition, setSubmenuPosition] = useState<PopoverPosition | null>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const modelRowRef = useRef<HTMLButtonElement>(null)
  const speedRowRef = useRef<HTMLButtonElement>(null)
  const closeSubmenuTimerRef = useRef<number | null>(null)
  const selectedModel = CODEX_MODELS.find((option) => option.value === settings.model) ?? CODEX_MODELS[0]
  const selectedEffort = CODEX_EFFORTS.find((option) => option.value === settings.effort) ?? CODEX_EFFORTS[2]
  const selectedSpeed = CODEX_SPEEDS.find((option) => option.value === settings.speed) ?? CODEX_SPEEDS[0]

  const updateMainPosition = () => {
    const rect = buttonRef.current?.getBoundingClientRect()
    if (!rect) return

    const left = Math.min(
      Math.max(VIEWPORT_PADDING, rect.right - MAIN_POPOVER_WIDTH),
      window.innerWidth - MAIN_POPOVER_WIDTH - VIEWPORT_PADDING,
    )
    const top = Math.max(VIEWPORT_PADDING, rect.top - POPOVER_GAP)
    setMainPosition({ top, left })
  }

  const openSubmenu = (nextSubmenu: 'model' | 'speed') => {
    if (closeSubmenuTimerRef.current) {
      window.clearTimeout(closeSubmenuTimerRef.current); closeSubmenuTimerRef.current = null
    }

    if (!mainPosition) return
    const row = nextSubmenu === 'model' ? modelRowRef.current : speedRowRef.current
    const rect = row?.getBoundingClientRect()
    if (!rect) return

    const width = nextSubmenu === 'model' ? MODEL_SUBMENU_WIDTH : SPEED_SUBMENU_WIDTH
    const baseLeft = mainPosition.left
    const rightSideLeft = baseLeft + MAIN_POPOVER_WIDTH + POPOVER_GAP
    const left =
      rightSideLeft + width + VIEWPORT_PADDING <= window.innerWidth
        ? rightSideLeft
        : Math.max(VIEWPORT_PADDING, baseLeft - width - POPOVER_GAP)
    const top = Math.min(
      Math.max(VIEWPORT_PADDING, rect.top),
      window.innerHeight - VIEWPORT_PADDING - 176,
    )

    setSubmenu(nextSubmenu)
    setSubmenuPosition({ top, left })
  }

  const scheduleCloseSubmenu = () => {
    closeSubmenuTimerRef.current = window.setTimeout(() => {
      setSubmenu(null); setSubmenuPosition(null)
    }, 80)
  }

  useLayoutEffect(() => {
    if (!open) return
    updateMainPosition()
  }, [open])

  useEffect(() => {
    if (!open) return undefined

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (buttonRef.current?.contains(target)) return
      const path = event.composedPath()
      if (path.some((node) => node instanceof HTMLElement && node.dataset.modelSelectorPopover === 'true')) return
      setOpen(false)
      setSubmenu(null)
    }
    const onWindowChange = () => {
      updateMainPosition()
      setSubmenu(null); setSubmenuPosition(null)
    }

    document.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('resize', onWindowChange)
    window.addEventListener('scroll', onWindowChange, true)

    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('resize', onWindowChange)
      window.removeEventListener('scroll', onWindowChange, true)
    }
  }, [open])

  useEffect(() => {
    return () => {
      if (closeSubmenuTimerRef.current) window.clearTimeout(closeSubmenuTimerRef.current)
    }
  }, [])

  const mainPopover = open && mainPosition ? (
    <div
      data-model-selector-popover="true"
      className={`fixed z-[1000] w-52 -translate-y-full p-1.5 ${POPOVER_SHELL}`}
      style={{ top: mainPosition.top, left: mainPosition.left }}
    >
      <div className="px-1.5 pb-1.5 pt-1 text-xs text-[var(--app-text-muted)]">Reasoning</div>
      {CODEX_EFFORTS.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange({ ...settings, effort: option.value })}
          className={ROW_CLASS}
        >
          <span>{option.label}</span>
          {settings.effort === option.value && <Check className="h-3.5 w-3.5 text-[var(--app-text)]" />}
        </button>
      ))}

      <div className="my-1 h-px bg-[var(--app-border)]" />

      <button
        ref={modelRowRef}
        type="button"
        onMouseEnter={() => openSubmenu('model')}
        onMouseLeave={scheduleCloseSubmenu}
        className={`flex w-full items-center justify-between rounded-md px-1.5 py-1.5 text-left ${
          submenu === 'model' ? 'bg-[var(--app-surface-2)]' : 'hover:bg-[var(--app-surface-2)]'
        }`}
      >
        <span>{selectedModel.label}</span>
        <ChevronRight className="h-3.5 w-3.5 text-[var(--app-text-muted)]" />
      </button>
      <button
        ref={speedRowRef}
        type="button"
        onMouseEnter={() => openSubmenu('speed')}
        onMouseLeave={scheduleCloseSubmenu}
        className={`flex w-full items-center justify-between rounded-md px-1.5 py-1.5 text-left ${
          submenu === 'speed' ? 'bg-[var(--app-surface-2)]' : 'hover:bg-[var(--app-surface-2)]'
        }`}
      >
        <span>Speed</span>
        <ChevronRight className="h-3.5 w-3.5 text-[var(--app-text-muted)]" />
      </button>
    </div>
  ) : null

  const submenuPopover = submenu && submenuPosition ? (
    <div
      data-model-selector-popover="true"
      onMouseEnter={() => {
        if (closeSubmenuTimerRef.current) window.clearTimeout(closeSubmenuTimerRef.current)
      }}
      onMouseLeave={scheduleCloseSubmenu}
      className={`fixed z-[1001] p-1.5 ${POPOVER_SHELL} ${
        submenu === 'model' ? 'w-52' : 'w-44'
      }`}
      style={{ top: submenuPosition.top, left: submenuPosition.left }}
    >
      {submenu === 'model' ? (
        <>
          <div className="px-1.5 pb-1.5 pt-1 text-xs text-[var(--app-text-muted)]">Model</div>
          {CODEX_MODELS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => {
                onChange({ ...settings, model: option.value })
                setOpen(false)
                setSubmenu(null)
              }}
              className={ROW_CLASS}
            >
              <span>{option.label}</span>
              {settings.model === option.value && <Check className="h-3.5 w-3.5 text-[var(--app-text)]" />}
            </button>
          ))}
        </>
      ) : (
        <>
          <div className="px-1.5 pb-1.5 pt-1 text-xs text-[var(--app-text-muted)]">Speed</div>
          {CODEX_SPEEDS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => {
                onChange({ ...settings, speed: option.value })
                setOpen(false)
                setSubmenu(null)
              }}
              className={ROW_CLASS}
            >
              <div className="flex flex-col items-start">
                <span className="flex items-center gap-2">
                  {option.value === 'fast' && <Zap className="h-3.5 w-3.5" />}
                  {option.label}
                </span>
                <span className="text-xs text-[var(--app-text-muted)]">{option.description}</span>
              </div>
              {settings.speed === option.value && <Check className="h-3.5 w-3.5 text-[var(--app-text)]" />}
            </button>
          ))}
        </>
      )}
    </div>
  ) : null

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => {
          setOpen((value) => !value)
          setSubmenu(null)
        }}
        className={TRIGGER_CLASS}
      >
        <span>{selectedModel.label.replace('GPT-', '')}</span>
        <span>{selectedEffort.label}</span>
        <span className="text-[var(--app-text-muted)]">·</span>
        <span>{selectedSpeed.label}</span>
        <ChevronDown className="h-3 w-3 text-[var(--app-text-muted)]" />
      </button>

      {mainPopover && createPortal(mainPopover, document.body)}
      {submenuPopover && createPortal(submenuPopover, document.body)}
    </div>
  )
}
