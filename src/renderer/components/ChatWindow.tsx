import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  ArrowDown,
  ArrowUp,
  Image,
  Square,
  X,
} from 'lucide-react'
import { useCodexActions, useCodexThreads, useCodexWindows } from '../state/codex'
import { useWorkspace } from '../state/workspace'
import { useSettings } from '../state/settings'
import { useOptionalTasks } from '../state/tasks'
import { useRepos } from '../state/repos'
import { useRecovery } from '../state/recovery'
import { composerDraftOwnerKey, useComposerDraftController } from '../state/composer-drafts'
import { registerChatContextTarget, type ChatContextPayload } from '../state/chat-context-command'
import { invalidateSessions } from '../state/session-invalidation'
import { AddMenu } from './chat/AddMenu'
import { ApprovalSelector } from './chat/ApprovalSelector'
import { AttachmentChips } from './chat/AttachmentChips'
import {
  NEW_THREAD_EMPTY_STATE,
  didReaderMoveTranscriptUp,
  isTranscriptNearBottom,
  projectWithFreshLocalSettings,
  sessionThreadIdFromWindowId,
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
import { ComposerEditor, type ComposerEditorHandle } from './chat/ComposerEditor'
import { ComposerSuggestionMenu, type ComposerSuggestion } from './chat/ComposerSuggestionMenu'
import {
  pluginComposerMention,
  skillComposerMention,
  type ComposerMention,
  type ComposerSnapshot,
  type ComposerTrigger,
} from './chat/composer-editor-model'
import { ContextWindowIndicator } from './chat/ContextWindowIndicator'
import { GoalModePill } from './chat/GoalModePill'
import { ModelSelector } from './chat/ModelSelector'
import { TranscriptList } from './chat/TranscriptList'
import { composerBottomInset } from './chat/composer-layout'
import { VoiceDictationButton } from './chat/VoiceDictationButton'
import { PlanModePill } from './chat/PlanModePill'
import { DraftSessionHeader } from './chat/DraftSessionHeader'
import { TaskHeader } from './chat/TaskHeader'
import { TaskSetupStatus } from './chat/TaskSetupStatus'
import { StartupRecoveryNotice } from './chat/StartupRecoveryNotice'
import { PromptDialog } from './PromptDialog'
import { cn } from '../lib/ui'
import { typeStyle } from '../lib/typography'
import {
  speechRecognitionConstructor,
  transcriptFromSpeechRecognitionEvent,
  voiceDictationErrorMessage,
  type SpeechRecognitionLike,
} from './chat/voice-dictation'
import type { CodexPluginInfo, CodexSkillInfo, CodexTurnSettings, CodexUserInput } from '@/shared/codex'
import type { ComposerDraft, ContextInputAttachment } from '@/shared/composer-drafts'

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
  'bg-app-surface p-3 shadow-xl ring-1 ring-app-border/75 transition-shadow duration-fast ease-standard focus-within:ring-2 focus-within:ring-app-accent/40',
].join(' ')
const SEND_BUTTON_CLASS = [
  'flex h-8 w-8 items-center justify-center rounded-full bg-app-text text-app-bg',
  'transition-colors duration-fast ease-standard hover:bg-app-text/85 disabled:pointer-events-none disabled:opacity-35',
].join(' ')

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Task action failed'
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
    steerThread,
    compactThread,
    approve,
    abort,
    messageWorker,
    restoreSessionWindow,
    bindTaskWindow,
    markThreadSendFailed,
  } = useCodexActions()
  const { getThread } = useCodexThreads()
  const { getThreadForWindow } = useCodexWindows()
  const { settings } = useSettings()
  const tasks = useOptionalTasks()
  const { activeProject } = useRepos()
  const { windows, renameWindow, bindWindowToTask, openTerminal } = useWorkspace()
  const workspaceWindow = windows.find((window) => window.id === id)
  const recovery = useRecovery()
  const recoveryNotice = recovery.noticeForWindow(workspaceWindow?.projectId ?? activeProject?.id, id)
  const recoveryInputBlockReason = recoveryNotice?.blocksMutations
    ? 'Resolve this workspace recovery issue before continuing.'
    : null
  const mappedThreadId = getThreadForWindow(id)
  const persistedThreadId = workspaceWindow?.threadId ?? sessionThreadIdFromWindowId(id)
  const threadId = persistedThreadId ?? mappedThreadId
  const draftProjectId = workspaceWindow?.projectId ?? activeProject?.id ?? null
  const draftOwnerKey = draftProjectId ? composerDraftOwnerKey(draftProjectId, id, threadId) : null
  const {
    loaded: draftLoaded,
    restoredDraft,
    persist: persistDraft,
    beginSend: beginDraftSend,
    clear: clearDraft,
  } = useComposerDraftController(draftOwnerKey)
  const thread = threadId ? getThread(threadId) : undefined
  const boundTaskId = workspaceWindow?.taskId ?? null
  const activeTask = tasks?.tasks.find((task) => task.id === boundTaskId) ?? null
  const catalogProject = tasks?.projects.find((project) => project.id === (activeTask?.projectId ?? activeProject?.id)) ?? null
  const taskProject = useMemo(
    () => projectWithFreshLocalSettings(catalogProject, activeProject),
    [activeProject, catalogProject],
  )
  const taskTarget = activeTask?.location ?? workspaceWindow?.sessionTarget ?? 'local'
  const activeTaskContext = activeTask ? tasks?.executionContextForTask(activeTask.id) ?? null : null
  const recordedWorktreeBranch = activeTask?.worktreeId
    ? tasks?.managedWorktrees?.find((worktree) => worktree.id === activeTask.worktreeId)?.branch ?? null
    : null
  const taskGitSummary = useQuery({
    queryKey: ['task-git-summary', activeTask?.id, activeTaskContext?.checkoutPath],
    queryFn: () => window.cranberri.git.taskGithubSummary(activeTask!.id),
    enabled: Boolean(activeTask && activeTaskContext),
    refetchInterval: 2_000,
  })
  const activeTaskBranch = taskGitSummary.isSuccess ? taskGitSummary.data.branch : recordedWorktreeBranch
  const taskInputBlockReason = activeTask && activeTask.state !== 'local' && activeTask.state !== 'active'
    ? activeTask.state === 'archived'
      ? 'This session is archived. Restore it to continue.'
      : activeTask.state === 'failed'
        ? 'Worktree setup failed. Retry setup before continuing.'
        : activeTask.state === 'needsAttention'
          ? 'This worktree needs attention before the session can continue.'
          : 'This session is changing location. Wait for it to finish.'
    : null
  const inputBlockReason = recoveryInputBlockReason ?? taskInputBlockReason

  const [input, setInput] = useState('')
  const [turnSettings, setTurnSettings] = useState<CodexTurnSettings>(() => ({
    model: settings.codex.defaultModel,
    effort: settings.codex.defaultEffort,
    speed: settings.codex.defaultSpeed ?? 'standard',
    approvalMode: settings.codex.defaultApprovalMode,
  }))
  const [planMode, setPlanMode] = useState(false)
  const [goalMode, setGoalMode] = useState(false)
  const [baseRef, setBaseRef] = useState('HEAD')
  const [environmentId, setEnvironmentId] = useState<string | null>(null)
  const [branchOptions, setBranchOptions] = useState<Array<{ ref: string; label: string; remote?: string }>>([])
  const [environmentOptions, setEnvironmentOptions] = useState<import('@/shared/environments').EnvironmentRecord[]>([])
  const [loadingTargets, setLoadingTargets] = useState(false)
  const [partialRefFallback, setPartialRefFallback] = useState(false)
  const [includeLocalChanges, setIncludeLocalChanges] = useState(false)
  const [attachments, setAttachments] = useState<string[]>([])
  const [contextInputParts, setContextInputParts] = useState<ContextInputAttachment[]>([])
  const [voiceListening, setVoiceListening] = useState(false)
  const [skills, setSkills] = useState<CodexSkillInfo[]>([])
  const [plugins, setPlugins] = useState<CodexPluginInfo[]>([])
  const [composerMentions, setComposerMentions] = useState<ComposerMention[]>([])
  const [composerTriggerState, setComposerTriggerState] = useState<ComposerTrigger | null>(null)
  const [skillIndex, setSkillIndex] = useState(0)
  const [expandedGroupIds, setExpandedGroupIds] = useState<Set<string>>(new Set())
  const [composerInset, setComposerInset] = useState(188)
  const [showJumpToLatest, setShowJumpToLatest] = useState(false)
  const [resolvingApprovalId, setResolvingApprovalId] = useState<string | null>(null)
  const [handoffPrompt, setHandoffPrompt] = useState<{ taskId: string; location: 'local' | 'worktree'; branch: string } | null>(null)
  const [handoffBusy, setHandoffBusy] = useState(false)
  const [handoffError, setHandoffError] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const composerEditorRef = useRef<ComposerEditorHandle>(null)
  const composerRef = useRef<HTMLDivElement>(null)
  const composerHadFocusRef = useRef(false)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const shouldScrollToBottomRef = useRef(true)
  const lastTranscriptPositionRef = useRef<{ scrollTop: number; clientHeight: number } | null>(null)
  const speechRecognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const restoredSessionRef = useRef<string | null>(null)
  const restoredDraftOwnerRef = useRef<string | null>(null)
  const skipDraftPersistOwnerRef = useRef<string | null>(null)
  const sendInFlightRef = useRef(false)

  const buildComposerDraft = useCallback((text = input, mentions = composerMentions): ComposerDraft | null => {
    if (!draftOwnerKey || !draftProjectId) return null
    return {
      ownerKey: draftOwnerKey,
      projectId: draftProjectId,
      windowId: id,
      bindingRevision: workspaceWindow?.bindingRevision ?? 0,
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
  }, [
    attachments,
    baseRef,
    composerMentions,
    contextInputParts,
    draftOwnerKey,
    draftProjectId,
    environmentId,
    goalMode,
    id,
    includeLocalChanges,
    input,
    planMode,
    turnSettings,
    workspaceWindow?.bindingRevision,
  ])

  useEffect(() => {
    if (!draftOwnerKey || !draftLoaded || restoredDraftOwnerRef.current === draftOwnerKey) return
    restoredDraftOwnerRef.current = draftOwnerKey
    skipDraftPersistOwnerRef.current = draftOwnerKey
    const draft = restoredDraft
    if (!draft) return
    setInput(draft.text)
    setComposerMentions(draft.mentions)
    setAttachments(draft.attachmentPaths)
    setContextInputParts(draft.contextInputAttachments)
    setTurnSettings(draft.turnSettings)
    setPlanMode(draft.planMode)
    setGoalMode(draft.goalMode)
    setBaseRef(draft.baseRef)
    setEnvironmentId(draft.environmentId)
    setIncludeLocalChanges(draft.includeLocalChanges)
    if (draft.pendingSend) {
      toast.warning('Previous send was interrupted', {
        id: `composer-send-interrupted:${draftOwnerKey}`,
        description: 'Review the restored message before sending it again.',
      })
    }
  }, [draftLoaded, draftOwnerKey, restoredDraft])

  useEffect(() => {
    if (!draftOwnerKey || !draftLoaded || restoredDraftOwnerRef.current !== draftOwnerKey || sendInFlightRef.current) return
    if (skipDraftPersistOwnerRef.current === draftOwnerKey) {
      skipDraftPersistOwnerRef.current = null
      return
    }
    const draft = buildComposerDraft()
    if (!draft) return
    const timeout = window.setTimeout(() => {
      void persistDraft(draft).catch(() => {
        toast.error('Composer draft could not be saved', { id: 'composer-draft-save-failed' })
      })
    }, 150)
    return () => window.clearTimeout(timeout)
  }, [buildComposerDraft, draftLoaded, draftOwnerKey, persistDraft])

  const loadTaskTargets = useCallback(async (refreshRefs = false) => {
    if (!tasks || !taskProject || threadId || taskTarget !== 'worktree') return
    setLoadingTargets(true)
    try {
      const [refsResult, environments] = await Promise.all([
        tasks.loadRefs(taskProject.id, refreshRefs),
        tasks.loadEnvironments(taskProject.id),
      ])
      const options = refsResult.refs.map((ref) => ({
        ref: ref.fullName,
        label: ref.name,
        remote: ref.kind === 'remote' ? ref.name.split('/')[0] : undefined,
      }))
      setBranchOptions(options)
      setPartialRefFallback(Boolean(refsResult.refresh?.usedLocalFallback))
      setEnvironmentOptions(environments)
      const preferredRef = taskProject.pinnedLocalBranch
        ? `refs/heads/${taskProject.pinnedLocalBranch}`
        : options[0]?.ref
      if (preferredRef && options.some((option) => option.ref === preferredRef)) setBaseRef(preferredRef)
      const defaultEnvironment = environments.find((record) => record.manifest.environmentId === taskProject.defaultEnvironmentId)
      setEnvironmentId(defaultEnvironment && defaultEnvironment.manifest.trustedRevision === defaultEnvironment.manifest.currentRevision
        ? defaultEnvironment.manifest.environmentId
        : null)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to load task options')
    } finally {
      setLoadingTargets(false)
    }
  }, [taskProject, taskTarget, tasks, threadId])

  useEffect(() => { void loadTaskTargets(false) }, [loadTaskTargets])

  useEffect(() => {
    if (mappedThreadId || !persistedThreadId || restoredSessionRef.current === persistedThreadId) return
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
  }, [id, mappedThreadId, persistedThreadId, renameWindow, restoreSessionWindow])

  const scrollTranscriptToBottom = useCallback(() => {
    const container = scrollContainerRef.current
    if (!container) return
    container.scrollTop = Math.max(0, container.scrollHeight - container.clientHeight)
    lastTranscriptPositionRef.current = {
      scrollTop: container.scrollTop,
      clientHeight: container.clientHeight,
    }
  }, [])

  useEffect(() => {
    Promise.all([
      window.cranberri.codex.skills(),
      window.cranberri.codex.plugins(),
    ]).then(([skillResult, pluginResult]) => {
      setSkills(skillResult.skills)
      setPlugins(pluginResult.plugins.filter((plugin) => plugin.enabled))
    }).catch((err) => console.error('Failed to load Codex composer resources:', err))
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

  const insertChatContext = useCallback((detail: ChatContextPayload) => {
    setInput((current) => {
      return current.trim() ? `${current.trimEnd()}\n\n${detail.text}` : detail.text
    })
    const inputParts = detail.inputParts ?? []
    if (inputParts.length) {
      setContextInputParts((current) => [...current, ...inputParts.map(contextInputAttachment)])
    }
    const attachmentPaths = detail.attachmentPaths ?? []
    if (attachmentPaths.length) {
      setAttachments((current) => [...current, ...attachmentPaths.filter((filePath) => !current.includes(filePath))])
    }
    composerHadFocusRef.current = true
    requestAnimationFrame(() => {
      composerEditorRef.current?.focus('end')
    })
  }, [])

  useEffect(() => registerChatContextTarget(id, insertChatContext), [id, insertChatContext])

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
    setShowJumpToLatest(false)
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
    if (!shouldScrollToBottomRef.current) {
      setShowJumpToLatest(true)
      return
    }
    scrollTranscriptToBottom()
    setShowJumpToLatest(false)
  }, [composerInset, thread?.activityTurns, thread?.messages, thread?.pendingApprovals, thread?.isRunning, scrollTranscriptToBottom])

  const handleScroll = useCallback(() => {
    const container = scrollContainerRef.current
    if (!container) return
    const position = {
      scrollTop: container.scrollTop,
      clientHeight: container.clientHeight,
    }
    const readerMovedUp = didReaderMoveTranscriptUp(lastTranscriptPositionRef.current, position)
    lastTranscriptPositionRef.current = position
    const nearBottom = isTranscriptNearBottom(container.scrollHeight, container.scrollTop, container.clientHeight)
    if (!nearBottom && shouldScrollToBottomRef.current && !readerMovedUp) {
      setShowJumpToLatest(false)
      scrollTranscriptToBottom()
      return
    }
    shouldScrollToBottomRef.current = nearBottom
    setShowJumpToLatest(!nearBottom)
  }, [scrollTranscriptToBottom])

  const jumpToLatest = useCallback(() => {
    shouldScrollToBottomRef.current = true
    setShowJumpToLatest(false)
    scrollTranscriptToBottom()
  }, [scrollTranscriptToBottom])

  const insertComposerText = (text: string) => {
    composerEditorRef.current?.insertText(text)
  }

  const addTransferInputs = (transfer: DataTransfer): boolean => {
    const text = transfer.getData('text/plain')
    const files = transfer.files
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

  useLayoutEffect(() => {
    if (!composerHadFocusRef.current) return
    composerEditorRef.current?.focus()
  }, [thread?.messages.length, thread?.isRunning])

  const buildMessage = (text: string, mentions: readonly ComposerMention[]): { displayText: string; input: CodexUserInput[] } => {
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

    if (text) inputParts.push({ type: 'text', text })
    const skillMentions = mentions.filter((mention) => mention.kind === 'skill')
    const uniqueSkills = [...new Map(skillMentions.map((mention) => [mention.path, mention])).values()]
    inputParts.push(...uniqueSkills.map((skill) => ({ type: 'skill' as const, name: skill.name, path: skill.path })))

    return { displayText: text || 'Attached context', input: inputParts }
  }

  const handleSend = async (editorSnapshot?: ComposerSnapshot) => {
    if (inputBlockReason) {
      toast.error(inputBlockReason)
      return
    }
    const steeringActiveTurn = isRunning && !thread?.parentThreadId
    const currentSnapshot = editorSnapshot ?? composerEditorRef.current?.snapshot() ?? {
      text: input,
      plainText: input,
      mentions: composerMentions,
    }
    const currentInput = currentSnapshot.text
    const text = currentInput.trim()
    if (!text && attachments.length === 0 && contextInputParts.length === 0) return
    if (text === '/compact' && !threadId) return
    const draftInput = currentInput
    const draftAttachments = attachments
    const draftContextInputParts = contextInputParts
    const durableDraft = buildComposerDraft(currentInput, currentSnapshot.mentions)
    let journaledDraft: ComposerDraft | null = null
    if (durableDraft) {
      try {
        journaledDraft = await beginDraftSend(durableDraft, threadId)
      } catch {
        toast.error('Composer draft could not be saved. Message was not sent.', { id: 'composer-draft-send-journal-failed' })
        return
      }
    }
    sendInFlightRef.current = true
    let preparedThreadId: string | null = null
    let sendAcknowledged = false
    composerHadFocusRef.current = true
    setInput('')
    setComposerMentions([])
    setComposerTriggerState(null)
    setAttachments([])
    setContextInputParts([])

    try {
      if (text === '/compact' && !thread?.parentThreadId) {
        if (!threadId) return
        await compactThread(threadId)
      } else {
        const message = buildMessage(text, currentSnapshot.mentions)
        if (threadId) {
          if (thread?.parentThreadId) {
            await messageWorker(thread.parentThreadId, threadId, message.displayText, message.input)
          } else if (steeringActiveTurn) {
            await steerThread(threadId, message.displayText, message.input)
          } else {
            await sendMessage(threadId, message.displayText, message.input, turnSettings)
          }
        } else if (!threadId && tasks && taskProject) {
          if (taskTarget === 'worktree') {
            const selectedEnvironment = environmentOptions.find((record) => record.manifest.environmentId === environmentId)
            const environmentRevision = selectedEnvironment && selectedEnvironment.manifest.trustedRevision === selectedEnvironment.manifest.currentRevision
              ? selectedEnvironment.manifest.currentRevision
              : null
            await tasks.submitWorktree({
              draft: {
                projectId: taskProject.id,
                title: message.displayText.split('\n')[0]?.trim().slice(0, 160) || 'Task',
                baseRef,
                environmentId: environmentRevision ? environmentId : null,
                environmentRevision,
                input: message.input,
              },
              includeLocalChanges,
              settings: turnSettings,
            }, async (readyTask) => {
              preparedThreadId = readyTask.threadId
              const status = await window.cranberri.tasks.status(readyTask.id)
              if (!status.worktree) throw new Error('Provisioned worktree is unavailable')
              bindWindowToTask(id, {
                projectId: readyTask.projectId,
                taskId: readyTask.id,
                checkoutId: status.worktree.checkoutId,
                worktreeId: status.worktree.id,
                checkoutPath: status.worktree.path,
              })
              const hydrated = await bindTaskWindow(id, readyTask, message.displayText)
              renameWindow(id, hydrated.title)
            })
          } else {
            await tasks.submitLocal({
              projectId: taskProject.id,
              title: message.displayText.split('\n')[0]?.trim().slice(0, 160) || 'Local session',
              input: message.input,
            }, turnSettings, async (readyTask) => {
              preparedThreadId = readyTask.threadId
              const checkout = tasks.checkouts.find((candidate) => candidate.id === readyTask.checkoutId)
              if (!checkout) throw new Error('Local checkout is unavailable')
              bindWindowToTask(id, {
                projectId: readyTask.projectId,
                taskId: readyTask.id,
                checkoutId: readyTask.checkoutId,
                worktreeId: null,
                checkoutPath: checkout.canonicalPath,
              })
              const hydrated = await bindTaskWindow(id, readyTask, message.displayText)
              renameWindow(id, hydrated.title)
            })
          }
          invalidateSessions({ projectId: taskProject.id })
        } else {
          await createThread(id, message.displayText, turnSettings, message.input)
        }
      }
      sendAcknowledged = true
    } catch (error) {
      if (preparedThreadId) markThreadSendFailed(preparedThreadId, error)
      setInput(draftInput)
      setComposerMentions(currentSnapshot.mentions)
      setAttachments(draftAttachments)
      setContextInputParts(draftContextInputParts)
      if (journaledDraft) {
        const retryDraft: ComposerDraft = { ...journaledDraft, updatedAt: Date.now() }
        delete retryDraft.pendingSend
        void persistDraft(retryDraft).catch(() => {
          toast.error('Composer draft could not be saved', { id: 'composer-draft-save-failed' })
        })
      }
      toast.error(error instanceof Error ? error.message : 'Failed to send Codex message.')
    } finally {
      sendInFlightRef.current = false
      if (sendAcknowledged && durableDraft) {
        await clearDraft().catch(() => {
          toast.error('Sent, but the saved draft could not be cleared', { id: 'composer-draft-clear-failed' })
        })
      }
      requestAnimationFrame(() => composerEditorRef.current?.focus())
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
    composerHadFocusRef.current = true
    composerEditorRef.current?.insertDictation(transcript)
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
    composerEditorRef.current?.insertMention(pluginComposerMention(plugin))
  }

  const isRunning = thread?.isRunning ?? false
  const isWorkerThread = Boolean(thread?.parentThreadId)
  const hasComposerContent = Boolean(input.trim() || attachments.length > 0 || contextInputParts.length > 0)
  const primaryActionIsStop = isRunning && !hasComposerContent
  const handlePrimaryAction = async () => {
    const editorSnapshot = composerEditorRef.current?.snapshot()
    const editorInput = editorSnapshot?.text ?? input
    const hasCurrentComposerContent = Boolean(editorInput.trim() || attachments.length > 0 || contextInputParts.length > 0)
    if (!isRunning || hasCurrentComposerContent) {
      await handleSend(editorSnapshot)
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

  const composerCatalog = useMemo(() => [
    ...skills.map(skillComposerMention),
    ...plugins.map(pluginComposerMention),
  ], [plugins, skills])
  const compactPercentFull = Math.min(100, Math.round((contextUsage.usedTokens / Math.max(1, contextUsage.contextWindow)) * 100))
  const matchingSkills = composerTriggerState?.char === '$'
    ? skills.filter((skill) => {
        const haystack = `${skill.name} ${skill.displayName} ${skill.description}`.toLowerCase()
        return haystack.includes(composerTriggerState.query)
      })
    : []
  const matchingPlugins = composerTriggerState?.char === '@'
    ? plugins.filter((plugin) => {
        const haystack = `${plugin.name} ${plugin.displayName} ${plugin.description}`.toLowerCase()
        return haystack.includes(composerTriggerState.query)
      })
    : []
  const suggestions: ComposerSuggestion[] = composerTriggerState?.char === '/'
    ? ('compact'.includes(composerTriggerState.query)
        ? [{ id: 'command:compact', kind: 'command', label: '/compact', description: `Compact this thread's context (${compactPercentFull}% full)`, badge: 'Command' }]
        : [])
    : composerTriggerState?.char === '$'
      ? matchingSkills.map((skill) => ({
          id: `skill:${skill.id}`,
          kind: 'skill',
          label: `$${skill.name}`,
          description: skill.description,
          badge: skill.source === 'plugin' ? (skill.pluginName ?? 'Plugin') : skill.source === 'personal' ? 'Personal' : 'System',
          selected: composerMentions.some((mention) => mention.kind === 'skill' && mention.id === skill.id),
        }))
      : matchingPlugins.map((plugin) => ({
          id: `plugin:${plugin.id}`,
          kind: 'plugin',
          label: `@${plugin.name}`,
          description: plugin.description || plugin.prompt,
          badge: plugin.toolCount > 0 ? `${plugin.toolCount} tools` : 'Plugin',
          selected: composerMentions.some((mention) => mention.kind === 'plugin' && mention.id === plugin.id),
        }))
  const showSuggestions = Boolean(composerTriggerState && suggestions.length > 0)
  const suggestionTitle = composerTriggerState?.char === '$' ? 'Skills' : composerTriggerState?.char === '@' ? 'Plugins and context' : 'Commands'

  const insertSuggestion = (index: number) => {
    const trigger = composerTriggerState
    const suggestion = suggestions[index]
    if (!trigger || !suggestion || suggestion.selected) return
    if (suggestion.kind === 'command') composerEditorRef.current?.insertText('/compact ', trigger)
    else if (suggestion.kind === 'skill') {
      const skill = matchingSkills.find((candidate) => `skill:${candidate.id}` === suggestion.id)
      if (skill) composerEditorRef.current?.insertMention(skillComposerMention(skill), trigger)
    } else {
      const plugin = matchingPlugins.find((candidate) => `plugin:${candidate.id}` === suggestion.id)
      if (plugin) composerEditorRef.current?.insertMention(pluginComposerMention(plugin), trigger)
    }
    setSkillIndex(0)
  }

  const completeSuggestion = (index: number) => {
    const trigger = composerTriggerState
    const suggestion = suggestions[index]
    if (!trigger || !suggestion) return
    composerEditorRef.current?.insertText(suggestion.label, trigger)
    setSkillIndex(0)
  }

  const handleSuggestionKeyDown = (event: KeyboardEvent): boolean => {
    if (!showSuggestions) return false
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const direction = event.key === 'ArrowDown' ? 1 : -1
      setSkillIndex((index) => (index + direction + suggestions.length) % suggestions.length)
      return true
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      insertSuggestion(Math.min(skillIndex, suggestions.length - 1))
      return true
    }
    if (event.key === 'Tab') {
      event.preventDefault()
      completeSuggestion(Math.min(skillIndex, suggestions.length - 1))
      return true
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      setComposerTriggerState(null)
      setSkillIndex(0)
      return true
    }
    return false
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
      {activeTask ? <TaskHeader
        task={activeTask}
        branch={activeTaskBranch}
        onOpen={() => {
          const context = tasks?.executionContextForTask(activeTask.id)
          if (context) void window.cranberri.openPath(context.checkoutPath)
        }}
        onOpenTerminal={() => {
          const context = tasks?.executionContextForTask(activeTask.id)
          if (context) openTerminal(undefined, 'Terminal', activeTask.projectId, context)
        }}
        onHandoff={isRunning || (activeTask.state !== 'local' && activeTask.state !== 'active') ? undefined : async () => {
          if (activeTask.location === 'local' && !activeTask.worktreeId) {
            if (!tasks) return
            try {
              const result = await tasks.continueInWorktree(activeTask.id)
              const continued = result.task
              const status = await window.cranberri.tasks.status(continued.id)
              if (!status.worktree) throw new Error('Continued worktree is unavailable')
              bindWindowToTask(id, {
                projectId: continued.projectId,
                taskId: continued.id,
                checkoutId: status.worktree.checkoutId,
                worktreeId: status.worktree.id,
                checkoutPath: status.worktree.path,
              })
              if (result.warning) toast.error(`Continued in a worktree, but ${result.warning.toLowerCase()}`)
              else toast.success(result.includedLocalChanges ? 'Continued in a worktree with Local changes' : 'Continued in a worktree')
            } catch (error) {
              const status = await window.cranberri.tasks.status(activeTask.id).catch(() => null)
              if (status?.task.location === 'worktree' && status.worktree) {
                bindWindowToTask(id, {
                  projectId: status.task.projectId,
                  taskId: status.task.id,
                  checkoutId: status.worktree.checkoutId,
                  worktreeId: status.worktree.id,
                  checkoutPath: status.worktree.path,
                })
              }
              toast.error(errorMessage(error))
            }
            return
          }
          setHandoffError(null)
          setHandoffPrompt({
            taskId: activeTask.id,
            location: activeTask.location,
            branch: activeTask.baseRef?.replace(/^refs\/(heads|remotes)\//, '') ?? `codex/task-${activeTask.id.slice(0, 8)}`,
          })
        }}
        onRetrySetup={activeTask.state === 'failed' && activeTask.environmentRevision ? async () => {
          try { await tasks?.retrySetup(activeTask.id); toast.success('Environment ready') } catch (error) { toast.error(errorMessage(error)) }
        } : undefined}
        onArchive={isRunning ? undefined : async () => {
          try {
            await tasks?.archive(activeTask.id)
            invalidateSessions({ projectId: activeTask.projectId })
            toast.success('Session archived')
          } catch (error) { toast.error(errorMessage(error)) }
        }}
        onUnarchive={async () => {
          try {
            await tasks?.unarchive(activeTask.id)
            invalidateSessions({ projectId: activeTask.projectId })
            toast.success('Session restored')
          } catch (error) { toast.error(errorMessage(error)) }
        }}
      /> : !threadId && taskProject ? <DraftSessionHeader
        target={taskTarget}
        pinnedBranch={taskProject.pinnedLocalBranch}
        baseRef={baseRef}
        branches={branchOptions}
        environments={environmentOptions}
        environmentId={environmentId}
        loading={loadingTargets}
        partialFallback={partialRefFallback}
        includeLocalChanges={includeLocalChanges}
        onBaseRefChange={setBaseRef}
        onEnvironmentChange={setEnvironmentId}
        onIncludeLocalChanges={setIncludeLocalChanges}
        onRetry={() => { void loadTaskTargets(true) }}
      /> : null}
      {handoffPrompt && <PromptDialog
        title={handoffPrompt.location === 'worktree' ? 'Test branch in Local?' : 'Move branch to a worktree?'}
        description={handoffPrompt.location === 'worktree'
          ? 'Cranberri will check out this branch in the pinned Local workspace.'
          : 'Cranberri will continue this branch in its managed worktree.'}
        label="Branch"
        initialValue={handoffPrompt.branch}
        confirmLabel="Continue"
        busy={handoffBusy}
        error={handoffError}
        onCancel={() => { setHandoffPrompt(null); setHandoffError(null) }}
        onConfirm={(branch) => {
          if (!tasks || handoffBusy) return
          setHandoffBusy(true)
          setHandoffError(null)
          const operation = handoffPrompt.location === 'worktree'
            ? tasks.handoffToLocal({ taskId: handoffPrompt.taskId, branch, createBranch: true })
            : tasks.handoffToWorktree({ taskId: handoffPrompt.taskId, branch })
          void operation
            .then(() => setHandoffPrompt(null))
            .catch((error) => {
              console.error('Task handoff failed:', error)
              setHandoffError('The branch could not be moved. Review the checkout and try again.')
            })
            .finally(() => setHandoffBusy(false))
        }}
      />}
      {recoveryNotice && <StartupRecoveryNotice notice={recoveryNotice} />}
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
              resolvingApprovalId={resolvingApprovalId}
              onResolveApproval={(approvalId, decision) => { void resolveApproval(approvalId, decision) }}
            />
            <div ref={messagesEndRef} data-chat-transcript-end="true" />
          </div>
        </div>

        {showJumpToLatest && (
          <button
            type="button"
            onClick={jumpToLatest}
            aria-label="Jump to latest message"
            title="Jump to latest message"
            className="absolute left-1/2 z-[850] flex h-8 w-8 -translate-x-1/2 items-center justify-center rounded-full bg-app-surface text-app-text shadow-lg ring-1 ring-app-border/80 hover:bg-app-surface-2"
            style={{ bottom: composerInset + 10 }}
          >
            <ArrowDown className="h-4 w-4" />
          </button>
        )}

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
            {tasks && <TaskSetupStatus
              phase={tasks.operation.phase}
              onRetry={tasks.operation.phase === 'worktreeFailed' || tasks.operation.phase === 'setupFailed' ? () => { void tasks.retryProvisioning(turnSettings) } : undefined}
              onCancel={tasks.operation.phase === 'setup' ? () => { void tasks.cancelSetup() } : undefined}
              onInspect={tasks.operation.job?.logPath ? () => { void window.cranberri.openPath(tasks.operation.job!.logPath) } : undefined}
            />}
            <ContextInputChips
              attachments={contextInputParts}
              onRemove={(attachmentId) => setContextInputParts((current) => current.filter((item) => item.id !== attachmentId))}
            />
            {showSuggestions && (
              <ComposerSuggestionMenu
                title={suggestionTitle}
                suggestions={suggestions}
                activeIndex={Math.min(skillIndex, suggestions.length - 1)}
                usedTokens={contextUsage.usedTokens}
                contextWindow={contextUsage.contextWindow}
                onSelect={insertSuggestion}
              />
            )}
            <ComposerEditor
              ref={composerEditorRef}
              value={input}
              catalog={composerCatalog}
              disabled={Boolean(inputBlockReason)}
              onChange={(snapshot) => {
                setInput(snapshot.text)
                setComposerMentions(snapshot.mentions)
              }}
              onTriggerChange={(trigger) => {
                setComposerTriggerState(trigger)
                setSkillIndex(0)
              }}
              onSubmit={() => { void handleSend(composerEditorRef.current?.snapshot()) }}
              onSuggestionKeyDown={handleSuggestionKeyDown}
              onPaste={addTransferInputs}
              onDrop={addTransferInputs}
              placeholder={
                isRunning
                  ? isWorkerThread
                    ? 'Steer this worker through its parent...'
                    : 'Send a follow-up while Codex works...'
                  : goalMode
                    ? 'Describe your goal, define measurable outcomes for best results'
                    : inputBlockReason
                      ? inputBlockReason
                      : threadId
                        ? 'Ask for follow-up changes'
                        : 'Ask Codex to inspect, edit, or explain this repo'
              }
            />
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
                  disabled={primaryActionIsStop ? !threadId : !hasComposerContent || Boolean(inputBlockReason)}
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
