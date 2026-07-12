import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { composerDraftOwnerKey, useComposerDraftController } from './composer-drafts'
import { registerChatContextTarget, type ChatContextPayload } from './chat-context-command'
import {
  contextInputLabel,
  imageInputFromClipboardFile,
  isClipboardImageFile,
  isLocalImagePath,
  localAttachmentPathsFromTransferFiles,
  pastedAttachmentInputsFromText,
} from '../components/chat/composer-attachments'
import type { ComposerEditorHandle } from '../components/chat/ComposerEditor'
import type { ComposerSuggestion } from '../components/chat/ComposerSuggestionMenu'
import {
  pluginComposerMention,
  skillComposerMention,
  type ComposerMention,
  type ComposerSnapshot,
  type ComposerTrigger,
} from '../components/chat/composer-editor-model'
import { composerBottomInset } from '../components/chat/composer-layout'
import {
  speechRecognitionConstructor,
  transcriptFromSpeechRecognitionEvent,
  voiceDictationErrorMessage,
  type SpeechRecognitionLike,
} from '../components/chat/voice-dictation'
import type { ComposerDraft, ContextInputAttachment } from '@/shared/composer-drafts'
import type { CodexPluginInfo, CodexSkillInfo, CodexTurnSettings, CodexUserInput } from '@/shared/codex'

const GOAL_PROMPT = [
  'Create and run this as a Codex goal.',
  'Keep working until the goal is complete, and report progress only when you need a decision or finish.',
].join(' ')
const PLAN_MODE_PROMPT = [
  'Plan mode: do not edit files yet.',
  'Inspect the repo, produce a concise implementation plan, risks, and verification steps, then wait for approval.',
].join(' ')

export interface ChatComposerSubmission {
  displayText: string
  input: CodexUserInput[]
  text: string
  turnSettings: CodexTurnSettings
}

export interface ComposerSendLifecycleResult {
  acknowledged: boolean
  dispatchError?: unknown
  clearError?: unknown
}

export async function runComposerSendLifecycle<T>({
  journal,
  clearVisible,
  dispatch,
  restoreVisible,
  restoreSavedDraft,
  clearSavedDraft,
}: {
  journal: () => Promise<T | null>
  clearVisible: () => void
  dispatch: () => Promise<void>
  restoreVisible: () => void
  restoreSavedDraft: (journaled: T) => void
  clearSavedDraft: () => Promise<void>
}): Promise<ComposerSendLifecycleResult> {
  const journaled = await journal()
  clearVisible()
  try {
    await dispatch()
  } catch (dispatchError) {
    restoreVisible()
    if (journaled) restoreSavedDraft(journaled)
    return { acknowledged: false, dispatchError }
  }
  try {
    if (journaled) await clearSavedDraft()
    return { acknowledged: true }
  } catch (clearError) {
    return { acknowledged: true, clearError }
  }
}

interface UseChatComposerOptions {
  windowId: string
  projectId: string | null
  bindingRevision: number
  threadId: string | null
  isRunning: boolean
  inputBlockReason: string | null
  initialTurnSettings: CodexTurnSettings
  baseRef: string
  environmentId: string | null
  includeLocalChanges: boolean
  contextUsage: { usedTokens: number; contextWindow: number }
  focusRestoreKey: string
  onRestoreBaseRef: (baseRef: string) => void
  onRestoreEnvironment: (environmentId: string | null) => void
  onRestoreIncludeLocalChanges: (includeLocalChanges: boolean) => void
  onComposerInsetChange: (inset: number) => void
  onDispatch: (submission: ChatComposerSubmission) => Promise<void>
  onAbort: () => Promise<void>
}

