import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent } from 'react'
import { toast } from 'sonner'
import {
  ArrowUp,
  Check,
  Image,
  Package,
  Square,
  X,
} from 'lucide-react'
import { useCodexActions, useCodexThreads, useCodexWindows } from '../state/codex'
import { useWorkspace } from '../state/workspace'
import { useSettings } from '../state/settings'
import { AddMenu } from './chat/AddMenu'
import { ApprovalSelector } from './chat/ApprovalSelector'
import { AttachmentChips } from './chat/AttachmentChips'
import { INSERT_CHAT_CONTEXT_EVENT, insertChatContextDetailFromEvent } from './chat/chat-context-events'
import {
  NEW_THREAD_EMPTY_STATE,
  sessionThreadIdFromWindowId,
  shouldRestoreDraftAfterSendError,
  shouldSendComposerOnEnter,
  shouldToastAfterSendError,
} from './chat/chat-window-state'
import {
  contextInputLabel,
  imageInputFromClipboardFile,
  isClipboardImageFile,
  isLocalImagePath,
  localAttachmentPathsFromTransferFiles,
  pastedAttachmentInputsFromText,
  visualInputPreview,
} from './chat/composer-attachments'
import {
  inlineSkillText,
  inputHasSkill,
  renderComposerText,
  selectedSkillsFromInput,
  skillTextElements,
} from './chat/composer-text'
import { ContextWindowIndicator } from './chat/ContextWindowIndicator'
import { GoalModePill } from './chat/GoalModePill'
import { ModelSelector } from './chat/ModelSelector'
import { TranscriptList } from './chat/TranscriptList'
import { composerBottomInset } from './chat/composer-layout'
import { VoiceDictationButton } from './chat/VoiceDictationButton'
import { PlanModePill } from './chat/PlanModePill'
import { buttonStyle, cn, menuSurface } from '../lib/ui'
import { typeStyle } from '../lib/typography'
import {
  appendDictationTranscript,
  speechRecognitionConstructor,
  transcriptFromSpeechRecognitionEvent,
  voiceDictationErrorMessage,
  type SpeechRecognitionLike,
} from './chat/voice-dictation'
import type { CodexPluginInfo, CodexSkillInfo, CodexTurnSettings, CodexUserInput } from '@/shared/codex'

export function getSkillTrigger(input: string, cursor: number): { char: '/' | '$'; start: number; query: string } | null {
  const beforeCursor = input.slice(0, cursor)
  const match = beforeCursor.match(/(^|\s)([/$])([^\s]*)$/)
  if (!match || (match[2] !== '/' && match[2] !== '$')) return null
  return {
    char: match[2],
    start: beforeCursor.length - match[2].length - match[3].length,
    query: match[3].toLowerCase(),
  }
}

const GOAL_PROMPT = [
  'Create and run this as a Codex goal.',
  'Keep working until the goal is complete, and report progress only when you need a decision or finish.',
].join(' ')
const PLAN_MODE_PROMPT = [
  'Plan mode: do not edit files yet.',
  'Inspect the repo, produce a concise implementation plan, risks, and verification steps, then wait for approval.',
].join(' ')
const COMPOSER_SCRIM_CLASS = [
  'pointer-events-none absolute inset-x-0 bottom-0 z-[900] bg-gradient-to-t',
  'from-[var(--app-bg)] via-[var(--app-bg)]/95 to-transparent px-4 pb-4 pt-14 sm:px-6',
].join(' ')
const COMPOSER_CARD_CLASS = [
  'pointer-events-auto relative mx-auto w-full max-w-[780px] rounded-[18px]',
  'bg-app-surface/95 p-3 shadow-xl ring-1 ring-app-border/75 transition-shadow duration-fast ease-standard focus-within:ring-2 focus-within:ring-app-accent/40',
].join(' ')
const COMPOSER_MIN_HEIGHT = 44
const COMPOSER_MAX_HEIGHT = 160
const TEXTAREA_CLASS = cn(
  typeStyle({ role: 'body' }),
  'relative z-10 block min-h-[44px] max-h-[160px] w-full resize-none overflow-y-hidden bg-transparent px-0',
  'text-transparent caret-[var(--app-text)] outline-none placeholder:text-[var(--app-text-muted)]',
)
const SKILL_MENU_CLASS = cn(
  menuSurface,
  'absolute inset-x-0 bottom-full mb-2 max-h-[min(420px,calc(100vh-24px))] overflow-hidden p-2',
)
const COMPOSER_GHOST_VIEWPORT_CLASS = cn(
  typeStyle({ role: 'body' }),
  'pointer-events-none absolute inset-0 overflow-hidden px-1',
)
const SEND_BUTTON_CLASS = [
  'flex h-8 w-8 items-center justify-center rounded-full bg-app-text text-app-bg',
  'transition-colors duration-fast ease-standard hover:bg-app-text/85 disabled:pointer-events-none disabled:opacity-35',
].join(' ')

