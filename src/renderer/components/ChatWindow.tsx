import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  FolderOpen,
  Gauge,
  Goal,
  Hand,
  Loader2,
  Mic,
  Plus,
  Settings2,
  X,
} from 'lucide-react'
import { useCodex } from '../state/codex'
import { useWorkspace } from '../state/workspace'
import { useSettings } from '../state/settings'
import type { CodexApprovalMode, CodexMessage, CodexPluginInfo, CodexTurnSettings } from '@/shared/codex'
import { CODEX_MODELS, CODEX_EFFORTS, CODEX_APPROVAL_MODES } from '@/shared/codex'

type PopoverPosition = {
  top: number
  left: number
}

const MAIN_POPOVER_WIDTH = 208
const MODEL_SUBMENU_WIDTH = 208
const SPEED_SUBMENU_WIDTH = 176
const POPOVER_GAP = 6
const VIEWPORT_PADDING = 8

function formatCodexText(text: string) {
  const parts = text.split(/(`[^`]+`)/g)
  return parts.map((part, index) => {
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code
          key={index}
          className="rounded-md bg-[var(--app-surface-2)] px-1.5 py-0.5 font-mono text-[0.9em] text-[var(--app-text)]"
        >
          {part.slice(1, -1)}
        </code>
      )
    }
    return <span key={index}>{part}</span>
  })
}

function MessageActions({ text }: { text: string }) {
  return (
    <div className="mt-4 flex items-center gap-3 text-[var(--app-text-muted)]">
      <button
        type="button"
        onClick={() => navigator.clipboard.writeText(text).catch((error) => console.error('Failed to copy response:', error))}
        className="rounded p-0.5 hover:text-[var(--app-text)]"
        aria-label="Copy response"
      >
        <Copy className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

function ReasoningGroup({
  messages,
  expanded,
  onToggle,
  isRunning,
  activity,
  durationMs,
}: {
  messages: CodexMessage[]
  expanded: boolean
  onToggle: () => void
  isRunning: boolean
  activity?: string
  durationMs?: number
}) {
  if (messages.length === 0 && !isRunning) return null

  return (
    <div className="max-w-full text-[var(--app-text-muted)]">
      <button
        type="button"
        onClick={onToggle}
        className="mb-2 flex items-center gap-2 text-sm hover:text-[var(--app-text)]"
      >
        {isRunning ? (
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--app-text-muted)] opacity-40" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[var(--app-text-muted)]" />
          </span>
        ) : (
          <span className="h-2.5 w-2.5 rounded-full bg-[var(--app-text-muted)]" />
        )}
        <span>{isRunning ? (activity ?? 'Working') : `Worked${durationMs ? ` for ${Math.max(1, Math.round(durationMs / 1000))}s` : ''}`}</span>
        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button>
      {expanded && (
        <div className="space-y-5 border-l border-[var(--app-border)] pl-4">
          {messages.map((message) => (
            <TranscriptMessage key={message.id} msg={message} />
          ))}
        </div>
      )}
    </div>
  )
}

function TranscriptMessage({ msg }: { msg: CodexMessage }) {
  if (msg.role === 'system' || msg.role === 'reasoning') {
    return (
      <div className="max-w-full text-[15px] leading-7 text-[var(--app-text-muted)]">
        <div className="whitespace-pre-wrap">{formatCodexText(msg.content)}</div>
      </div>
    )
  }

  if (msg.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[76%] rounded-2xl bg-[var(--app-surface)] px-4 py-3 text-[15px] leading-6 text-[var(--app-text)] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04)]">
          <div className="whitespace-pre-wrap">{formatCodexText(msg.content)}</div>
        </div>
      </div>
    )
  }

  return (
    <article className="max-w-full text-[15px] leading-7 text-[var(--app-text)]">
      <div className="whitespace-pre-wrap">{formatCodexText(msg.content)}</div>
      <MessageActions text={msg.content} />
    </article>
  )
}

function ModelSelector({
  settings,
  onChange,
}: {
  settings: CodexTurnSettings
  onChange: (settings: CodexTurnSettings) => void
}) {
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
      window.clearTimeout(closeSubmenuTimerRef.current)
      closeSubmenuTimerRef.current = null
    }

    const row = nextSubmenu === 'model' ? modelRowRef.current : speedRowRef.current
    const rect = row?.getBoundingClientRect()
    if (!rect) return

    const width = nextSubmenu === 'model' ? MODEL_SUBMENU_WIDTH : SPEED_SUBMENU_WIDTH
    const rightSideLeft = rect.right + POPOVER_GAP
    const left =
      rightSideLeft + width + VIEWPORT_PADDING <= window.innerWidth
        ? rightSideLeft
        : Math.max(VIEWPORT_PADDING, rect.left - width - POPOVER_GAP)
    const top = Math.min(
      Math.max(VIEWPORT_PADDING, rect.top),
      window.innerHeight - VIEWPORT_PADDING - 176,
    )

    setSubmenu(nextSubmenu)
    setSubmenuPosition({ top, left })
  }

  const scheduleCloseSubmenu = () => {
    closeSubmenuTimerRef.current = window.setTimeout(() => {
      setSubmenu(null)
      setSubmenuPosition(null)
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
      setSubmenu(null)
      setSubmenuPosition(null)
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
      className="fixed z-[1000] w-52 -translate-y-full rounded-xl border border-[var(--app-border)] bg-[var(--app-surface)] p-1.5 text-sm text-[var(--app-text)] shadow-2xl shadow-black/40"
      style={{ top: mainPosition.top, left: mainPosition.left }}
    >
      <div className="px-1.5 pb-1.5 pt-1 text-xs text-[var(--app-text-muted)]">Reasoning</div>
      {CODEX_EFFORTS.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange({ ...settings, effort: option.value })}
          className="flex w-full items-center justify-between rounded-md px-1.5 py-1.5 text-left hover:bg-[var(--app-surface-2)]"
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
      className={`fixed z-[1001] rounded-xl border border-[var(--app-border)] bg-[var(--app-surface)] p-1.5 text-sm text-[var(--app-text)] shadow-2xl shadow-black/40 ${
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
              className="flex w-full items-center justify-between rounded-md px-1.5 py-1.5 text-left hover:bg-[var(--app-surface-2)]"
            >
              <span>{option.label}</span>
              {settings.model === option.value && <Check className="h-3.5 w-3.5 text-[var(--app-text)]" />}
            </button>
          ))}
        </>
      ) : (
        <>
          <div className="px-1.5 pb-1.5 pt-1 text-xs text-[var(--app-text-muted)]">Speed</div>
          <div className="px-1.5 py-1.5 text-[var(--app-text-muted)]">Default</div>
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
        className="flex items-center gap-1.5 rounded-full px-2 py-1 text-xs text-[var(--app-text)] hover:bg-[var(--app-surface-2)] hover:text-[var(--app-text)]"
      >
        <span>{selectedModel.label.replace('GPT-', '')}</span>
        <span>{selectedEffort.label}</span>
        <ChevronDown className="h-3 w-3 text-[var(--app-text-muted)]" />
      </button>

      {mainPopover && createPortal(mainPopover, document.body)}
      {submenuPopover && createPortal(submenuPopover, document.body)}
    </div>
  )
}

