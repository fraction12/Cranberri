import fs from 'node:fs'
import { ipcMain } from 'electron'
import type { CranberriAppState, WorkspaceWindowState } from '../shared/appState'
import { incrementBindingRevision, readPersistedAppState, writePersistedAppState } from './appState'
import type { ProjectRegistry } from '../shared/projects'
import {
  startupRecoveryReportSchema,
  type RecoveryReason,
  type RecoveryStatus,
  type StartupRecoveryReport,
  type ThreadRecoveryStatus,
  type WindowRecoveryOutcome,
} from '../shared/recovery'
import type { Task } from '../shared/tasks'
import type { ManagedWorktree } from '../shared/worktrees'
import { readProjectRegistry } from './repos'
import { reconcileTaskStore, type TaskRecoveryResult } from './task-recovery'
import { TaskStore } from './task-store'

type AppStateRead = ReturnType<typeof readPersistedAppState>
type ThreadCheck = 'available' | 'missing' | 'unchecked'

export interface StartupRecoveryDependencies {
  taskStore: TaskStore
  readProjectRegistry: () => ProjectRegistry
  readAppState: () => AppStateRead
  writeAppState: (state: CranberriAppState) => CranberriAppState
  checkThread?: (threadId: string, task: Task | null) => Promise<ThreadCheck>
  now: () => number
}

const defaultDependencies: StartupRecoveryDependencies = {
  taskStore: new TaskStore(),
  readProjectRegistry,
  readAppState: readPersistedAppState,
  writeAppState: writePersistedAppState,
  now: Date.now,
}

let latestReport: StartupRecoveryReport | null = null

function outcome(
  window: WorkspaceWindowState,
  workspaceProjectId: string,
  status: RecoveryStatus,
  reason: RecoveryReason,
  message: string,
  threadStatus: ThreadRecoveryStatus = 'notApplicable',
): WindowRecoveryOutcome {
  return {
    windowId: window.id,
    workspaceProjectId,
    status,
    reason,
    message,
    bindingRevision: window.bindingRevision ?? 0,
    threadStatus,
  }
}

function managedCheckout(worktree: ManagedWorktree): {
  id: string
  projectId: string
  available: boolean
} {
  return {
    id: worktree.checkoutId,
    projectId: worktree.projectId,
    available: worktree.lifecycle !== 'removed'
      && worktree.lifecycle !== 'needsAttention'
      && worktree.lifecycle !== 'failed'
      && fs.existsSync(worktree.path),
  }
}

function operationOutcome(
  window: WorkspaceWindowState,
  workspaceProjectId: string,
  task: Task,
): WindowRecoveryOutcome | null {
  if (task.state === 'needsAttention' || task.handoff?.phase === 'needsAttention' || task.worktreeTransition?.phase === 'needsAttention') {
    return outcome(
      window,
      workspaceProjectId,
      'needsAttention',
      'interruptedOperation',
      'The bound task was interrupted and requires review before it can continue.',
    )
  }
  if (
    ['draft', 'provisioning', 'setup', 'failed', 'handingOff'].includes(task.state)
    || task.pendingFirstTurn?.delivery === 'pending'
    || task.pendingFirstTurn?.delivery === 'sending'
  ) {
    return outcome(
      window,
      workspaceProjectId,
      'retryable',
      'interruptedOperation',
      'The bound task has recoverable work that must be retried explicitly.',
    )
  }
  return null
}