interface ContextInputAttachment {
  id: string
  label: string
  input: CodexUserInput
}

function skillToken(skill: CodexSkillInfo, trigger: '/' | '$'): string {
  const name = skill.name.startsWith('/') ? skill.name.slice(1) : skill.name
  return `${trigger}${name}`
}

function contextInputAttachment(input: CodexUserInput): ContextInputAttachment {
  const id = `${input.type}-${Date.now()}-${Math.random().toString(36).slice(2)}`
  return { id, label: contextInputLabel(input), input }
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read pasted image'))
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result)
      } else {
        reject(new Error('Pasted image did not produce a data URL'))
      }
    }
    reader.readAsDataURL(file)
  })
}

export function ChatWindow({ id }: { id: string }) {
  const {
    createThread,
    sendMessage,
    compactThread,
    approve,
    abort,
    messageWorker,
    restoreSessionWindow,
    switchThread,
  } = useCodexActions()
  const { getThread } = useCodexThreads()
  const { getThreadForWindow } = useCodexWindows()
  const { settings } = useSettings()
  const { activeWindowId, renameWindow } = useWorkspace()
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
  const [contextInputParts, setContextInputParts] = useState<ContextInputAttachment[]>([])
  const [voiceListening, setVoiceListening] = useState(false)
  const [skills, setSkills] = useState<CodexSkillInfo[]>([])
  const [skillIndex, setSkillIndex] = useState(0)
  const [expandedGroupIds, setExpandedGroupIds] = useState<Set<string>>(new Set())
  const [composerInset, setComposerInset] = useState(188)
  const [resolvingApprovalId, setResolvingApprovalId] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const composerGhostTextRef = useRef<HTMLDivElement>(null)
  const composerRef = useRef<HTMLDivElement>(null)
  const composerHadFocusRef = useRef(false)
  const selectionRef = useRef({ start: 0, end: 0 })
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const shouldScrollToBottomRef = useRef(true)
  const speechRecognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const restoredSessionRef = useRef<string | null>(null)

  useEffect(() => {
    const persistedThreadId = sessionThreadIdFromWindowId(id)
    if (threadId || !persistedThreadId || restoredSessionRef.current === persistedThreadId) return
    restoredSessionRef.current = persistedThreadId
    let cancelled = false

    void restoreSessionWindow(id, persistedThreadId)
      .then((restored) => {
        if (!cancelled) renameWindow(id, restored.title)
      })
      .catch((error) => {
        restoredSessionRef.current = null
        console.error('Failed to restore Codex session window:', error)
      })

    return () => {
      cancelled = true
    }
  }, [id, renameWindow, restoreSessionWindow, threadId])

  useEffect(() => {
    if (activeWindowId === id) switchThread(threadId ?? null)
  }, [activeWindowId, id, switchThread, threadId])

  const scrollTranscriptToBottom = useCallback(() => {
    const container = scrollContainerRef.current
    if (!container) return
    container.scrollTop = Math.max(0, container.scrollHeight - container.clientHeight)
  }, [])

  const syncComposerScroll = useCallback(() => {
    const textarea = textareaRef.current
    const ghostText = composerGhostTextRef.current
    if (!textarea || !ghostText) return
    ghostText.style.transform = `translate(${-textarea.scrollLeft}px, ${-textarea.scrollTop}px)`
  }, [])

  useLayoutEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    textarea.style.height = '0px'
    const contentHeight = textarea.scrollHeight
    textarea.style.height = `${Math.min(COMPOSER_MAX_HEIGHT, Math.max(COMPOSER_MIN_HEIGHT, contentHeight))}px`
    textarea.style.overflowY = contentHeight > COMPOSER_MAX_HEIGHT ? 'auto' : 'hidden'
    syncComposerScroll()
    const frame = requestAnimationFrame(syncComposerScroll)
    return () => cancelAnimationFrame(frame)
  }, [input, syncComposerScroll])

  useEffect(() => {
    window.cranberri.codex.skills()
      .then((result) => setSkills(result.skills))
      .catch((err) => console.error('Failed to load Codex skills:', err))
  }, [])

  useEffect(() => () => {
    speechRecognitionRef.current?.abort?.()
    speechRecognitionRef.current = null
  }, [])

  useEffect(() => {
    const composer = composerRef.current
    if (!composer || typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(() => {
      setComposerInset(composerBottomInset(composer.getBoundingClientRect().height))
    })
    observer.observe(composer)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const onInsertChatContext = (event: Event) => {
      const detail = insertChatContextDetailFromEvent(event)
      if (!detail || detail.windowId !== id) return
      let nextLength = 0
      setInput((current) => {
        const nextInput = current.trim() ? `${current.trimEnd()}\n\n${detail.text}` : detail.text
        nextLength = nextInput.length
        return nextInput
      })
      const inputParts = detail.inputParts ?? []
      if (inputParts.length) {
        setContextInputParts((current) => [...current, ...inputParts.map(contextInputAttachment)])
      }
      const attachmentPaths = detail.attachmentPaths ?? []
      if (attachmentPaths.length) {
        setAttachments((current) => [...current, ...attachmentPaths.filter((filePath) => !current.includes(filePath))])
      }
      selectionRef.current = { start: nextLength, end: nextLength }
      composerHadFocusRef.current = true
      requestAnimationFrame(() => {
        textareaRef.current?.focus({ preventScroll: true })
        textareaRef.current?.setSelectionRange(nextLength, nextLength)
      })
    }
    window.addEventListener(INSERT_CHAT_CONTEXT_EVENT, onInsertChatContext)
    return () => window.removeEventListener(INSERT_CHAT_CONTEXT_EVENT, onInsertChatContext)
  }, [id])

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

  useLayoutEffect(() => {
    if (!threadId) return
    shouldScrollToBottomRef.current = true
    scrollTranscriptToBottom()
    const frame = requestAnimationFrame(scrollTranscriptToBottom)
    return () => cancelAnimationFrame(frame)
  }, [threadId, scrollTranscriptToBottom])

  // Pin the transcript to the bottom while streaming, and keep it there whenever
  // the user is already close to the bottom. Direct scrollTop assignment avoids
  // scrollIntoView quirks that can leave the newest content above the fold.
  useLayoutEffect(() => {
    const container = scrollContainerRef.current
    if (!container) return
    if (!shouldScrollToBottomRef.current) return
    scrollTranscriptToBottom()
  }, [composerInset, thread?.messages, thread?.pendingApprovals, thread?.isRunning, scrollTranscriptToBottom])

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

  const insertComposerText = (text: string) => {
    const textarea = textareaRef.current
    const start = textarea?.selectionStart ?? input.length
    const end = textarea?.selectionEnd ?? input.length
    const nextInput = `${input.slice(0, start)}${text}${input.slice(end)}`
    const cursor = start + text.length
    setInput(nextInput)
    selectionRef.current = { start: cursor, end: cursor }
    requestAnimationFrame(() => textareaRef.current?.setSelectionRange(cursor, cursor))
  }

  const addTransferInputs = (text: string, files: ArrayLike<File>): boolean => {
    const parsed = pastedAttachmentInputsFromText(text)
    const imageFiles = Array.from(files).filter(isClipboardImageFile)
    const localAttachmentPaths = [
      ...parsed.attachmentPaths,
      ...localAttachmentPathsFromTransferFiles(files),
    ]
    if (parsed.inputParts.length === 0 && imageFiles.length === 0 && localAttachmentPaths.length === 0) return false
    composerHadFocusRef.current = true
    if (parsed.inputParts.length > 0) {
      setContextInputParts((current) => [...current, ...parsed.inputParts.map(contextInputAttachment)])
    }
    if (localAttachmentPaths.length > 0) {
      setAttachments((current) => [...current, ...localAttachmentPaths.filter((filePath) => !current.includes(filePath))])
    }
    if (parsed.remainingText) insertComposerText(parsed.remainingText)
    if (imageFiles.length > 0) {
      Promise.all(imageFiles.map((file) => imageInputFromClipboardFile(file, (clipboardFile) => fileToDataUrl(clipboardFile as File))))
        .then((inputParts) => {
          const visualInputs = inputParts.filter((inputPart): inputPart is CodexUserInput => inputPart !== null)
          if (visualInputs.length > 0) {
            setContextInputParts((current) => [...current, ...visualInputs.map(contextInputAttachment)])
          }
        })
        .catch((err) => console.warn('Failed to read transferred image:', err))
    }

    return true
  }

  const handlePaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    if (addTransferInputs(event.clipboardData.getData('text/plain'), event.clipboardData.files)) {
      event.preventDefault()
    }
  }

  const handleDragOver = (event: DragEvent<HTMLTextAreaElement>) => {
    if (Array.from(event.dataTransfer.items).some((item) => item.kind === 'file')) {
      event.preventDefault()
      event.dataTransfer.dropEffect = 'copy'
    }
  }

  const handleDrop = (event: DragEvent<HTMLTextAreaElement>) => {
    if (addTransferInputs(event.dataTransfer.getData('text/plain'), event.dataTransfer.files)) {
      event.preventDefault()
      textareaRef.current?.focus({ preventScroll: true })
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
    if (goalMode) inputParts.push({ type: 'text', text: GOAL_PROMPT })
    else if (planMode) inputParts.push({ type: 'text', text: PLAN_MODE_PROMPT })
    if (attachments.length > 0) {
      inputParts.push({
        type: 'text',
        text: `Attached local paths:\n${attachments.map((filePath) => `- ${filePath}`).join('\n')}`,
      })
      inputParts.push(...attachments
        .filter(isLocalImagePath)
        .map((filePath) => ({ type: 'localImage' as const, path: filePath, detail: 'high' as const })))
    }
    inputParts.push(...contextInputParts.map((attachment) => attachment.input))

    const inlineSkills = selectedSkillsFromInput(text, skills)
    const textElements = skillTextElements(text, inlineSkills)
    if (text) inputParts.push({ type: 'text', text, ...(textElements.length > 0 ? { text_elements: textElements } : {}) })
    inputParts.push(...inlineSkills.map((skill) => ({ type: 'skill' as const, name: skill.name, path: skill.path })))

    return { displayText: text || 'Attached context', input: inputParts }
  }

  const handleSend = async () => {
    if (isRunning && !thread?.parentThreadId) return
    const text = input.trim()
    if (!text && attachments.length === 0 && contextInputParts.length === 0) return
    const draftInput = input
    const draftAttachments = attachments
    const draftContextInputParts = contextInputParts
    composerHadFocusRef.current = true
    setInput('')
    selectionRef.current = { start: 0, end: 0 }
    setAttachments([])
    setContextInputParts([])

    try {
      if (text === '/compact' && !thread?.parentThreadId) {
        if (!threadId) return
        await compactThread(threadId)
      } else {
        const message = buildMessage(text)
        if (threadId) {
          if (thread?.parentThreadId) {
            await messageWorker(thread.parentThreadId, threadId, message.displayText, message.input)
          } else {
            await sendMessage(threadId, message.displayText, message.input, turnSettings)
          }
        } else {
          await createThread(id, message.displayText, turnSettings, message.input)
        }
      }
    } catch (error) {
      if (thread?.parentThreadId || shouldRestoreDraftAfterSendError(threadId, error)) {
        setInput(draftInput)
        setAttachments(draftAttachments)
        setContextInputParts(draftContextInputParts)
      }
      if (thread?.parentThreadId || shouldToastAfterSendError(threadId, draftInput, error)) {
        toast.error(error instanceof Error ? error.message : 'Failed to send Codex message.')
      }
    } finally {
      requestAnimationFrame(() => textareaRef.current?.focus({ preventScroll: true }))
    }
  }

  const attachFiles = async () => {
    const result = await window.cranberri.codex.pickFiles()
    if (result.paths.length > 0) setAttachments((current) => [...current, ...result.paths])
  }

  const resolveApproval = async (approvalId: string, decision: 'approve' | 'deny') => {
    if (!threadId || resolvingApprovalId) return
    setResolvingApprovalId(approvalId)
    try {
      await approve(threadId, approvalId, decision)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not resolve the approval request.')
    } finally {
      setResolvingApprovalId(null)
    }
  }

  const appendVoiceTranscript = (transcript: string) => {
    let nextLength = 0
    composerHadFocusRef.current = true
    setInput((current) => {
      const nextInput = appendDictationTranscript(current, transcript)
      nextLength = nextInput.length
      return nextInput
    })
    selectionRef.current = { start: nextLength, end: nextLength }
    requestAnimationFrame(() => {
      textareaRef.current?.focus({ preventScroll: true })
      textareaRef.current?.setSelectionRange(nextLength, nextLength)
    })
  }

  const stopVoiceDictation = () => {
    speechRecognitionRef.current?.stop()
    speechRecognitionRef.current = null
    setVoiceListening(false)
  }

  const toggleVoiceDictation = () => {
    if (speechRecognitionRef.current) {
      stopVoiceDictation()
      return
    }

    const Recognition = speechRecognitionConstructor(window)
    if (!Recognition) {
      toast.error('Voice dictation is not available in this Electron build.')
      return
    }

    const recognition = new Recognition()
    recognition.continuous = true
    recognition.interimResults = false
    recognition.lang = navigator.language || 'en-US'
    recognition.onresult = (event) => {
      const transcript = transcriptFromSpeechRecognitionEvent(event)
      if (transcript) appendVoiceTranscript(transcript)
    }
    recognition.onerror = (event) => {
      speechRecognitionRef.current = null
      setVoiceListening(false)
      toast.error(voiceDictationErrorMessage(event))
    }
    recognition.onend = () => {
      speechRecognitionRef.current = null
      setVoiceListening(false)
    }

    try {
      recognition.start()
      speechRecognitionRef.current = recognition
      setVoiceListening(true)
      toast.success('Listening')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to start voice dictation.')
    }
  }

  const usePlugin = (plugin: CodexPluginInfo) => {
    setInput(`Use the ${plugin.displayName} plugin. ${plugin.prompt}`)
  }

  const isRunning = thread?.isRunning ?? false
  const isWorkerThread = Boolean(thread?.parentThreadId)
  const hasComposerContent = Boolean(input.trim() || attachments.length > 0 || contextInputParts.length > 0)
  const workerCanSend = isWorkerThread && hasComposerContent
  const primaryActionIsStop = isRunning && !workerCanSend
  const handlePrimaryAction = async () => {
    if (!primaryActionIsStop) {
      await handleSend()
      return
    }
    if (!threadId) return
    try {
      await abort(threadId)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to stop Codex.')
    }
  }
  const estimatedTokens = useMemo(
    () => Math.ceil((thread?.messages.reduce((total, message) => total + message.content.length, 0) ?? 0) / 4),
    [thread?.messages],
  )
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

  const toggleTranscriptGroup = useCallback((key: string) => {
    setExpandedGroupIds((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-app-bg text-app-text">
      <div className="relative flex-1 overflow-hidden">
        <div
          ref={scrollContainerRef}
          onScroll={handleScroll}
          data-chat-transcript-scroll="true"
          className="h-full overflow-y-auto px-5 pt-7 sm:px-6"
          style={{ paddingBottom: composerInset }}
        >
          <div className="mx-auto flex min-h-full w-full max-w-[780px] flex-col justify-end gap-5">
            {(!thread || thread.messages.length === 0) && !hasComposerContent && (
              <div className={cn(typeStyle({ role: 'metadata', tone: 'secondary' }), 'pt-16 text-center')}>
                {NEW_THREAD_EMPTY_STATE}
              </div>
            )}
            <TranscriptList
              thread={thread}
              skills={skills}
              expandedGroupIds={expandedGroupIds}
              onToggleGroup={toggleTranscriptGroup}
            />
            {thread?.pendingApprovals.map((approval) => (
              <div
                key={approval.id}
                className="rounded-lg bg-app-surface px-3.5 py-3 ring-1 ring-app-border/60"
              >
                <div className={typeStyle({ role: 'status', tone: 'warning' })}>Approval needed</div>
                <div className={cn(typeStyle({ role: 'body', tone: 'secondary' }), 'mb-3 mt-1')}>{approval.description}</div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => void resolveApproval(approval.id, 'approve')}
                    disabled={resolvingApprovalId !== null}
                    className={buttonStyle({ tone: 'primary', size: 'small' })}
                  >
                    <Check className="h-3 w-3" /> Approve
                  </button>
                  <button
                    type="button"
                    onClick={() => void resolveApproval(approval.id, 'deny')}
                    disabled={resolvingApprovalId !== null}
                    className={buttonStyle({ tone: 'secondary', size: 'small' })}
                  >
                    <X className="h-3 w-3" /> Deny
                  </button>
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} data-chat-transcript-end="true" />
          </div>
        </div>

        <div className={COMPOSER_SCRIM_CLASS}>
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
            className={COMPOSER_CARD_CLASS}
          >
            <AttachmentChips
              attachments={attachments}
              onRemove={(filePath) => setAttachments((current) => current.filter((item) => item !== filePath))}
            />
            <ContextInputChips
              attachments={contextInputParts}
              onRemove={(attachmentId) => setContextInputParts((current) => current.filter((item) => item.id !== attachmentId))}
            />
            {showSkills && (
              <div className={SKILL_MENU_CLASS}>
                <div className={cn(typeStyle({ role: 'label', tone: 'secondary' }), 'px-2 pb-1 pt-0.5')}>Commands and skills</div>
                <div className="max-h-[350px] space-y-0.5 overflow-y-auto pr-1" role="listbox" aria-label="Commands and skills">
                  {compactCommand.map((command, index) => (
                    <button
                      key={command.id}
                      type="button"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={insertCompactCommand}
                      role="option"
                      aria-selected={index === skillIndex}
                      className={`flex min-h-9 w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left ${
                        index === skillIndex ? 'bg-[var(--app-surface-2)]' : ''
                      }`}
                    >
                      <ContextWindowIndicator usedTokens={contextUsage.usedTokens} contextWindow={contextUsage.contextWindow} />
                      <span className={cn(typeStyle({ role: 'control' }), 'min-w-0 flex-1 truncate')}>
                        <span>{command.label}</span>
                        <span className={cn(typeStyle({ role: 'metadata', tone: 'secondary' }), 'ml-3')}>{command.description}</span>
                      </span>
                      <span className={cn(typeStyle({ role: 'metadata', tone: 'secondary' }), 'shrink-0')}>Command</span>
                    </button>
                  ))}
                  {matchingSkills.map((skill, index) => (
                    (() => {
                      const selected = inputHasSkill(input, skill)
                      const active = index + compactCommand.length === skillIndex
                      const sourceLabel = skill.source === 'plugin'
                        ? (skill.pluginName ?? 'Plugin')
                        : skill.source === 'personal'
                          ? 'Personal'
                          : 'System'
                      return (
                        <button
                          key={skill.id}
                          type="button"
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => { if (!selected) insertSkill(skill) }}
                          disabled={selected}
                          role="option"
                          aria-selected={active}
                          className={`flex min-h-9 w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left ${
                            active ? 'bg-[var(--app-surface-2)]' : ''
                          } ${selected ? 'cursor-default opacity-55' : ''}`}
                        >
                          <Package
                            className={`h-4 w-4 shrink-0 ${
                              selected ? 'text-app-mention' : 'text-[var(--app-text)] opacity-80'
                            }`}
                          />
                          <span className={cn(typeStyle({ role: 'control' }), 'min-w-0 flex-1 truncate')}>
                            <span className={selected ? 'text-app-mention' : undefined}>
                              {skillToken(skill, skillTrigger?.char ?? '/')}
                            </span>
                            {skill.description && (
                              <span className={cn(typeStyle({ role: 'metadata', tone: 'secondary' }), 'ml-3')}>{skill.description}</span>
                            )}
                          </span>
                          {selected ? (
                            <span className={cn(typeStyle({ role: 'status', tone: 'mention' }), 'inline-flex shrink-0 items-center gap-1')}>
                              <Check className="h-3.5 w-3.5" /> Selected
                            </span>
                          ) : (
                            <span className={cn(typeStyle({ role: 'metadata', tone: 'secondary' }), 'shrink-0')}>{sourceLabel}</span>
                          )}
                        </button>
                      )
                    })()
                  ))}
                </div>
              </div>
            )}
            <div data-composer-viewport="true" className="relative min-h-[44px] max-h-[160px] overflow-hidden px-1">
              <div className={COMPOSER_GHOST_VIEWPORT_CLASS} aria-hidden="true">
                <div ref={composerGhostTextRef} data-composer-ghost="true" className="min-h-full whitespace-pre-wrap break-words will-change-transform">
                  {input ? renderComposerText(input, skills) : null}
                </div>
              </div>
              <textarea
              ref={textareaRef}
              aria-label="Chat message"
              value={input}
              onChange={(e) => {
                selectionRef.current = {
                  start: e.currentTarget.selectionStart,
                  end: e.currentTarget.selectionEnd,
                }
                setInput(e.target.value)
                requestAnimationFrame(rememberSelection)
              }}
              onPaste={handlePaste}
              onDragOver={handleDragOver}
              onDrop={handleDrop}
              onSelect={rememberSelection}
              onKeyUp={rememberSelection}
              onMouseUp={rememberSelection}
              onScroll={syncComposerScroll}
              onKeyDown={(e) => {
                if (e.key === 'Backspace' && e.currentTarget.selectionStart === e.currentTarget.selectionEnd) {
                  const cursor = e.currentTarget.selectionStart
                  const beforeCursor = input.slice(0, cursor)
                  const match = beforeCursor.match(/(^|\s)(\S(?:.*\S)?)\s?$/)
                  const matchedSkill = match
                    ? skills.find((skill) => (
                        match[2] === inlineSkillText(skill) || match[2].endsWith(inlineSkillText(skill))
                      ))
                    : undefined
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
                if (shouldSendComposerOnEnter(e.key, e.shiftKey, isRunning && !isWorkerThread)) {
                  e.preventDefault()
                  void handleSend()
                }
              }}
              placeholder={
                isRunning
                  ? isWorkerThread
                    ? 'Steer this worker through its parent...'
                    : 'Keep typing while Codex works...'
                  : goalMode
                    ? 'Describe your goal, define measurable outcomes for best results'
                    : 'Ask for follow-up changes'
              }
              rows={1}
              spellCheck={false}
              className={TEXTAREA_CLASS}
            />
            </div>
            <div
              data-composer-toolbar="true"
              className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-2 text-[var(--app-text-muted)]"
            >
              <div className="flex shrink-0 items-center gap-3">
                <AddMenu
                  onAttachFiles={attachFiles}
                  onGoal={() => {
                    const nextGoalMode = !goalMode
                    setGoalMode(nextGoalMode)
                    if (nextGoalMode) setPlanMode(false)
                  }}
                  onPlanMode={() => {
                    const nextPlanMode = !planMode
                    setPlanMode(nextPlanMode)
                    if (nextPlanMode) setGoalMode(false)
                  }}
                  onPlugin={usePlugin}
                />
                <ApprovalSelector
                  value={turnSettings.approvalMode ?? 'custom'}
                  onChange={(approvalMode) => setTurnSettings((current) => ({ ...current, approvalMode }))}
                />
                {goalMode && (
                  <GoalModePill onRemove={() => setGoalMode(false)} />
                )}
                {planMode && (
                  <PlanModePill onRemove={() => setPlanMode(false)} />
                )}
              </div>
              <div className="ml-auto flex shrink-0 items-center gap-2 xl:gap-3">
                <ContextWindowIndicator usedTokens={contextUsage.usedTokens} contextWindow={contextUsage.contextWindow} />
                <ModelSelector settings={turnSettings} onChange={setTurnSettings} />
                <VoiceDictationButton listening={voiceListening} onClick={toggleVoiceDictation} />
                <button
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => void handlePrimaryAction()}
                  disabled={primaryActionIsStop ? !threadId : !hasComposerContent}
                  className={SEND_BUTTON_CLASS}
                  aria-label={primaryActionIsStop ? 'Stop Codex' : 'Send message'}
                  title={primaryActionIsStop ? 'Stop Codex' : 'Send message'}
                >
                  {primaryActionIsStop ? <Square className="h-3 w-3 fill-current" /> : <ArrowUp className="h-4 w-4" />}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function ContextInputChips({ attachments, onRemove }: { attachments: ContextInputAttachment[]; onRemove: (attachmentId: string) => void }) {
  if (attachments.length === 0) return null

  return (
    <div className="mb-2 flex flex-wrap gap-1.5 px-1" data-composer-attachments="context">
      {attachments.map((attachment) => {
        const preview = visualInputPreview(attachment.input)
        return (
          <button
            key={attachment.id}
            type="button"
            onClick={() => onRemove(attachment.id)}
            className={cn(
              typeStyle({ role: 'metadata' }),
              'inline-flex max-w-full items-center gap-1.5 rounded-lg bg-app-surface-2 px-1.5 py-1 ring-1 ring-app-border/55 hover:bg-app-border/70',
            )}
            title={`Remove ${attachment.label}`}
            aria-label={`Remove context attachment ${attachment.label}`}
          >
            {preview ? (
              <img
                src={preview.src}
                alt=""
                className="h-8 w-10 rounded-md object-cover"
                loading="lazy"
              />
            ) : (
              <span className="flex h-8 w-8 items-center justify-center rounded-md bg-app-surface">
                <Image className="h-3.5 w-3.5 text-app-text-secondary" />
              </span>
            )}
            <span className="max-w-44 truncate">{attachment.label}</span>
            <X className="h-3 w-3 shrink-0 text-app-text-secondary" aria-hidden="true" />
          </button>
        )
      })}
    </div>
  )
}
