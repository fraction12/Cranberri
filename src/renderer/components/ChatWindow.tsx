import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import {
  ArrowUp,
  Check,
  ChevronDown,
  Copy,
  Goal,
  Loader2,
  Mic,
  Package,
  X,
} from 'lucide-react'
import { useCodex } from '../state/codex'
import { useWorkspace } from '../state/workspace'
import { useSettings } from '../state/settings'
import { AddMenu } from './chat/AddMenu'
import { ApprovalSelector } from './chat/ApprovalSelector'
import { ContextWindowIndicator } from './chat/ContextWindowIndicator'
import { ModelSelector } from './chat/ModelSelector'
import type { CodexMessage, CodexPluginInfo, CodexSkillInfo, CodexTurnSettings, CodexUserInput } from '@/shared/codex'

function getSkillTrigger(input: string, cursor: number): { char: '/' | '$'; start: number; query: string } | null {
  const beforeCursor = input.slice(0, cursor)
  const match = beforeCursor.match(/(^|\s)([/$])([^\s]*)$/)
  if (!match || (match[2] !== '/' && match[2] !== '$')) return null
  return {
    char: match[2],
    start: beforeCursor.length - match[2].length - match[3].length,
    query: match[3].toLowerCase(),
  }
}

const SKILL_INLINE_ICON = '📦'

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function skillToken(skill: CodexSkillInfo, trigger: '/' | '$'): string {
  const name = skill.name.startsWith('/') ? skill.name.slice(1) : skill.name
  return `${trigger}${name}`
}

function inlineSkillText(skill: CodexSkillInfo): string {
  return `${SKILL_INLINE_ICON} ${skill.displayName}`
}

function inputHasSkill(input: string, skill: CodexSkillInfo): boolean {
  return new RegExp(`(^|\\s)${escapeRegExp(inlineSkillText(skill))}(?=\\s|$)`).test(input)
}

function selectedSkillsFromInput(input: string, skills: CodexSkillInfo[]): CodexSkillInfo[] {
  return skills.filter((skill) => inputHasSkill(input, skill))
}

function skillTextElements(text: string, skills: CodexSkillInfo[]): NonNullable<Extract<CodexUserInput, { type: 'text' }>['text_elements']> {
  const encoder = new TextEncoder()
  return skills.flatMap((skill) => {
    const token = inlineSkillText(skill)
    const elements: NonNullable<Extract<CodexUserInput, { type: 'text' }>['text_elements']> = []
    let offset = text.indexOf(token)
    while (offset !== -1) {
      elements.push({
        byteRange: {
          start: encoder.encode(text.slice(0, offset)).length,
          end: encoder.encode(text.slice(0, offset + token.length)).length,
        },
        placeholder: token,
      })
      offset = text.indexOf(token, offset + token.length)
    }
    return elements
  })
}

function renderSkillText(text: string, skills: CodexSkillInfo[]): ReactNode[] {
  const selectedSkills = selectedSkillsFromInput(text, skills)
  if (selectedSkills.length === 0) return formatCodexText(text)

  const pattern = new RegExp(`(${selectedSkills.map((skill) => escapeRegExp(inlineSkillText(skill))).join('|')})`, 'g')
  return text.split(pattern).map((part, index) => {
    const skill = selectedSkills.find((item) => inlineSkillText(item) === part)
    if (!skill) return <span key={index}>{formatCodexText(part)}</span>
    return (
      <span key={index} className="inline text-[#ff8f8f] underline decoration-[#ff8f8f]/70 underline-offset-2">
        {inlineSkillText(skill)}
      </span>
    )
  })
}

