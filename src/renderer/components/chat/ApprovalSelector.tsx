import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown, Hand, Settings2 } from 'lucide-react'
import type { CodexApprovalMode } from '@/shared/codex'
import { CODEX_APPROVAL_MODES } from '@/shared/codex'

const TRIGGER_CLASS = 'flex items-center gap-1.5 rounded-full px-2 py-1 text-xs text-[var(--app-text)] hover:bg-[var(--app-surface-2)] hover:text-[var(--app-text)]'
const MENU_CLASS = 'fixed z-[1200] -translate-y-full rounded-xl border border-[var(--app-border)] bg-[var(--app-surface)] p-2 text-xs text-[var(--app-text)] shadow-2xl shadow-black/50'
const OPTION_CLASS = 'flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left hover:bg-[var(--app-surface-2)]'

export function ApprovalSelector({
  value,
  onChange,
}: {
  value: CodexApprovalMode
  onChange: (value: CodexApprovalMode) => void
}) {
  const [open, setOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const selected = CODEX_APPROVAL_MODES.find((option) => option.value === value) ?? CODEX_APPROVAL_MODES[3]

  useEffect(() => {
    if (!open) return undefined
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (buttonRef.current?.contains(target) || menuRef.current?.contains(target)) return
      setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  const rect = buttonRef.current?.getBoundingClientRect()
  const width = 452
  const left = rect ? Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)) : 12
  const top = rect ? Math.max(12, rect.top - 8) : 12

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((current) => !current)}
        className={TRIGGER_CLASS}
      >
        <Settings2 className="h-3.5 w-3.5" />
        {selected.value === 'custom' ? 'Custom' : selected.label}
        <ChevronDown className="h-3 w-3 text-[var(--app-text-muted)]" />
      </button>
      {open && createPortal(
        <div
          ref={menuRef}
          className={MENU_CLASS}
          style={{ top, left, width }}
        >
          <div className="flex items-center justify-between px-2 pb-2 text-xs text-[var(--app-text-muted)]">
            <span>How should Codex actions be approved?</span>
            <button
              type="button"
              className="underline decoration-[var(--app-text-muted)] underline-offset-2 hover:text-[var(--app-text)]"
            >
              Learn more
            </button>
          </div>
          {CODEX_APPROVAL_MODES.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => {
                onChange(option.value)
                setOpen(false)
              }}
              className={OPTION_CLASS}
            >
              <span className="flex h-5 w-5 shrink-0 items-center justify-center text-[var(--app-text)]">
                {option.value === 'ask' ? <Hand className="h-4 w-4" /> : <Settings2 className="h-4 w-4" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[var(--app-text)]">{option.label}</span>
                <span className="block truncate text-[var(--app-text-muted)]">{option.description}</span>
              </span>
              {value === option.value && <Check className="h-3.5 w-3.5 shrink-0 text-[var(--app-text)]" />}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  )
}