async function validateWindow(
  window: WorkspaceWindowState,
  workspaceProjectId: string,
  registry: ProjectRegistry,
  tasks: Task[],
  worktrees: ManagedWorktree[],
  checkThread: StartupRecoveryDependencies['checkThread'],
): Promise<{ window: WorkspaceWindowState; outcome: WindowRecoveryOutcome; changed: boolean }> {
  const project = registry.projects.find((candidate) => candidate.id === workspaceProjectId)
  if (!project) {
    return { window, changed: false, outcome: outcome(window, workspaceProjectId, 'needsAttention', 'projectMissing', 'The window project is no longer registered.') }
  }
  if (window.projectId !== workspaceProjectId) {
    return { window, changed: false, outcome: outcome(window, workspaceProjectId, 'needsAttention', 'projectMismatch', 'The window project binding does not match its workspace.') }
  }

  const task = window.taskId
    ? tasks.find((candidate) => candidate.id === window.taskId) ?? null
    : null
  if (window.taskId && !task) {
    const localCheckout = registry.checkouts.find(
      (candidate) => candidate.id === project.localCheckoutId,
    )
    const isDeletedLocalControl = window.taskId === project.controlTaskId
      && window.checkoutId === project.localCheckoutId
      && window.sessionTarget === 'local'
      && localCheckout?.projectId === project.id
      && localCheckout.available
    if (!isDeletedLocalControl) {
      return { window, changed: false, outcome: outcome(window, workspaceProjectId, 'needsAttention', 'taskMissing', 'The bound task is missing; the window was not rebound to Local.') }
    }
    const repaired: WorkspaceWindowState = {
      ...window,
      taskId: null,
      checkoutId: project.localCheckoutId,
      sessionTarget: 'local',
      bindingRevision: incrementBindingRevision(window.bindingRevision ?? 0),
    }
    return {
      window: repaired,
      changed: true,
      outcome: outcome(repaired, workspaceProjectId, 'repaired', 'localControlDeleted', 'The retired Local control binding was repaired to this project Local checkout.'),
    }
  }

  if (task) {
    if (task.projectId !== project.id) {
      return { window, changed: false, outcome: outcome(window, workspaceProjectId, 'needsAttention', 'taskMismatch', 'The bound task belongs to another project.') }
    }
    if (task.checkoutId !== window.checkoutId || window.sessionTarget !== task.location) {
      return { window, changed: false, outcome: outcome(window, workspaceProjectId, 'needsAttention', 'checkoutMismatch', 'The window checkout does not match its task authority.') }
    }
    const interruptedFirstTurn = window.type === 'chat'
      && task.pendingFirstTurn?.delivery === 'pending'
      && !task.threadId
      && Boolean(window.threadId)
    if (
      window.type === 'chat'
      && !interruptedFirstTurn
      && task.threadId !== (window.threadId ?? null)
    ) {
      return { window, changed: false, outcome: outcome(window, workspaceProjectId, 'needsAttention', 'taskMismatch', 'The window thread does not match its task authority.') }
    }
    if (task.location === 'worktree') {
      const worktree = task.worktreeId
        ? worktrees.find((candidate) => candidate.id === task.worktreeId)
        : null
      if (!worktree || worktree.taskId !== task.id || worktree.checkoutId !== task.checkoutId) {
        return { window, changed: false, outcome: outcome(window, workspaceProjectId, 'needsAttention', 'worktreeMissing', 'The managed worktree binding is missing or no longer owns this task.') }
      }
      if (worktree.projectId !== project.id) {
        return { window, changed: false, outcome: outcome(window, workspaceProjectId, 'needsAttention', 'taskMismatch', 'The managed worktree belongs to another project.') }
      }
      if (!managedCheckout(worktree).available) {
        return { window, changed: false, outcome: outcome(window, workspaceProjectId, 'needsAttention', 'worktreeUnavailable', 'The managed worktree is unavailable; Local was not substituted.') }
      }
    }
  }

  if (!task && !window.taskId && (
    window.checkoutId !== project.localCheckoutId
    || window.sessionTarget !== 'local'
  )) {
    return { window, changed: false, outcome: outcome(window, workspaceProjectId, 'needsAttention', 'taskMissing', 'A non-Local checkout requires an authoritative task binding.') }
  }

  const registeredCheckout = registry.checkouts.find((candidate) => candidate.id === window.checkoutId)
  const boundWorktree = worktrees.find((candidate) => candidate.checkoutId === window.checkoutId)
  const checkout = registeredCheckout ?? (boundWorktree ? managedCheckout(boundWorktree) : null)
  if (!checkout) {
    return { window, changed: false, outcome: outcome(window, workspaceProjectId, 'needsAttention', 'checkoutMissing', 'The bound checkout is missing; Local was not substituted.') }
  }
  if (checkout.projectId !== project.id) {
    return { window, changed: false, outcome: outcome(window, workspaceProjectId, 'needsAttention', 'checkoutMismatch', 'The bound checkout belongs to another project.') }
  }
  if (!checkout.available) {
    return { window, changed: false, outcome: outcome(window, workspaceProjectId, 'needsAttention', 'checkoutUnavailable', 'The bound checkout is unavailable; Local was not substituted.') }
  }

  if (task) {
    if (
      window.type === 'chat'
      && task.pendingFirstTurn?.delivery === 'pending'
      && !task.threadId
      && window.threadId
    ) {
      const repaired = {
        ...window,
        threadId: undefined,
        bindingRevision: incrementBindingRevision(window.bindingRevision ?? 0),
      }
      return {
        window: repaired,
        changed: true,
        outcome: outcome(
          repaired,
          workspaceProjectId,
          'retryable',
          'interruptedOperation',
          'The empty prepared thread binding was cleared so the first turn can be retried explicitly.',
        ),
      }
    }
    const interrupted = operationOutcome(window, workspaceProjectId, task)
    if (interrupted) return { window, changed: false, outcome: interrupted }
  }

  if (window.type !== 'chat') {
    return { window, changed: false, outcome: outcome(window, workspaceProjectId, 'ready', 'none', 'The window binding is ready.') }
  }
  if (!window.threadId) {
    return { window, changed: false, outcome: outcome(window, workspaceProjectId, 'ready', 'none', 'The window binding is ready.') }
  }
  const threadStatus = checkThread ? await checkThread(window.threadId, task) : 'unchecked'
  if (threadStatus === 'missing') {
    return { window, changed: false, outcome: outcome(window, workspaceProjectId, 'needsAttention', 'threadMissing', 'The Codex thread was confirmed missing.', 'missing') }
  }
  if (threadStatus === 'unchecked') {
    return { window, changed: false, outcome: outcome(window, workspaceProjectId, 'retryable', 'threadUnchecked', 'Thread availability is unchecked and will be verified by the renderer.', 'unchecked') }
  }
  return { window, changed: false, outcome: outcome(window, workspaceProjectId, 'ready', 'none', 'The window binding is ready.', 'available') }
}