function renderComposerText(input: string, skills: CodexSkillInfo[]): ReactNode[] {
  return renderSkillText(input, skills)
}

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
  runStartedAt,
}: {
  messages: CodexMessage[]
  expanded: boolean
  onToggle: () => void
  isRunning: boolean
  activity?: string
  durationMs?: number
  runStartedAt?: number
}) {
  const [elapsedMs, setElapsedMs] = useState(0)
  const displayedDurationMs = isRunning ? elapsedMs : (durationMs ?? 0)

  useEffect(() => {
    if (!isRunning) return undefined
    const start = runStartedAt ?? Date.now()
    setElapsedMs(Date.now() - start)
    const id = window.setInterval(() => setElapsedMs(Date.now() - start), 1000)
    return () => window.clearInterval(id)
  }, [isRunning, runStartedAt])

  if (messages.length === 0 && !isRunning) return null

  const seconds = Math.max(1, Math.round(displayedDurationMs / 1000))

  return (
    <div className="max-w-full text-[var(--app-text-muted)]">
      <button
        type="button"
        onClick={onToggle}
        className="mb-2 flex items-center gap-2 text-xs hover:text-[var(--app-text)]"
      >
        {isRunning ? (
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--app-text-muted)] opacity-40" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[var(--app-text-muted)]" />
          </span>
        ) : (
          <span className="h-2.5 w-2.5 rounded-full bg-[var(--app-text-muted)]" />
        )}
        <span>{isRunning ? `${activity ?? 'Working'} · ${seconds}s` : `Worked${durationMs ? ` for ${seconds}s` : ''}`}</span>
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

function TranscriptMessage({ msg, skills = [] }: { msg: CodexMessage; skills?: CodexSkillInfo[] }) {
  if (msg.role === 'system' || msg.role === 'reasoning') {
    return (
      <div className="max-w-full text-[13px] leading-5 text-[var(--app-text-muted)]">
        <div className="whitespace-pre-wrap">{formatCodexText(msg.content)}</div>
      </div>
    )
  }

  if (msg.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[76%] rounded-2xl bg-[var(--app-surface)] px-2.5 py-1.5 text-[13px] leading-5 text-[var(--app-text)] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04)]">
          <div className="whitespace-pre-wrap">{renderSkillText(msg.content, skills)}</div>
        </div>
      </div>
    )
  }

  return (
    <article className="max-w-full text-[13px] leading-5 text-[var(--app-text)]">
      <div className="whitespace-pre-wrap">{formatCodexText(msg.content)}</div>
      <MessageActions text={msg.content} />
    </article>
  )
}