function ContextWindowIndicator({ usedTokens, contextWindow = 258400 }: { usedTokens: number; contextWindow?: number }) {
  const percentUsed = Math.min(100, Math.round((usedTokens / contextWindow) * 100))
  const percentLeft = Math.max(0, 100 - percentUsed)
  const compactUsed = `${Math.round(usedTokens / 1000)}k`
  const compactTotal = `${Math.round(contextWindow / 1000)}k`

  const fillDegrees = Math.round((percentUsed / 100) * 360)

  return (
    <div className="group relative flex h-5 w-5 items-center justify-center text-[var(--app-text-muted)]">
      <div
        className="flex h-3 w-3 items-center justify-center rounded-full"
        style={{
          background: percentUsed === 0
            ? 'transparent'
            : `conic-gradient(var(--app-text) ${fillDegrees}deg, rgba(127,135,148,0.35) ${fillDegrees}deg)`,
          boxShadow: percentUsed === 0 ? 'inset 0 0 0 2px rgba(127,135,148,0.35)' : 'none',
        }}
      >
        {percentUsed > 0 && <div className="h-1.5 w-1.5 rounded-full bg-[var(--app-surface)]" />}
      </div>
      <div className="pointer-events-none absolute bottom-6 left-1/2 z-[1200] w-[165px] -translate-x-1/2 rounded-lg border border-[var(--app-border)] bg-[var(--app-surface)] px-3 py-2 text-center text-sm text-[var(--app-text)] opacity-0 shadow-2xl shadow-black/50 transition-opacity group-hover:opacity-100">
        <div className="mb-1 text-xs text-[var(--app-text-muted)]">Context window:</div>
        <div>{percentUsed}% used ({percentLeft}% left)</div>
        <div>{compactUsed} / {compactTotal} tokens used</div>
      </div>
    </div>
  )
}