export async function reconcileStartup(
  partial: Partial<StartupRecoveryDependencies> = {},
): Promise<StartupRecoveryReport> {
  const dependencies = { ...defaultDependencies, ...partial }
  const taskRecovery: TaskRecoveryResult = await reconcileTaskStore(
    dependencies.taskStore,
    dependencies.now(),
  )
  const tasks = dependencies.taskStore.read()

  let appStateRead: AppStateRead
  try {
    appStateRead = dependencies.readAppState()
  } catch (error) {
    const report = startupRecoveryReportSchema.parse({
      appState: {
        status: 'needsAttention',
        source: 'unavailable',
        message: error instanceof Error ? error.message : 'App state is unavailable.',
      },
      taskStore: {
        status: taskRecovery.changed ? 'repaired' : 'ready',
        revision: tasks.revision,
        repairedTaskIds: taskRecovery.repairedTaskIds,
      },
      windows: [],
    })
    latestReport = report
    return report
  }

  const registry = dependencies.readProjectRegistry()
  const state = appStateRead.state
  let changed = appStateRead.source === 'backup'
  const windows: WindowRecoveryOutcome[] = []
  const workspacesByProjectId = { ...state.workspacesByProjectId }

  for (const [projectId, workspace] of Object.entries(state.workspacesByProjectId)) {
    let workspaceChanged = false
    const recoveredWindows: WorkspaceWindowState[] = []
    for (const window of workspace.windows) {
      const recovered = await validateWindow(
        window,
        projectId,
        registry,
        tasks.tasks,
        tasks.managedWorktrees,
        dependencies.checkThread,
      )
      recoveredWindows.push(recovered.window)
      windows.push(recovered.outcome)
      workspaceChanged ||= recovered.changed
    }
    if (workspaceChanged) {
      changed = true
      workspacesByProjectId[projectId] = { ...workspace, windows: recoveredWindows }
    }
  }

  if (changed) {
    dependencies.writeAppState({ ...state, workspacesByProjectId })
  }

  const report = startupRecoveryReportSchema.parse({
    appState: {
      status: changed ? 'repaired' : 'ready',
      source: appStateRead.source,
      message: appStateRead.source === 'backup'
        ? 'App state was restored from the last known good snapshot.'
        : changed
          ? 'Deterministic app-state repairs were persisted.'
          : 'App state is available.',
    },
    taskStore: {
      status: taskRecovery.changed ? 'repaired' : 'ready',
      revision: tasks.revision,
      repairedTaskIds: taskRecovery.repairedTaskIds,
    },
    windows,
  })
  latestReport = report
  return report
}

export function getStartupRecoveryReport(): StartupRecoveryReport | null {
  return latestReport
}

export function initStartupRecoveryIpc(): void {
  ipcMain.handle('recovery:read', () => latestReport)
  ipcMain.handle('recovery:retry', () => reconcileStartup())
}
