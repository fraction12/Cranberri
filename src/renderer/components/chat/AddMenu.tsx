import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { FolderOpen, Gauge, Goal, Plus } from 'lucide-react'
import type { CodexPluginInfo } from '@/shared/codex'

const MENU_CLASS = [
  'fixed z-[1200] max-h-[320px] -translate-y-full overflow-y-auto rounded-xl',
  'border border-[var(--app-border)] bg-[var(--app-surface)] p-2',
  'text-xs text-[var(--app-text)] shadow-2xl shadow-black/50',
].join(' ')
const MENU_BUTTON_CLASS = 'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-[var(--app-surface-2)]'

export function AddMenu({
  onAttachFiles,
  onGoal,
  onPlanMode,
  onPlugin,
}: {
  onAttachFiles: () => void
  onGoal: () => void
  onPlanMode: () => void
  onPlugin: (plugin: CodexPluginInfo) => void
}) {
  const [open, setOpen] = useState(false)
  const [plugins, setPlugins] = useState<CodexPluginInfo[]>([])
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    window.cranberri.codex.plugins()
      .then((result) => setPlugins(result.plugins))
      .catch((err) => console.error('Failed to load Codex plugins:', err))
  }, [open])

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
  const composerRect = buttonRef.current?.closest('[data-chat-composer]')?.getBoundingClientRect()
  const menuWidth = Math.min(composerRect?.width ?? 735, window.innerWidth - 24)
  const left = composerRect
    ? Math.max(12, Math.min(composerRect.left, window.innerWidth - menuWidth - 12))
    : rect
      ? Math.max(12, Math.min(rect.left, window.innerWidth - menuWidth - 12))
      : 12
  const top = composerRect ? Math.max(12, composerRect.top - 8) : rect ? Math.max(12, rect.top - 14) : 12

  const runAndClose = (action: () => void) => {
    action()
    setOpen(false)
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="rounded p-1 hover:bg-[var(--app-surface-2)] hover:text-[var(--app-text)]"
        aria-label="Add context"
      >
        <Plus className="h-4 w-4" />
      </button>
      {open && createPortal(
        <div ref={menuRef} className={MENU_CLASS} style={{ top, left, width: menuWidth }}>
          <div className="px-2 pb-1 text-xs text-[var(--app-text-muted)]">Add</div>
          <button type="button" onClick={() => runAndClose(onAttachFiles)} className={MENU_BUTTON_CLASS}>
            <FolderOpen className="h-4 w-4 text-[var(--app-text)]" />
            <span>Files and folders</span>
          </button>
          <button type="button" onClick={() => runAndClose(onGoal)} className={MENU_BUTTON_CLASS}>
            <Goal className="h-4 w-4 text-[var(--app-text)]" />
            <span>Goal</span>
            <span className="text-[var(--app-text-muted)]">Set a goal that Codex will keep working towards</span>
          </button>
          <button type="button" onClick={() => runAndClose(onPlanMode)} className={MENU_BUTTON_CLASS}>
            <Gauge className="h-4 w-4 text-[var(--app-text)]" />
            <span>Plan mode</span>
            <span className="text-[var(--app-text-muted)]">Turn plan mode on</span>
          </button>

          <div className="mt-1 px-2 pb-1 pt-2 text-xs text-[var(--app-text-muted)]">Plugins</div>
          {plugins.length === 0 && (
            <div className="px-2 py-1.5 text-[var(--app-text-muted)]">No enabled Codex plugins found.</div>
          )}
          {plugins.map((plugin) => (
            <button
              key={plugin.id}
              type="button"
              onClick={() => runAndClose(() => onPlugin(plugin))}
              className={MENU_BUTTON_CLASS}
              title={plugin.toolCount ? `${plugin.toolCount} live connector tools available` : plugin.id}
            >
              <span className="flex h-4 w-4 items-center justify-center text-xs text-[var(--app-accent)]">◆</span>
              <span className="shrink-0 whitespace-nowrap">{plugin.displayName}</span>
              <span className="min-w-0 flex-1 truncate text-[var(--app-text-muted)]">
                {plugin.description || plugin.prompt}
              </span>
              {plugin.toolCount > 0 && (
                <span className="ml-auto shrink-0 text-caption text-[var(--app-text-muted)]">
                  {plugin.toolCount} tools
                </span>
              )}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  )
}
