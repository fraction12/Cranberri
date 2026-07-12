import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ArrowDown } from 'lucide-react'
import { useCodexActions, useCodexThreads, useCodexWindows } from '../state/codex'
import { useWorkspace } from '../state/workspace'
import { useSettings } from '../state/settings'
import { useOptionalTasks } from '../state/tasks'
import { useRepos } from '../state/repos'
import { useRecovery } from '../state/recovery'
import { invalidateSessions } from '../state/session-invalidation'
import { useChatComposer, type ChatComposerSubmission } from '../state/use-chat-composer'
import { ChatComposer } from './chat/ChatComposer'
import { taskHandoffProposal } from './chat/task-handoff'
import {
  NEW_THREAD_EMPTY_STATE,
  didReaderMoveTranscriptUp,
  isTranscriptNearBottom,
  projectWithFreshLocalSettings,
  sessionThreadIdFromWindowId,
} from './chat/chat-window-state'
import { TranscriptList } from './chat/TranscriptList'
import { DraftSessionHeader } from './chat/DraftSessionHeader'
import { TaskHeader } from './chat/TaskHeader'
import { TaskSetupStatus } from './chat/TaskSetupStatus'
import { StartupRecoveryNotice } from './chat/StartupRecoveryNotice'
import { PromptDialog } from './PromptDialog'
import { cn } from '../lib/ui'
import { typeStyle } from '../lib/typography'

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Task action failed'
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
  const threadId = persistedThreadId ?? mappedThreadId ?? null
  const draftProjectId = workspaceWindow?.projectId ?? activeProject?.id ?? null
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

  const [baseRef, setBaseRef] = useState('HEAD')
  const [environmentId, setEnvironmentId] = useState<string | null>(null)
  const [branchOptions, setBranchOptions] = useState<Array<{ ref: string; label: string; remote?: string }>>([])
  const [environmentOptions, setEnvironmentOptions] = useState<import('@/shared/environments').EnvironmentRecord[]>([])
  const [loadingTargets, setLoadingTargets] = useState(false)
  const [partialRefFallback, setPartialRefFallback] = useState(false)
  const [includeLocalChanges, setIncludeLocalChanges] = useState(false)
  const [expandedGroupIds, setExpandedGroupIds] = useState<Set<string>>(new Set())
  const [composerInset, setComposerInset] = useState(188)
  const [showJumpToLatest, setShowJumpToLatest] = useState(false)
  const [resolvingApprovalId, setResolvingApprovalId] = useState<string | null>(null)
  const [handoffPrompt, setHandoffPrompt] = useState<{
    taskId: string
    location: 'local' | 'worktree'
    branch: string
    createBranch: boolean
  } | null>(null)
  const [handoffBusy, setHandoffBusy] = useState(false)
  const [handoffError, setHandoffError] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const shouldScrollToBottomRef = useRef(true)
  const lastTranscriptPositionRef = useRef<{ scrollTop: number; clientHeight: number } | null>(null)
  const restoredSessionRef = useRef<string | null>(null)

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

  const isRunning = thread?.isRunning ?? false
  const isWorkerThread = Boolean(thread?.parentThreadId)
  const estimatedTokens = useMemo(
    () => Math.ceil((thread?.messages.reduce((total, message) => total + message.content.length, 0) ?? 0) / 4),
    [thread?.messages],
  )
  const contextUsage = thread?.contextUsage ?? { usedTokens: estimatedTokens, contextWindow: 258400 }

  const dispatchComposerSubmission = async (submission: ChatComposerSubmission): Promise<void> => {
    let preparedThreadId: string | null = null
    try {
      if (submission.text === '/compact' && !thread?.parentThreadId) {
        if (!threadId) return
        await compactThread(threadId)
      } else if (threadId) {
        if (thread?.parentThreadId) {
          await messageWorker(thread.parentThreadId, threadId, submission.displayText, submission.input)
        } else if (isRunning) {
          await steerThread(threadId, submission.displayText, submission.input)
        } else {
          await sendMessage(threadId, submission.displayText, submission.input, submission.turnSettings)
        }
      } else if (tasks && taskProject) {
        if (taskTarget === 'worktree') {
          const selectedEnvironment = environmentOptions.find((record) => record.manifest.environmentId === environmentId)
          const environmentRevision = selectedEnvironment && selectedEnvironment.manifest.trustedRevision === selectedEnvironment.manifest.currentRevision
            ? selectedEnvironment.manifest.currentRevision
            : null
          await tasks.submitWorktree({
            draft: {
              projectId: taskProject.id,
              title: submission.displayText.split('\n')[0]?.trim().slice(0, 160) || 'Task',
              baseRef,
              environmentId: environmentRevision ? environmentId : null,
              environmentRevision,
              input: submission.input,
            },
            includeLocalChanges,
            settings: submission.turnSettings,
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
            const hydrated = await bindTaskWindow(id, readyTask, submission.displayText)
            renameWindow(id, hydrated.title)
          })
        } else {
          await tasks.submitLocal({
            projectId: taskProject.id,
            title: submission.displayText.split('\n')[0]?.trim().slice(0, 160) || 'Local session',
            input: submission.input,
          }, submission.turnSettings, async (readyTask) => {
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
            const hydrated = await bindTaskWindow(id, readyTask, submission.displayText)
            renameWindow(id, hydrated.title)
          })
        }
        invalidateSessions({ projectId: taskProject.id })
      } else {
        await createThread(id, submission.displayText, submission.turnSettings, submission.input)
      }
    } catch (error) {
      if (preparedThreadId) markThreadSendFailed(preparedThreadId, error)
      throw error
    }
  }

  const composer = useChatComposer({
    windowId: id,
    projectId: draftProjectId,
    bindingRevision: workspaceWindow?.bindingRevision ?? 0,
    threadId,
    isRunning,
    inputBlockReason,
    initialTurnSettings: {
      model: settings.codex.defaultModel,
      effort: settings.codex.defaultEffort,
      speed: settings.codex.defaultSpeed ?? 'standard',
      approvalMode: settings.codex.defaultApprovalMode,
    },
    baseRef,
    environmentId,
    includeLocalChanges,
    contextUsage,
    focusRestoreKey: `${thread?.messages.length ?? 0}:${isRunning}`,
    onRestoreBaseRef: setBaseRef,
    onRestoreEnvironment: setEnvironmentId,
    onRestoreIncludeLocalChanges: setIncludeLocalChanges,
    onComposerInsetChange: setComposerInset,
    onDispatch: dispatchComposerSubmission,
    onAbort: async () => {
      if (!threadId) return
      try {
        await abort(threadId)
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Failed to stop Codex.')
      }
    },
  })
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
          const proposal = taskHandoffProposal({
            taskId: activeTask.id,
            location: activeTask.location,
            activeBranch: activeTaskBranch ?? null,
            recordedWorktreeBranch,
          })
          setHandoffError(null)
          setHandoffPrompt({
            taskId: activeTask.id,
            location: activeTask.location,
            ...proposal,
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
            ? tasks.handoffToLocal({ taskId: handoffPrompt.taskId, branch, createBranch: handoffPrompt.createBranch })
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
            {(!thread || thread.messages.length === 0) && !composer.hasContent && (
              <div className={cn(typeStyle({ role: 'metadata', tone: 'secondary' }), 'pt-16 text-center')}>
                {NEW_THREAD_EMPTY_STATE}
              </div>
            )}
            <TranscriptList
              thread={thread}
              skills={composer.skills}
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

        <ChatComposer
          composer={composer}
          contextUsage={contextUsage}
          isRunning={isRunning}
          isWorkerThread={isWorkerThread}
          threadId={threadId}
          inputBlockReason={inputBlockReason}
          setupStatus={tasks ? (
            <TaskSetupStatus
              phase={tasks.operation.phase}
              onRetry={tasks.operation.phase === 'worktreeFailed' || tasks.operation.phase === 'setupFailed' ? () => { void tasks.retryProvisioning(composer.turnSettings) } : undefined}
              onCancel={tasks.operation.phase === 'setup' ? () => { void tasks.cancelSetup() } : undefined}
              onInspect={tasks.operation.job?.logPath ? () => { void window.cranberri.openPath(tasks.operation.job!.logPath) } : undefined}
            />
          ) : undefined}
        />
      </div>
    </div>
  )
}