export interface ChatComposerController {
  input: string
  turnSettings: CodexTurnSettings
  planMode: boolean
  goalMode: boolean
  attachments: string[]
  contextInputParts: ContextInputAttachment[]
  voiceListening: boolean
  skills: CodexSkillInfo[]
  composerMentions: ComposerMention[]
  composerCatalog: ComposerMention[]
  suggestions: ComposerSuggestion[]
  showSuggestions: boolean
  suggestionTitle: string
  suggestionIndex: number
  hasContent: boolean
  primaryActionIsStop: boolean
  editorRef: React.RefObject<ComposerEditorHandle>
  composerRef: React.RefObject<HTMLDivElement>
  setTurnSettings: React.Dispatch<React.SetStateAction<CodexTurnSettings>>
  setPlanMode: React.Dispatch<React.SetStateAction<boolean>>
  setGoalMode: React.Dispatch<React.SetStateAction<boolean>>
  setInputSnapshot: (snapshot: ComposerSnapshot) => void
  setTrigger: (trigger: ComposerTrigger | null) => void
  setComposerFocused: (focused: boolean) => void
  removeAttachment: (filePath: string) => void
  removeContextInput: (attachmentId: string) => void
  attachFiles: () => Promise<void>
  addTransferInputs: (transfer: DataTransfer) => boolean
  usePlugin: (plugin: CodexPluginInfo) => void
  insertSuggestion: (index: number) => void
  handleSuggestionKeyDown: (event: KeyboardEvent) => boolean
  submit: () => Promise<void>
  primaryAction: () => Promise<void>
  toggleVoiceDictation: () => void
}

export function buildChatComposerMessage({
  text,
  mentions,
  attachments,
  contextInputParts,
  goalMode,
  planMode,
}: {
  text: string
  mentions: readonly ComposerMention[]
  attachments: readonly string[]
  contextInputParts: readonly ContextInputAttachment[]
  goalMode: boolean
  planMode: boolean
}): { displayText: string; input: CodexUserInput[] } {
  const input: CodexUserInput[] = []
  if (goalMode) input.push({ type: 'text', text: GOAL_PROMPT })
  else if (planMode) input.push({ type: 'text', text: PLAN_MODE_PROMPT })
  if (attachments.length > 0) {
    input.push({
      type: 'text',
      text: `Attached local paths:\n${attachments.map((filePath) => `- ${filePath}`).join('\n')}`,
    })
    input.push(...attachments
      .filter(isLocalImagePath)
      .map((filePath) => ({ type: 'localImage' as const, path: filePath, detail: 'high' as const })))
  }
  input.push(...contextInputParts.map((attachment) => attachment.input))
  if (text) input.push({ type: 'text', text })

  const skillMentions = mentions.filter((mention) => mention.kind === 'skill')
  const uniqueSkills = [...new Map(skillMentions.map((mention) => [mention.path, mention])).values()]
  input.push(...uniqueSkills.map((skill) => ({ type: 'skill' as const, name: skill.name, path: skill.path })))
  return { displayText: text || 'Attached context', input }
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
      if (typeof reader.result === 'string') resolve(reader.result)
      else reject(new Error('Pasted image did not produce a data URL'))
    }
    reader.readAsDataURL(file)
  })
}

