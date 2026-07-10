import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent } from 'react'
import { toast } from 'sonner'
import {
  ArrowUp,
  Check,
  Image,
  Loader2,
  Package,
  X,
} from 'lucide-react'
import { useCodexActions, useCodexThreads, useCodexWindows } from '../state/codex'
import { useWorkspace } from '../state/workspace'
import { useSettings } from '../state/settings'
import { AddMenu } from './chat/AddMenu'
import { ApprovalSelector } from './chat/ApprovalSelector'
import { AttachmentChips } from './chat/AttachmentChips'
import { INSERT_CHAT_CONTEXT_EVENT, insertChatContextDetailFromEvent } from './chat/chat-context-events'
import { NEW_THREAD_EMPTY_STATE, shouldRestoreDraftAfterSendError } from './chat/chat-window-state'
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
import { VoiceDictationButton } from './chat/VoiceDictationButton'
import {
  appendDictationTranscript,
  speechRecognitionConstructor,
  transcriptFromSpeechRecognitionEvent,
  voiceDictationErrorMessage,
  type SpeechRecognitionLike,
} from './chat/voice-dictation'
import type { CodexPluginInfo, CodexSkillInfo, CodexTurnSettings, CodexUserInput } from '@/shared/codex'

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
  'from-[var(--app-bg)] via-[var(--app-bg)]/95 to-transparent px-6 pb-4 pt-16',
].join(' ')
const COMPOSER_CARD_CLASS = [
  'pointer-events-auto relative mx-auto w-full max-w-[760px] rounded-3xl border',
  'border-[var(--app-border)] bg-[var(--app-surface)] p-3 shadow-2xl shadow-black/30',
].join(' ')
const COMPOSER_MIN_HEIGHT = 44
const COMPOSER_MAX_HEIGHT = 160
const TEXTAREA_CLASS = [
  'relative z-10 block min-h-[44px] max-h-[160px] w-full resize-none overflow-y-hidden bg-transparent px-0 text-sm leading-5',
  'text-transparent caret-[var(--app-text)] outline-none placeholder:text-[var(--app-text-muted)]',
].join(' ')
const SKILL_MENU_CLASS = [
  'absolute inset-x-0 bottom-full mb-4 max-h-[420px] rounded-3xl border',
  'border-[var(--app-border)] bg-[var(--app-surface)] p-5 shadow-2xl shadow-black/40',
].join(' ')
const COMPOSER_GHOST_VIEWPORT_CLASS =
  'pointer-events-none absolute inset-0 overflow-hidden px-1 text-sm leading-5 text-app-text'