export function ChatWindow({ id }: { id: string }) {
  const {
    createThread,
    sendMessage,
    compactThread,
    approve,
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
    speed: settings.codex.defaultSpeed ?? 'standard',
    approvalMode: settings.codex.defaultApprovalMode,
  }))
  const [planMode, setPlanMode] = useState(false)
  const [goalMode, setGoalMode] = useState(false)
  const [attachments, setAttachments] = useState<string[]>([])
  const [skills, setSkills] = useState<CodexSkillInfo[]>([])
  const [skillIndex, setSkillIndex] = useState(0)
  const [expandedGroupIds, setExpandedGroupIds] = useState<Set<string>>(new Set())
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const composerRef = useRef<HTMLDivElement>(null)
  const composerHadFocusRef = useRef(false)
  const selectionRef = useRef({ start: 0, end: 0 })
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const shouldScrollToBottomRef = useRef(true)

  useEffect(() => {
    window.cranberri.codex.skills()
      .then((result) => setSkills(result.skills))
      .catch((err) => console.error('Failed to load Codex skills:', err))
  }, [])

  useEffect(() => {
    if (!threadId) {
      createThread(id, undefined, turnSettings).catch((err) => console.error('Failed to create Codex thread:', err))
    }
  }, [id, threadId, createThread, turnSettings])

  useEffect(() => {
    if (thread?.title) {
      renameWindow(id, thread.title)
    }
  }, [id, thread?.title, renameWindow])

  // Auto-collapse completed reasoning groups once a final answer arrives, but keep running groups expanded.
  useEffect(() => {
    if (thread?.isRunning) return
    const hasFinalAnswer = thread?.messages.some((message) => message.role === 'assistant')
    if (!hasFinalAnswer) return
    setExpandedGroupIds((prev) => {
      const next = new Set(prev)
      for (const key of next) {
        if (!key.startsWith('working')) next.delete(key)
      }
      return next
    })
  }, [thread?.isRunning, thread?.messages])

  // Pin the transcript to the bottom while streaming, and keep it there whenever
  // the user is already close to the bottom. Direct scrollTop assignment avoids
  // scrollIntoView quirks that can leave the newest content above the fold.
  useLayoutEffect(() => {
    const container = scrollContainerRef.current
    if (!container) return
    if (!shouldScrollToBottomRef.current) return
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight
    const isNearBottom = distanceFromBottom <= 80
    if (thread?.isRunning || isNearBottom) {
      container.scrollTop = container.scrollHeight - container.clientHeight
    }
  }, [thread?.messages, thread?.pendingApprovals, thread?.isRunning])

  const handleScroll = useCallback(() => {
    const container = scrollContainerRef.current
    if (!container) return
    const threshold = 80
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight
    shouldScrollToBottomRef.current = distanceFromBottom <= threshold
  }, [])

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

  const buildMessage = (text: string): { displayText: string; input: CodexUserInput[] } => {
    const inputParts: CodexUserInput[] = []
    if (goalMode) inputParts.push({ type: 'text', text: 'Create and run this as a Codex goal. Keep working until the goal is complete, and report progress only when you need a decision or finish.' })
    if (planMode) inputParts.push({ type: 'text', text: 'Plan mode: do not edit files yet. Inspect the repo, produce a concise implementation plan, risks, and verification steps, then wait for approval.' })
    if (attachments.length > 0) inputParts.push({ type: 'text', text: `Attached local paths:\n${attachments.map((filePath) => `- ${filePath}`).join('\n')}` })

    const inlineSkills = selectedSkillsFromInput(text, skills)
    const textElements = skillTextElements(text, inlineSkills)
    inputParts.push({ type: 'text', text, ...(textElements.length > 0 ? { text_elements: textElements } : {}) })
    inputParts.push(...inlineSkills.map((skill) => ({ type: 'skill' as const, name: skill.name, path: skill.path })))

    return { displayText: text, input: inputParts }
  }

  const handleSend = async () => {
    const text = input.trim()
    if (!text || !threadId) return
    composerHadFocusRef.current = true
    setInput('')
    selectionRef.current = { start: 0, end: 0 }
    setAttachments([])

    try {
      if (text === '/compact') {
        await compactThread(threadId)
      } else {
        const message = buildMessage(text)
        await sendMessage(threadId, message.displayText, message.input, turnSettings)
      }
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
  const telemetryKey = thread
    ? `${thread.id}:${thread.isRunning}:${thread.currentActivity ?? ''}:${thread.messages.length}:${thread.messages.at(-1)?.id ?? ''}:${thread.messages.at(-1)?.role ?? ''}:${thread.messages.at(-1)?.content.length ?? 0}`
    : 'no-thread'
  const telemetrySnapshot = thread
    ? {
        windowId: id,
        threadId: thread.id,
        isRunning: thread.isRunning,
        currentActivity: thread.currentActivity,
        runStartedAt: thread.runStartedAt,
        lastRunDurationMs: thread.lastRunDurationMs,
        messageCount: thread.messages.length,
        messages: thread.messages.slice(-12).map((message) => ({
          id: message.id,
          role: message.role,
          length: message.content.length,
          preview: message.content.slice(0, 80),
          pending: message.pending,
        })),
      }
    : null
  const telemetrySnapshotRef = useRef(telemetrySnapshot)
  telemetrySnapshotRef.current = telemetrySnapshot

  useEffect(() => {
    const snapshot = telemetrySnapshotRef.current
    if (!snapshot) return
    window.cranberri.telemetry.log('renderer', 'chat-window:snapshot', snapshot).catch((err) => console.warn('Failed to write chat telemetry:', err))
  }, [telemetryKey])

  const estimatedTokens = Math.ceil((thread?.messages.reduce((total, message) => total + message.content.length, 0) ?? 0) / 4)
  const contextUsage = thread?.contextUsage ?? { usedTokens: estimatedTokens, contextWindow: 258400 }

  const skillTrigger = getSkillTrigger(input, selectionRef.current.start)
  const compactPercentFull = Math.min(100, Math.round((contextUsage.usedTokens / Math.max(1, contextUsage.contextWindow)) * 100))
  const compactCommand = skillTrigger?.char === '/' && 'compact'.includes(skillTrigger.query)
    ? [{ id: 'command:compact', label: 'Compact', description: `Compact this thread's context (${compactPercentFull}% full)` }]
    : []
  const matchingSkills = skillTrigger
    ? skills.filter((skill) => {
        const haystack = `${skill.name} ${skill.displayName} ${skill.description}`.toLowerCase()
        return haystack.includes(skillTrigger.query)
      })
    : []
  const showSkills = Boolean(skillTrigger && (compactCommand.length > 0 || matchingSkills.length > 0))
  const commandMenuCount = compactCommand.length + matchingSkills.length

  const insertCompactCommand = () => {
    if (!skillTrigger) return
    const cursor = selectionRef.current.start
    const token = '/compact'
    const nextInput = `${input.slice(0, skillTrigger.start)}${token} ${input.slice(cursor)}`
    const nextCursor = skillTrigger.start + token.length + 1
    setInput(nextInput)
    setSkillIndex(0)
    selectionRef.current = { start: nextCursor, end: nextCursor }
    requestAnimationFrame(() => {
      textareaRef.current?.focus({ preventScroll: true })
      textareaRef.current?.setSelectionRange(nextCursor, nextCursor)
    })
  }

  const insertSkill = (skill: CodexSkillInfo) => {
    if (!skillTrigger) return
    const cursor = selectionRef.current.start
    const token = inlineSkillText(skill)
    const nextInput = `${input.slice(0, skillTrigger.start)}${token} ${input.slice(cursor)}`
    const nextCursor = skillTrigger.start + token.length + 1
    setInput(nextInput)
    setSkillIndex(0)
    selectionRef.current = { start: nextCursor, end: nextCursor }
    requestAnimationFrame(() => {
      textareaRef.current?.focus({ preventScroll: true })
      textareaRef.current?.setSelectionRange(nextCursor, nextCursor)
    })
  }

  const renderTranscript = () => {
    const nodes: React.ReactNode[] = []
    let reasoningBuffer: CodexMessage[] = []
    let reasoningBufferStartIndex = -1
    let renderedRunningGroup = false
    const messages = thread?.messages ?? []
    const lastUserIndex = isRunning ? messages.map((message) => message.role).lastIndexOf('user') : -1

    const renderWorkingGroup = (key = 'working') => {
      renderedRunningGroup = true
      const expanded = expandedGroupIds.has(key) || isRunning
      nodes.push(
        <ReasoningGroup
          key={key}
          messages={[]}
          expanded={expanded}
          onToggle={() =>
            setExpandedGroupIds((prev) => {
              const next = new Set(prev)
              if (next.has(key)) next.delete(key)
              else next.add(key)
              return next
            })}
          isRunning={isRunning}
          activity={thread?.currentActivity}
          durationMs={thread?.lastRunDurationMs}
          runStartedAt={thread?.runStartedAt}
        />,
      )
    }

    const flushReasoning = () => {
      if (reasoningBuffer.length === 0) return
      const group = reasoningBuffer
      const groupIsRunning = isRunning && reasoningBufferStartIndex > lastUserIndex
      if (groupIsRunning) renderedRunningGroup = true
      reasoningBuffer = []
      reasoningBufferStartIndex = -1
      const key = `reasoning-${group[0].id}`
      const expanded = expandedGroupIds.has(key) || groupIsRunning
      nodes.push(
        <ReasoningGroup
          key={key}
          messages={group}
          expanded={expanded}
          onToggle={() =>
            setExpandedGroupIds((prev) => {
              const next = new Set(prev)
              if (next.has(key)) next.delete(key)
              else next.add(key)
              return next
            })}
          isRunning={groupIsRunning}
          activity={thread?.currentActivity}
          durationMs={thread?.lastRunDurationMs}
          runStartedAt={thread?.runStartedAt}
        />,
      )
    }

    const hasRunningReasoning = lastUserIndex !== -1 && messages
      .slice(lastUserIndex + 1)
      .some((message) => message.role === 'reasoning' || message.role === 'system')

    messages.forEach((message, index) => {
      if (message.role === 'reasoning' || message.role === 'system') {
        if (reasoningBuffer.length === 0) reasoningBufferStartIndex = index
        reasoningBuffer.push(message)
        return
      }
      flushReasoning()
      if (index === lastUserIndex && !renderedRunningGroup && !hasRunningReasoning) {
        nodes.push(<TranscriptMessage key={message.id} msg={message} skills={skills} />)
        renderWorkingGroup(`working-after-${message.id}`)
        return
      }
      if (message.role === 'compact') {
        const isPending = message.pending ?? false
        const [muted, bright] = isPending
          ? ['Compacting', '…']
          : message.content === 'Context compacted'
            ? ['', 'compacted']
            : ['', message.content]
        nodes.push(
          <div key={message.id} className="flex items-center gap-3 text-xs">
            <div className="h-px flex-1 bg-[var(--app-border)]" />
            <div className="flex items-center gap-2 text-[var(--app-text-muted)]">
              {isPending && (
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--app-text-muted)] opacity-40" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-[var(--app-text-muted)]" />
                </span>
              )}
              {!isPending && <span className="h-2 w-2 rounded-full bg-[var(--app-text-muted)]" />}
              {muted && <span>{muted}</span>}
              <span className="text-[var(--app-text)]">{bright}</span>
            </div>
            <div className="h-px flex-1 bg-[var(--app-border)]" />
          </div>,
        )
        return
      }
      nodes.push(<TranscriptMessage key={message.id} msg={message} skills={skills} />)
    })
    flushReasoning()

    if (isRunning && !renderedRunningGroup) {
      renderWorkingGroup()
    }

    return nodes
  }

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-app-bg text-app-text">
      <div className="relative flex-1 overflow-hidden">
        <div
          ref={scrollContainerRef}
          onScroll={handleScroll}
          className="h-full overflow-y-auto px-6 pb-36 pt-8"
        >
          <div className="mx-auto flex min-h-full w-full max-w-[760px] flex-col justify-end gap-5">
            {!thread && (
              <div className="text-xs text-[var(--app-text-muted)]">Starting Codex thread...</div>
            )}
            {thread?.messages.length === 0 && (
              <div className="pt-16 text-center text-xs text-[var(--app-text-muted)]">
                Ask Codex to inspect, edit, or explain this repo.
              </div>
            )}
            {renderTranscript()}
            {thread?.pendingApprovals.map((approval) => (
              <div key={approval.id} className="rounded-xl border border-[var(--app-border)] bg-[var(--app-surface)] p-4 text-xs text-[var(--app-text)]">
                <div className="mb-1 font-medium">Approval needed</div>
                <div className="mb-3 text-[var(--app-text)]">{approval.description}</div>
                <div className="flex gap-2">
                  <button
                    onClick={() => threadId && approve(threadId, approval.id, 'approve')}
                    className="flex items-center gap-1 rounded-md bg-[var(--app-text)] px-2 py-1 text-xs text-[var(--app-bg)]"
                  >
                    <Check className="h-3 w-3" /> Approve
                  </button>
                  <button
                    onClick={() => threadId && approve(threadId, approval.id, 'deny')}
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
            className="pointer-events-auto relative mx-auto w-full max-w-[760px] rounded-3xl border border-[var(--app-border)] bg-[var(--app-surface)] p-3 shadow-2xl shadow-black/30"
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
            {showSkills && (
              <div className="absolute inset-x-0 bottom-full mb-4 max-h-[420px] rounded-3xl border border-[var(--app-border)] bg-[var(--app-surface)] p-5 shadow-2xl shadow-black/40">
                <div className="mb-4 text-[13px] text-[var(--app-text-muted)]">Skills</div>
                <div className="max-h-[340px] space-y-1 overflow-y-auto pr-1">
                  {compactCommand.map((command, index) => (
                    <button
                      key={command.id}
                      type="button"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={insertCompactCommand}
                      className={`flex w-full items-center gap-3 rounded-lg px-1 py-1.5 text-left ${index === skillIndex ? 'bg-[var(--app-surface-2)]' : ''}`}
                    >
                      <ContextWindowIndicator usedTokens={contextUsage.usedTokens} contextWindow={contextUsage.contextWindow} />
                      <span className="min-w-0 flex-1 truncate text-[13px] leading-5">
                        <span className="text-[var(--app-text)]">{command.label}</span>
                        <span className="ml-3 text-[var(--app-text-muted)]">{command.description}</span>
                      </span>
                      <span className="shrink-0 text-[13px] text-[var(--app-text-muted)]">Command</span>
                    </button>
                  ))}
                  {matchingSkills.map((skill, index) => (
                    (() => {
                      const selected = inputHasSkill(input, skill)
                      return (
                        <button
                          key={skill.id}
                          type="button"
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => { if (!selected) insertSkill(skill) }}
                          disabled={selected}
                          className={`flex w-full items-center gap-3 rounded-lg px-1 py-1.5 text-left ${index + compactCommand.length === skillIndex ? 'bg-[var(--app-surface-2)]' : ''} ${selected ? 'cursor-default opacity-55' : ''}`}
                        >
                          <Package className={`h-4 w-4 shrink-0 ${selected ? 'text-[#ff8f8f]' : 'text-[var(--app-text)] opacity-80'}`} />
                          <span className="min-w-0 flex-1 truncate text-[13px] leading-5">
                            <span className={selected ? 'text-[#ff8f8f]' : 'text-[var(--app-text)]'}>{skillToken(skill, skillTrigger?.char ?? '/')}</span>
                            {skill.description && <span className="ml-3 text-[var(--app-text-muted)]">{skill.description}</span>}
                          </span>
                          {selected ? (
                            <span className="inline-flex shrink-0 items-center gap-1 text-[13px] text-[#ff8f8f]"><Check className="h-3.5 w-3.5" /> Selected</span>
                          ) : (
                            <span className="shrink-0 text-[13px] text-[var(--app-text-muted)]">{skill.source === 'plugin' ? (skill.pluginName ?? 'Plugin') : skill.source === 'personal' ? 'Personal' : 'System'}</span>
                          )}
                        </button>
                      )
                    })()
                  ))}
                </div>
              </div>
            )}
            <div className="relative min-h-[44px] px-1 text-[13px] leading-5">
              <div className="pointer-events-none absolute inset-x-1 top-0 whitespace-pre-wrap break-words text-[var(--app-text)]">
                {input ? renderComposerText(input, skills) : null}
              </div>
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
                if (e.key === 'Backspace' && e.currentTarget.selectionStart === e.currentTarget.selectionEnd) {
                  const cursor = e.currentTarget.selectionStart
                  const beforeCursor = input.slice(0, cursor)
                  const match = beforeCursor.match(/(^|\s)(\S(?:.*\S)?)\s?$/)
                  const matchedSkill = match ? skills.find((skill) => match[2] === inlineSkillText(skill) || match[2].endsWith(inlineSkillText(skill))) : undefined
                  if (match && matchedSkill) {
                    e.preventDefault()
                    const end = beforeCursor.endsWith(' ') ? cursor - 1 : cursor
                    const start = input.slice(0, end).lastIndexOf(inlineSkillText(matchedSkill))
                    const nextInput = `${input.slice(0, start)}${input.slice(cursor)}`
                    setInput(nextInput)
                    selectionRef.current = { start, end: start }
                    requestAnimationFrame(() => textareaRef.current?.setSelectionRange(start, start))
                    return
                  }
                }
                if (showSkills && commandMenuCount > 0) {
                  if (e.key === 'ArrowDown') {
                    e.preventDefault()
                    setSkillIndex((index) => (index + 1) % commandMenuCount)
                    return
                  }
                  if (e.key === 'ArrowUp') {
                    e.preventDefault()
                    setSkillIndex((index) => (index - 1 + commandMenuCount) % commandMenuCount)
                    return
                  }
                  if (e.key === 'Enter' || e.key === 'Tab') {
                    e.preventDefault()
                    if (skillIndex < compactCommand.length) {
                      insertCompactCommand()
                    } else {
                      insertSkill(matchingSkills[Math.min(skillIndex - compactCommand.length, matchingSkills.length - 1)])
                    }
                    return
                  }
                  if (e.key === 'Escape') {
                    e.preventDefault()
                    setSkillIndex(0)
                    selectionRef.current = { start: 0, end: 0 }
                    return
                  }
                }
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  handleSend()
                }
              }}
              placeholder={isRunning ? 'Keep typing while Codex works...' : goalMode ? 'Describe your goal, define measurable outcomes for best results' : 'Ask for follow-up changes'}
              rows={2}
              spellCheck={false}
              className="relative min-h-[24px] w-full resize-none bg-transparent px-0 text-[13px] leading-5 text-transparent caret-[var(--app-text)] outline-none placeholder:text-[var(--app-text-muted)]"
            />
            </div>
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