export function useChatComposer(options: UseChatComposerOptions): ChatComposerController {
  const {
    windowId,
    projectId,
    bindingRevision,
    threadId,
    isRunning,
    inputBlockReason,
    initialTurnSettings,
    baseRef,
    environmentId,
    includeLocalChanges,
    contextUsage,
    focusRestoreKey,
    onRestoreBaseRef,
    onRestoreEnvironment,
    onRestoreIncludeLocalChanges,
    onComposerInsetChange,
    onDispatch,
    onAbort,
  } = options
  const ownerKey = projectId ? composerDraftOwnerKey(projectId, windowId, threadId) : null
  const { loaded, restoredDraft, persist, beginSend, clear } = useComposerDraftController(ownerKey)
  const [input, setInput] = useState('')
  const [turnSettings, setTurnSettings] = useState<CodexTurnSettings>(initialTurnSettings)
  const [planMode, setPlanMode] = useState(false)
  const [goalMode, setGoalMode] = useState(false)
  const [attachments, setAttachments] = useState<string[]>([])
  const [contextInputParts, setContextInputParts] = useState<ContextInputAttachment[]>([])
  const [voiceListening, setVoiceListening] = useState(false)
  const [skills, setSkills] = useState<CodexSkillInfo[]>([])
  const [plugins, setPlugins] = useState<CodexPluginInfo[]>([])
  const [composerMentions, setComposerMentions] = useState<ComposerMention[]>([])
  const [trigger, setTriggerState] = useState<ComposerTrigger | null>(null)
  const [suggestionIndex, setSuggestionIndex] = useState(0)
  const editorRef = useRef<ComposerEditorHandle>(null)
  const composerRef = useRef<HTMLDivElement>(null)
  const composerHadFocusRef = useRef(false)
  const speechRecognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const restoredOwnerRef = useRef<string | null>(null)
  const skipPersistOwnerRef = useRef<string | null>(null)
  const sendInFlightRef = useRef(false)

  const buildDraft = useCallback((text = input, mentions = composerMentions): ComposerDraft | null => {
    if (!ownerKey || !projectId) return null
    return {
      ownerKey,
      projectId,
      windowId,
      bindingRevision,
      updatedAt: Date.now(),
      text,
      mentions,
      attachmentPaths: attachments,
      contextInputAttachments: contextInputParts,
      turnSettings,
      planMode,
      goalMode,
      baseRef,
      environmentId,
      includeLocalChanges,
    }
  }, [attachments, baseRef, bindingRevision, composerMentions, contextInputParts, environmentId, goalMode, includeLocalChanges, input, ownerKey, planMode, projectId, turnSettings, windowId])

  useEffect(() => {
    if (!ownerKey || !loaded || restoredOwnerRef.current === ownerKey) return
    restoredOwnerRef.current = ownerKey
    skipPersistOwnerRef.current = ownerKey
    if (!restoredDraft) return
    setInput(restoredDraft.text)
    setComposerMentions(restoredDraft.mentions)
    setAttachments(restoredDraft.attachmentPaths)
    setContextInputParts(restoredDraft.contextInputAttachments)
    setTurnSettings(restoredDraft.turnSettings)
    setPlanMode(restoredDraft.planMode)
    setGoalMode(restoredDraft.goalMode)
    onRestoreBaseRef(restoredDraft.baseRef)
    onRestoreEnvironment(restoredDraft.environmentId)
    onRestoreIncludeLocalChanges(restoredDraft.includeLocalChanges)
    if (restoredDraft.pendingSend) {
      toast.warning('Previous send was interrupted', {
        id: `composer-send-interrupted:${ownerKey}`,
        description: 'Review the restored message before sending it again.',
      })
    }
  }, [loaded, onRestoreBaseRef, onRestoreEnvironment, onRestoreIncludeLocalChanges, ownerKey, restoredDraft])

  useEffect(() => {
    if (!ownerKey || !loaded || restoredOwnerRef.current !== ownerKey || sendInFlightRef.current) return
    if (skipPersistOwnerRef.current === ownerKey) {
      skipPersistOwnerRef.current = null
      return
    }
    const draft = buildDraft()
    if (!draft) return
    const timeout = window.setTimeout(() => {
      void persist(draft).catch(() => toast.error('Composer draft could not be saved', { id: 'composer-draft-save-failed' }))
    }, 150)
    return () => window.clearTimeout(timeout)
  }, [buildDraft, loaded, ownerKey, persist])

  useEffect(() => {
    const flush = (event: Event) => {
      const draft = buildDraft()
      if (!draft || !loaded) return
      const detail = (event as CustomEvent<{ writes: Promise<unknown>[] }>).detail
      detail?.writes.push(persist(draft))
    }
    window.addEventListener('cranberri:flush-persistence', flush)
    return () => window.removeEventListener('cranberri:flush-persistence', flush)
  }, [buildDraft, loaded, persist])

  useEffect(() => {
    Promise.all([window.cranberri.codex.skills(), window.cranberri.codex.plugins()])
      .then(([skillResult, pluginResult]) => {
        setSkills(skillResult.skills)
        setPlugins(pluginResult.plugins.filter((plugin) => plugin.enabled))
      })
      .catch((error) => console.error('Failed to load Codex composer resources:', error))
  }, [])

  useEffect(() => () => {
    speechRecognitionRef.current?.abort?.()
    speechRecognitionRef.current = null
  }, [])

  useEffect(() => {
    const composer = composerRef.current
    if (!composer || typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(() => {
      onComposerInsetChange(composerBottomInset(composer.getBoundingClientRect().height))
    })
    observer.observe(composer)
    return () => observer.disconnect()
  }, [onComposerInsetChange])

  const insertChatContext = useCallback((detail: ChatContextPayload) => {
    setInput((current) => current.trim() ? `${current.trimEnd()}\n\n${detail.text}` : detail.text)
    if (detail.inputParts?.length) {
      setContextInputParts((current) => [...current, ...detail.inputParts!.map(contextInputAttachment)])
    }
    if (detail.attachmentPaths?.length) {
      setAttachments((current) => [...current, ...detail.attachmentPaths!.filter((path) => !current.includes(path))])
    }
    composerHadFocusRef.current = true
    requestAnimationFrame(() => editorRef.current?.focus('end'))
  }, [])

  useEffect(() => registerChatContextTarget(windowId, insertChatContext), [insertChatContext, windowId])

  useLayoutEffect(() => {
    if (composerHadFocusRef.current) editorRef.current?.focus()
  }, [focusRestoreKey])

  const addTransferInputs = useCallback((transfer: DataTransfer): boolean => {
    const parsed = pastedAttachmentInputsFromText(transfer.getData('text/plain'))
    const imageFiles = Array.from(transfer.files).filter(isClipboardImageFile)
    const localPaths = [...parsed.attachmentPaths, ...localAttachmentPathsFromTransferFiles(transfer.files)]
    if (parsed.inputParts.length === 0 && imageFiles.length === 0 && localPaths.length === 0) return false
    composerHadFocusRef.current = true
    if (parsed.inputParts.length) {
      setContextInputParts((current) => [...current, ...parsed.inputParts.map(contextInputAttachment)])
    }
    if (localPaths.length) {
      setAttachments((current) => [...current, ...localPaths.filter((path) => !current.includes(path))])
    }
    if (parsed.remainingText) editorRef.current?.insertText(parsed.remainingText)
    if (imageFiles.length) {
      Promise.all(imageFiles.map((file) => imageInputFromClipboardFile(file, (item) => fileToDataUrl(item as File))))
        .then((parts) => {
          const visualInputs = parts.filter((part): part is CodexUserInput => part !== null)
          if (visualInputs.length) {
            setContextInputParts((current) => [...current, ...visualInputs.map(contextInputAttachment)])
          }
        })
        .catch((error) => console.warn('Failed to read transferred image:', error))
    }
    return true
  }, [])

  const submit = useCallback(async (): Promise<void> => {
    if (inputBlockReason) {
      toast.error(inputBlockReason)
      return
    }
    const snapshot = editorRef.current?.snapshot() ?? { text: input, plainText: input, mentions: composerMentions }
    const text = snapshot.text.trim()
    if (!text && attachments.length === 0 && contextInputParts.length === 0) return
    if (text === '/compact' && !threadId) return

    const draftInput = snapshot.text
    const draftAttachments = attachments
    const draftContextInputParts = contextInputParts
    const durableDraft = buildDraft(snapshot.text, snapshot.mentions)
    let lifecycle: ComposerSendLifecycleResult
    try {
      lifecycle = await runComposerSendLifecycle({
        journal: () => durableDraft ? beginSend(durableDraft, threadId ?? undefined) : Promise.resolve(null),
        clearVisible: () => {
          sendInFlightRef.current = true
          composerHadFocusRef.current = true
          setInput('')
          setComposerMentions([])
          setTriggerState(null)
          setAttachments([])
          setContextInputParts([])
        },
        dispatch: () => {
          const message = buildChatComposerMessage({
            text,
            mentions: snapshot.mentions,
            attachments: draftAttachments,
            contextInputParts: draftContextInputParts,
            goalMode,
            planMode,
          })
          return onDispatch({ ...message, text, turnSettings })
        },
        restoreVisible: () => {
          setInput(draftInput)
          setComposerMentions(snapshot.mentions)
          setAttachments(draftAttachments)
          setContextInputParts(draftContextInputParts)
        },
        restoreSavedDraft: (journaledDraft) => {
          const retryDraft: ComposerDraft = { ...journaledDraft, updatedAt: Date.now() }
          delete retryDraft.pendingSend
          void persist(retryDraft).catch(() => toast.error('Composer draft could not be saved', { id: 'composer-draft-save-failed' }))
        },
        clearSavedDraft: clear,
      })
    } catch {
      toast.error('Composer draft could not be saved. Message was not sent.', { id: 'composer-draft-send-journal-failed' })
      return
    }
    sendInFlightRef.current = false
    if (lifecycle.dispatchError) {
      toast.error(lifecycle.dispatchError instanceof Error ? lifecycle.dispatchError.message : 'Failed to send Codex message.')
    }
    if (lifecycle.clearError) {
      toast.error('Sent, but the saved draft could not be cleared', { id: 'composer-draft-clear-failed' })
    }
    requestAnimationFrame(() => editorRef.current?.focus())
  }, [attachments, beginSend, buildDraft, clear, composerMentions, contextInputParts, goalMode, input, inputBlockReason, onDispatch, persist, planMode, threadId, turnSettings])

  const hasContent = Boolean(input.trim() || attachments.length || contextInputParts.length)
  const primaryActionIsStop = isRunning && !hasContent
  const primaryAction = useCallback(async (): Promise<void> => {
    const snapshot = editorRef.current?.snapshot()
    const editorInput = snapshot?.text ?? input
    const hasCurrentContent = Boolean(editorInput.trim() || attachments.length || contextInputParts.length)
    if (!isRunning || hasCurrentContent) await submit()
    else await onAbort()
  }, [attachments.length, contextInputParts.length, input, isRunning, onAbort, submit])

  const composerCatalog = useMemo(() => [...skills.map(skillComposerMention), ...plugins.map(pluginComposerMention)], [plugins, skills])
  const matchingSkills = useMemo(() => trigger?.char === '$'
    ? skills.filter((skill) => `${skill.name} ${skill.displayName} ${skill.description}`.toLowerCase().includes(trigger.query))
    : [], [skills, trigger])
  const matchingPlugins = useMemo(() => trigger?.char === '@'
    ? plugins.filter((plugin) => `${plugin.name} ${plugin.displayName} ${plugin.description}`.toLowerCase().includes(trigger.query))
    : [], [plugins, trigger])
  const compactPercent = Math.min(100, Math.round((contextUsage.usedTokens / Math.max(1, contextUsage.contextWindow)) * 100))
  const suggestions = useMemo<ComposerSuggestion[]>(() => trigger?.char === '/'
    ? ('compact'.includes(trigger.query) ? [{ id: 'command:compact', kind: 'command', label: '/compact', description: `Compact this thread's context (${compactPercent}% full)`, badge: 'Command' }] : [])
    : trigger?.char === '$'
      ? matchingSkills.map((skill) => ({ id: `skill:${skill.id}`, kind: 'skill', label: `$${skill.name}`, description: skill.description, badge: skill.source === 'plugin' ? (skill.pluginName ?? 'Plugin') : skill.source === 'personal' ? 'Personal' : 'System', selected: composerMentions.some((mention) => mention.kind === 'skill' && mention.id === skill.id) }))
      : matchingPlugins.map((plugin) => ({ id: `plugin:${plugin.id}`, kind: 'plugin', label: `@${plugin.name}`, description: plugin.description || plugin.prompt, badge: plugin.toolCount > 0 ? `${plugin.toolCount} tools` : 'Plugin', selected: composerMentions.some((mention) => mention.kind === 'plugin' && mention.id === plugin.id) })), [compactPercent, composerMentions, matchingPlugins, matchingSkills, trigger])
  const showSuggestions = Boolean(trigger && suggestions.length)

  const insertSuggestion = useCallback((index: number) => {
    const suggestion = suggestions[index]
    if (!trigger || !suggestion || suggestion.selected) return
    if (suggestion.kind === 'command') editorRef.current?.insertText('/compact ', trigger)
    else if (suggestion.kind === 'skill') {
      const skill = matchingSkills.find((candidate) => `skill:${candidate.id}` === suggestion.id)
      if (skill) editorRef.current?.insertMention(skillComposerMention(skill), trigger)
    } else {
      const plugin = matchingPlugins.find((candidate) => `plugin:${candidate.id}` === suggestion.id)
      if (plugin) editorRef.current?.insertMention(pluginComposerMention(plugin), trigger)
    }
    setSuggestionIndex(0)
  }, [matchingPlugins, matchingSkills, suggestions, trigger])

  const handleSuggestionKeyDown = useCallback((event: KeyboardEvent): boolean => {
    if (!showSuggestions) return false
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const direction = event.key === 'ArrowDown' ? 1 : -1
      setSuggestionIndex((index) => (index + direction + suggestions.length) % suggestions.length)
      return true
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      insertSuggestion(Math.min(suggestionIndex, suggestions.length - 1))
      return true
    }
    if (event.key === 'Tab') {
      event.preventDefault()
      const suggestion = suggestions[Math.min(suggestionIndex, suggestions.length - 1)]
      if (trigger && suggestion) editorRef.current?.insertText(suggestion.label, trigger)
      setSuggestionIndex(0)
      return true
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      setTriggerState(null)
      setSuggestionIndex(0)
      return true
    }
    return false
  }, [insertSuggestion, showSuggestions, suggestionIndex, suggestions, trigger])

  const toggleVoiceDictation = useCallback(() => {
    if (speechRecognitionRef.current) {
      speechRecognitionRef.current.stop()
      speechRecognitionRef.current = null
      setVoiceListening(false)
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
      if (transcript) {
        composerHadFocusRef.current = true
        editorRef.current?.insertDictation(transcript)
      }
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
  }, [])

  return {
    input,
    turnSettings,
    planMode,
    goalMode,
    attachments,
    contextInputParts,
    voiceListening,
    skills,
    composerMentions,
    composerCatalog,
    suggestions,
    showSuggestions,
    suggestionTitle: trigger?.char === '$' ? 'Skills' : trigger?.char === '@' ? 'Plugins and context' : 'Commands',
    suggestionIndex,
    hasContent,
    primaryActionIsStop,
    editorRef,
    composerRef,
    setTurnSettings,
    setPlanMode,
    setGoalMode,
    setInputSnapshot: (snapshot) => { setInput(snapshot.text); setComposerMentions(snapshot.mentions) },
    setTrigger: (next) => { setTriggerState(next); setSuggestionIndex(0) },
    setComposerFocused: (focused) => { composerHadFocusRef.current = focused },
    removeAttachment: (path) => setAttachments((current) => current.filter((item) => item !== path)),
    removeContextInput: (id) => setContextInputParts((current) => current.filter((item) => item.id !== id)),
    attachFiles: async () => {
      const result = await window.cranberri.codex.pickFiles()
      if (result.paths.length) setAttachments((current) => [...current, ...result.paths])
    },
    addTransferInputs,
    usePlugin: (plugin) => editorRef.current?.insertMention(pluginComposerMention(plugin)),
    insertSuggestion,
    handleSuggestionKeyDown,
    submit,
    primaryAction,
    toggleVoiceDictation,
  }
}