const SEND_BUTTON_CLASS = [
  'flex h-8 w-8 items-center justify-center rounded-full bg-[var(--app-text)]',
  'text-[var(--app-bg)] transition hover:bg-[var(--app-text)] disabled:opacity-40',
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
  } = useCodexActions()
  const { getThread } = useCodexThreads()
  const { getThreadForWindow } = useCodexWindows()
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
  const [contextInputParts, setContextInputParts] = useState<ContextInputAttachment[]>([])
  const [voiceListening, setVoiceListening] = useState(false)
  const [skills, setSkills] = useState<CodexSkillInfo[]>([])
  const [skillIndex, setSkillIndex] = useState(0)
  const [expandedGroupIds, setExpandedGroupIds] = useState<Set<string>>(new Set())
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const composerGhostTextRef = useRef<HTMLDivElement>(null)
  const composerRef = useRef<HTMLDivElement>(null)
  const composerHadFocusRef = useRef(false)
  const selectionRef = useRef({ start: 0, end: 0 })
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const shouldScrollToBottomRef = useRef(true)
  const speechRecognitionRef = useRef<SpeechRecognitionLike | null>(null)

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
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight
    const isNearBottom = distanceFromBottom <= 80
    if (thread?.isRunning || isNearBottom) {
      scrollTranscriptToBottom()
    }
  }, [thread?.messages, thread?.pendingApprovals, thread?.isRunning, scrollTranscriptToBottom])

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
    if (planMode) inputParts.push({ type: 'text', text: PLAN_MODE_PROMPT })
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
      if (text === '/compact') {
        if (!threadId) return
        await compactThread(threadId)
      } else {
        const message = buildMessage(text)
        if (threadId) {
          await sendMessage(threadId, message.displayText, message.input, turnSettings)
        } else {
          await createThread(id, message.displayText, turnSettings, message.input)
        }
      }
    } catch (error) {
      if (shouldRestoreDraftAfterSendError(threadId, error)) {
        setInput(draftInput)
        setAttachments(draftAttachments)
        setContextInputParts(draftContextInputParts)
      }
      toast.error(error instanceof Error ? error.message : 'Failed to send Codex message.')
    } finally {
      requestAnimationFrame(() => textareaRef.current?.focus({ preventScroll: true }))
    }
  }

  const attachFiles = async () => {
    const result = await window.cranberri.codex.pickFiles()
    if (result.paths.length > 0) setAttachments((current) => [...current, ...result.paths])
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
          className="h-full overflow-y-auto px-6 pb-36 pt-8"
        >
          <div className="mx-auto flex min-h-full w-full max-w-[760px] flex-col justify-end gap-5">
            {(!thread || thread.messages.length === 0) && (
              <div className="pt-16 text-center text-xs text-[var(--app-text-muted)]">
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
                className="rounded-xl border border-[var(--app-border)] bg-[var(--app-surface)] p-4 text-xs text-[var(--app-text)]"
              >
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
                <div className="mb-4 text-sm text-[var(--app-text-muted)]">Skills</div>
                <div className="max-h-[340px] space-y-1 overflow-y-auto pr-1">
                  {compactCommand.map((command, index) => (
                    <button
                      key={command.id}
                      type="button"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={insertCompactCommand}
                      className={`flex w-full items-center gap-3 rounded-lg px-1 py-1.5 text-left ${
                        index === skillIndex ? 'bg-[var(--app-surface-2)]' : ''
                      }`}
                    >
                      <ContextWindowIndicator usedTokens={contextUsage.usedTokens} contextWindow={contextUsage.contextWindow} />
                      <span className="min-w-0 flex-1 truncate text-sm leading-5">
                        <span className="text-[var(--app-text)]">{command.label}</span>
                        <span className="ml-3 text-[var(--app-text-muted)]">{command.description}</span>
                      </span>
                      <span className="shrink-0 text-sm text-[var(--app-text-muted)]">Command</span>
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
                          className={`flex w-full items-center gap-3 rounded-lg px-1 py-1.5 text-left ${
                            active ? 'bg-[var(--app-surface-2)]' : ''
                          } ${selected ? 'cursor-default opacity-55' : ''}`}
                        >
                          <Package
                            className={`h-4 w-4 shrink-0 ${
                              selected ? 'text-app-mention' : 'text-[var(--app-text)] opacity-80'
                            }`}
                          />
                          <span className="min-w-0 flex-1 truncate text-sm leading-5">
                            <span className={selected ? 'text-app-mention' : 'text-[var(--app-text)]'}>
                              {skillToken(skill, skillTrigger?.char ?? '/')}
                            </span>
                            {skill.description && (
                              <span className="ml-3 text-[var(--app-text-muted)]">{skill.description}</span>
                            )}
                          </span>
                          {selected ? (
                            <span className="inline-flex shrink-0 items-center gap-1 text-sm text-app-mention">
                              <Check className="h-3.5 w-3.5" /> Selected
                            </span>
                          ) : (
                            <span className="shrink-0 text-sm text-[var(--app-text-muted)]">{sourceLabel}</span>
                          )}
                        </button>
                      )
                    })()
                  ))}
                </div>
              </div>
            )}
            <div data-composer-viewport="true" className="relative min-h-[44px] max-h-[160px] overflow-hidden px-1 text-sm leading-5">
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
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  handleSend()
                }
              }}
              placeholder={
                isRunning
                  ? 'Keep typing while Codex works...'
                  : goalMode
                    ? 'Describe your goal, define measurable outcomes for best results'
                    : 'Ask for follow-up changes'
              }
              rows={1}
              spellCheck={false}
              className={TEXTAREA_CLASS}
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
                  <GoalModePill onRemove={() => setGoalMode(false)} />
                )}
              </div>
              <div className="flex items-center gap-3">
                <ContextWindowIndicator usedTokens={contextUsage.usedTokens} contextWindow={contextUsage.contextWindow} />
                <ModelSelector settings={turnSettings} onChange={setTurnSettings} />
                <VoiceDictationButton listening={voiceListening} onClick={toggleVoiceDictation} />
                <button
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={handleSend}
                  disabled={isRunning || (!input.trim() && attachments.length === 0 && contextInputParts.length === 0)}
                  className={SEND_BUTTON_CLASS}
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
            className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-[var(--app-border)] bg-[var(--app-surface-2)] px-1.5 py-1 text-caption text-[var(--app-text)] hover:bg-[var(--app-border)]"
            title={`Remove ${attachment.label}`}
            aria-label={`Remove context attachment ${attachment.label}`}
          >
            {preview ? (
              <img
                src={preview.src}
                alt=""
                className="h-8 w-10 rounded border border-[var(--app-border)] object-cover"
                loading="lazy"
              />
            ) : (
              <span className="flex h-8 w-8 items-center justify-center rounded border border-[var(--app-border)] bg-[var(--app-surface)]">
                <Image className="h-3.5 w-3.5 text-app-text-muted" />
              </span>
            )}
            <span className="max-w-44 truncate">{attachment.label}</span>
            <X className="h-3 w-3 shrink-0 text-[var(--app-text-muted)]" aria-hidden="true" />
          </button>
        )
      })}
    </div>
  )
}