function ApprovalSelector({
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
        className="flex items-center gap-1.5 rounded-full px-2 py-1 text-xs text-[var(--app-text)] hover:bg-[var(--app-surface-2)] hover:text-[var(--app-text)]"
      >
        <Settings2 className="h-3.5 w-3.5" />
        {selected.value === 'custom' ? 'Custom' : selected.label}
        <ChevronDown className="h-3 w-3 text-[var(--app-text-muted)]" />
      </button>
      {open && createPortal(
        <div
          ref={menuRef}
          className="fixed z-[1200] -translate-y-full rounded-xl border border-[var(--app-border)] bg-[var(--app-surface)] p-2 text-sm text-[var(--app-text)] shadow-2xl shadow-black/50"
          style={{ top, left, width }}
        >
          <div className="flex items-center justify-between px-2 pb-2 text-xs text-[var(--app-text-muted)]">
            <span>How should Codex actions be approved?</span>
            <button type="button" className="underline decoration-[var(--app-text-muted)] underline-offset-2 hover:text-[var(--app-text)]">
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
              className="flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left hover:bg-[var(--app-surface-2)]"
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

function AddMenu({
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
        <div
          ref={menuRef}
          className="fixed z-[1200] max-h-[320px] -translate-y-full overflow-y-auto rounded-xl border border-[var(--app-border)] bg-[var(--app-surface)] p-2 text-sm text-[var(--app-text)] shadow-2xl shadow-black/50"
          style={{ top, left, width: menuWidth }}
        >
          <div className="px-2 pb-1 text-xs text-[var(--app-text-muted)]">Add</div>
          <button type="button" onClick={() => runAndClose(onAttachFiles)} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-[var(--app-surface-2)]">
            <FolderOpen className="h-4 w-4 text-[var(--app-text)]" />
            <span>Files and folders</span>
          </button>
          <button type="button" onClick={() => runAndClose(onGoal)} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-[var(--app-surface-2)]">
            <Goal className="h-4 w-4 text-[var(--app-text)]" />
            <span>Goal</span>
            <span className="text-[var(--app-text-muted)]">Set a goal that Codex will keep working towards</span>
          </button>
          <button type="button" onClick={() => runAndClose(onPlanMode)} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-[var(--app-surface-2)]">
            <Gauge className="h-4 w-4 text-[var(--app-text)]" />
            <span>Plan mode</span>
            <span className="text-[var(--app-text-muted)]">Turn plan mode on</span>
          </button>

          <div className="mt-1 px-2 pb-1 pt-2 text-xs text-[var(--app-text-muted)]">Plugins</div>
          {plugins.length === 0 && <div className="px-2 py-1.5 text-[var(--app-text-muted)]">No enabled Codex plugins found.</div>}
          {plugins.map((plugin) => (
            <button
              key={plugin.id}
              type="button"
              onClick={() => runAndClose(() => onPlugin(plugin))}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-[var(--app-surface-2)]"
              title={plugin.toolCount ? `${plugin.toolCount} live connector tools available` : plugin.id}
            >
              <span className="flex h-4 w-4 items-center justify-center text-xs text-[var(--app-accent)]">◆</span>
              <span className="shrink-0 whitespace-nowrap">{plugin.displayName}</span>
              <span className="min-w-0 flex-1 truncate text-[var(--app-text-muted)]">{plugin.description || plugin.prompt}</span>
              {plugin.toolCount > 0 && <span className="ml-auto shrink-0 text-[11px] text-[var(--app-text-muted)]">{plugin.toolCount} tools</span>}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  )
}

export function ChatWindow({ id }: { id: string }) {
  const {
    createThread,
    sendMessage,
    getThread,
    getThreadForWindow,
  } = useCodex()
  const { settings } = useSettings()
  const { renameWindow } = useWorkspace()
  const threadId = getThreadForWindow(id)
  const thread = threadId ? getThread(threadId) : undefined

  const [input, setInput] = useState('')
  const [turnSettings, setTurnSettings] = useState<CodexTurnSettings>(() => ({
    model: settings.codex.defaultModel,
    effort: settings.codex.defaultEffort,
    approvalMode: settings.codex.defaultApprovalMode,
  }))
  const [planMode, setPlanMode] = useState(false)
  const [goalMode, setGoalMode] = useState(false)
  const [attachments, setAttachments] = useState<string[]>([])
  const [commentaryExpanded, setCommentaryExpanded] = useState(true)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const composerRef = useRef<HTMLDivElement>(null)
  const composerHadFocusRef = useRef(false)
  const selectionRef = useRef({ start: 0, end: 0 })

  useEffect(() => {
    if (!threadId) {
      createThread(id).catch((err) => console.error('Failed to create Codex thread:', err))
    }
  }, [id, threadId, createThread])

  useEffect(() => {
    if (thread?.title) {
      renameWindow(id, thread.title)
    }
  }, [id, thread?.title, renameWindow])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [thread?.messages.length])

  useEffect(() => {
    if (thread?.isRunning) {
      setCommentaryExpanded(true)
      return
    }
    const hasFinalAnswer = thread?.messages.some((message) => message.role === 'assistant')
    if (hasFinalAnswer) setCommentaryExpanded(false)
  }, [thread?.isRunning, thread?.messages])

  const rememberSelection = () => {
    const textarea = textareaRef.current
    if (!textarea) return
    selectionRef.current = {
      start: textarea.selectionStart,
      end: textarea.selectionEnd,
    }
  }

  useLayoutEffect(() => {
    if (!composerHadFocusRef.current) return
    const textarea = textareaRef.current
    if (!textarea) return
    textarea.focus({ preventScroll: true })
    const start = Math.min(selectionRef.current.start, textarea.value.length)
    const end = Math.min(selectionRef.current.end, textarea.value.length)
    textarea.setSelectionRange(start, end)
  }, [thread?.messages.length, thread?.isRunning])

  const buildMessage = (text: string) => {
    const parts: string[] = []
    if (goalMode) parts.push('Create and run this as a Codex goal. Keep working until the goal is complete, and report progress only when you need a decision or finish.')
    if (planMode) parts.push('Plan mode: do not edit files yet. Inspect the repo, produce a concise implementation plan, risks, and verification steps, then wait for approval.')
    if (attachments.length > 0) parts.push(`Attached local paths:\n${attachments.map((filePath) => `- ${filePath}`).join('\n')}`)
    parts.push(text)
    return parts.join('\n\n')
  }

  const handleSend = async () => {
    const text = input.trim()
    if (!text || !threadId) return
    composerHadFocusRef.current = true
    setInput('')
    selectionRef.current = { start: 0, end: 0 }
    setAttachments([])
    try {
      await sendMessage(threadId, buildMessage(text), turnSettings)
    } finally {
      requestAnimationFrame(() => textareaRef.current?.focus({ preventScroll: true }))
    }
  }

  const attachFiles = async () => {
    const result = await window.cranberri.codex.pickFiles()
    if (result.paths.length > 0) setAttachments((current) => [...current, ...result.paths])
  }

  const usePlugin = (plugin: CodexPluginInfo) => {
    setInput(`Use the ${plugin.displayName} plugin. ${plugin.prompt}`)
  }

  const isRunning = thread?.isRunning ?? false
  const estimatedTokens = Math.ceil((thread?.messages.reduce((total, message) => total + message.content.length, 0) ?? 0) / 4)
  const contextUsage = thread?.contextUsage ?? { usedTokens: estimatedTokens, contextWindow: 258400 }
  const renderTranscript = () => {
    const nodes: React.ReactNode[] = []
    let reasoningBuffer: CodexMessage[] = []
    let renderedReasoningGroup = false

    const flushReasoning = () => {
      if (reasoningBuffer.length === 0) return
      renderedReasoningGroup = true
      const group = reasoningBuffer
      reasoningBuffer = []
      nodes.push(
        <ReasoningGroup
          key={`reasoning-${group[0].id}`}
          messages={group}
          expanded={commentaryExpanded}
          onToggle={() => setCommentaryExpanded((value) => !value)}
          isRunning={isRunning}
          activity={thread?.currentActivity}
          durationMs={thread?.lastRunDurationMs}
        />,
      )
    }

    thread?.messages.forEach((message) => {
      if (message.role === 'reasoning' || message.role === 'system') {
        reasoningBuffer.push(message)
        return
      }
      flushReasoning()
      nodes.push(<TranscriptMessage key={message.id} msg={message} />)
    })
    flushReasoning()

    if (isRunning && !renderedReasoningGroup) {
      nodes.push(
        <ReasoningGroup
          key="working"
          messages={[]}
          expanded={commentaryExpanded}
          onToggle={() => setCommentaryExpanded((value) => !value)}
          isRunning={isRunning}
          activity={thread?.currentActivity}
          durationMs={thread?.lastRunDurationMs}
        />,
      )
    }

    return nodes
  }

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-app-bg text-app-text">
      <div className="relative flex-1 overflow-hidden">
        <div className="h-full overflow-y-auto px-6 pb-36 pt-8">
          <div className="mx-auto flex min-h-full w-full max-w-[760px] flex-col justify-end gap-7">
            {!thread && (
              <div className="text-sm text-[var(--app-text-muted)]">Starting Codex thread...</div>
            )}
            {thread?.messages.length === 0 && (
              <div className="pt-16 text-center text-sm text-[var(--app-text-muted)]">
                Ask Codex to inspect, edit, or explain this repo.
              </div>
            )}
            {renderTranscript()}
            {thread?.pendingApprovals.map((approval) => (
              <div key={approval.id} className="rounded-xl border border-[var(--app-border)] bg-[var(--app-surface)] p-4 text-sm text-[var(--app-text)]">
                <div className="mb-1 font-medium">Approval needed: {approval.tool}</div>
                <div className="mb-3 text-[var(--app-text)]">{approval.description}</div>
                <div className="flex gap-2">
                  <button
                    onClick={() => threadId && sendMessage(threadId, 'yes')}
                    className="flex items-center gap-1 rounded-md bg-[var(--app-text)] px-2 py-1 text-xs text-[var(--app-bg)]"
                  >
                    <Check className="h-3 w-3" /> Approve
                  </button>
                  <button
                    onClick={() => threadId && sendMessage(threadId, 'no')}
                    className="flex items-center gap-1 rounded-md bg-[var(--app-surface-2)] px-2 py-1 text-xs text-[var(--app-text)]"
                  >
                    <X className="h-3 w-3" /> Deny
                  </button>
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
        </div>

        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[900] bg-gradient-to-t from-[var(--app-bg)] via-[var(--app-bg)]/95 to-transparent px-6 pb-4 pt-16">
          <div
            ref={composerRef}
            data-chat-composer="true"
            onFocusCapture={() => {
              composerHadFocusRef.current = true
            }}
            onBlurCapture={(event) => {
              const nextTarget = event.relatedTarget as Node | null
              if (nextTarget && composerRef.current?.contains(nextTarget)) return
              composerHadFocusRef.current = false
            }}
            className="pointer-events-auto mx-auto w-full max-w-[760px] rounded-3xl border border-[var(--app-border)] bg-[var(--app-surface)] p-3 shadow-2xl shadow-black/30"
          >
            {attachments.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-1.5 px-1">
                {attachments.map((filePath) => (
                  <button
                    key={filePath}
                    type="button"
                    onClick={() => setAttachments((current) => current.filter((item) => item !== filePath))}
                    className="rounded-full bg-[var(--app-surface-2)] px-2 py-0.5 text-[11px] text-[var(--app-text)] hover:bg-[var(--app-border)]"
                    title="Click to remove"
                  >
                    {filePath.split('/').pop() || filePath} ×
                  </button>
                ))}
              </div>
            )}
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => {
                setInput(e.target.value)
                requestAnimationFrame(rememberSelection)
              }}
              onSelect={rememberSelection}
              onKeyUp={rememberSelection}
              onMouseUp={rememberSelection}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  handleSend()
                }
              }}
              placeholder={isRunning ? 'Keep typing while Codex works...' : goalMode ? 'Describe your goal, define measurable outcomes for best results' : 'Ask for follow-up changes'}
              rows={2}
              className="max-h-32 min-h-[44px] w-full resize-none bg-transparent px-1 text-[15px] leading-6 text-[var(--app-text)] outline-none placeholder:text-[var(--app-text-muted)]"
            />
            <div className="flex items-center justify-between pt-2 text-[var(--app-text-muted)]">
              <div className="flex items-center gap-3">
                <AddMenu
                  onAttachFiles={attachFiles}
                  onGoal={() => setGoalMode((value) => !value)}
                  onPlanMode={() => setPlanMode((value) => !value)}
                  onPlugin={usePlugin}
                />
                <ApprovalSelector
                  value={turnSettings.approvalMode ?? 'custom'}
                  onChange={(approvalMode) => setTurnSettings((current) => ({ ...current, approvalMode }))}
                />
                {goalMode && (
                  <>
                    <div className="h-4 w-px bg-[var(--app-border)]" />
                    <button
                      type="button"
                      onClick={() => setGoalMode(false)}
                      className="group flex items-center gap-1.5 rounded px-1.5 py-1 text-xs text-[var(--app-text)] hover:bg-[var(--app-surface-2)] hover:text-[var(--app-text)]"
                      title="Remove goal"
                    >
                      <Goal className="h-3.5 w-3.5" />
                      <span>Goal</span>
                      <X className="hidden h-3 w-3 text-[var(--app-text-muted)] group-hover:block" />
                    </button>
                  </>
                )}
              </div>
              <div className="flex items-center gap-3">
                <ContextWindowIndicator usedTokens={contextUsage.usedTokens} contextWindow={contextUsage.contextWindow} />
                <ModelSelector settings={turnSettings} onChange={setTurnSettings} />
                <Mic className="h-4 w-4" />
                <button
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={handleSend}
                  disabled={isRunning || !input.trim()}
                  className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--app-text)] text-[var(--app-bg)] transition hover:bg-[var(--app-text)] disabled:opacity-40"
                  aria-label="Send message"
                >
                  {isRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
