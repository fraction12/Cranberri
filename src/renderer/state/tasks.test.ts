import { describe, expect, it, vi } from 'vitest'
import type { Checkout } from '@/shared/projects'
import type { Task } from '@/shared/tasks'
import {
  reduceTaskAuthorityRevision,
  reduceTaskCatalogSnapshot,
  projectCatalogIdentity,
  provisionAndSendFirstTurn,
  selectableRootTasks,
  taskExecutionContext,
  type TaskOperation,
  type WorktreeSubmissionApi,
} from './tasks'

describe('task authority reducers', () => {
  it('accepts only newer task authority revisions', () => {
    expect(reduceTaskAuthorityRevision(4, { authority: 'tasks', revision: 5, affectedIds: ['task'] })).toBe(5)
    expect(reduceTaskAuthorityRevision(5, { authority: 'tasks', revision: 5 })).toBe(5)
    expect(reduceTaskAuthorityRevision(5, { authority: 'tasks', revision: 3 })).toBe(5)
  })

  it('rejects stale snapshots while allowing same-revision manual refreshes', () => {
    const current = { revision: 5, projects: [], checkouts: [], tasks: [], managedWorktrees: [] }
    const stale = { ...current, revision: 4 }
    const sameRevision = { ...current, projects: [{ id: 'project' }] } as typeof current

    expect(reduceTaskCatalogSnapshot(current, stale)).toBe(current)
    expect(reduceTaskCatalogSnapshot(current, sameRevision)).toBe(sameRevision)
  })

  it('changes project catalog identity when a repository is registered after startup', () => {
    const registered = [{
      id: 'project',
      localCheckoutId: 'local-project',
      gitCommonDir: '/repo/.git',
    }]

    expect(projectCatalogIdentity([])).not.toBe(projectCatalogIdentity(registered))
    expect(projectCatalogIdentity([...registered])).toBe(projectCatalogIdentity(registered))
  })
})

function task(id: string, role: Task['role'], updatedAt: number): Task {
  return {
    id,
    projectId: 'project-1',
    threadId: `thread-${id}`,
    checkoutId: `checkout-${id}`,
    worktreeId: `worktree-${id}`,
    role,
    location: 'worktree',
    state: 'active',
    baseRef: 'main',
    baseSha: 'abc',
    environmentId: null,
    environmentRevision: null,
    pendingFirstTurn: null,
    createdAt: updatedAt - 1,
    updatedAt,
  }
}

describe('task selectors', () => {
  it('returns control and root tasks newest-first while excluding workers', () => {
    const tasks = [task('old', 'root', 10), task('worker', 'worker', 30), task('new', 'root', 20)]
    expect(selectableRootTasks(tasks).map((candidate) => candidate.id)).toEqual(['new', 'old'])
  })

  it('does not resolve an unavailable checkout', () => {
    const root = task('root', 'root', 10)
    const checkout: Checkout = {
      id: root.checkoutId,
      projectId: root.projectId,
      kind: 'managed',
      canonicalPath: '/worktree/root',
      gitCommonDir: '/repo/.git',
      ownership: 'cranberri',
      available: false,
    }
    expect(taskExecutionContext(root, [checkout])).toBeNull()
  })
})

describe('worktree submission recovery', () => {
  it('retries an existing provisioned task without creating another draft or worktree', async () => {
    const existing = task('retry', 'root', 10)
    existing.threadId = null
    existing.state = 'failed'
    existing.environmentId = null
    const api: WorktreeSubmissionApi = {
      createDraft: vi.fn(),
      provision: vi.fn(),
      startSetup: vi.fn(),
      waitForSetup: vi.fn(),
      send: vi.fn().mockResolvedValue({ ...existing, state: 'active' }),
    }

    await provisionAndSendFirstTurn(api, {
      draft: {
        projectId: existing.projectId,
        title: 'Retry me',
        baseRef: 'refs/heads/main',
        environmentId: null,
        environmentRevision: null,
        input: [{ type: 'text', text: 'Retry me' }],
      },
      includeLocalChanges: false,
    }, () => undefined, existing)

    expect(api.createDraft).not.toHaveBeenCalled()
    expect(api.provision).not.toHaveBeenCalled()
    expect(api.send).toHaveBeenCalledWith(existing.id, expect.any(Array), undefined)
  })

  it('binds the provisioned task before sending the first turn', async () => {
    const existing = task('ready', 'root', 10)
    existing.threadId = null
    existing.environmentId = null
    const order: string[] = []
    const ready = { ...existing, threadId: 'thread-ready' }
    const api: WorktreeSubmissionApi = {
      createDraft: vi.fn(),
      provision: vi.fn(),
      startSetup: vi.fn(),
      waitForSetup: vi.fn(),
      send: vi.fn().mockImplementation(async () => {
        order.push('send')
        return ready
      }),
    }

    await provisionAndSendFirstTurn(api, {
      draft: {
        projectId: existing.projectId,
        title: 'Ready first',
        baseRef: 'refs/heads/main',
        environmentId: null,
        environmentRevision: null,
        input: [{ type: 'text', text: 'Ready first' }],
      },
      includeLocalChanges: false,
    }, () => undefined, existing, async () => {
      order.push('ready')
      return ready
    })

    expect(order).toEqual(['ready', 'send'])
  })

  it('retains the completed setup job when setup fails', async () => {
    const existing = task('setup', 'root', 10)
    existing.threadId = null
    existing.state = 'setup'
    existing.environmentId = 'node'
    existing.environmentRevision = 'a'.repeat(64)
    const failedJob = {
      id: 'job',
      kind: 'setup' as const,
      identity: {
        projectId: existing.projectId,
        taskId: existing.id,
        checkoutId: existing.checkoutId,
        worktreeId: existing.worktreeId,
      },
      environmentId: 'node',
      revision: 'a'.repeat(64),
      status: 'failed' as const,
      pid: 1,
      output: 'failed',
      logPath: '/tmp/setup.log',
      startedAt: 1,
      endedAt: 2,
      exitCode: 1,
      signal: null,
    }
    const api: WorktreeSubmissionApi = {
      createDraft: vi.fn(),
      provision: vi.fn(),
      startSetup: vi.fn().mockResolvedValue({ ...failedJob, status: 'running' }),
      waitForSetup: vi.fn().mockResolvedValue(failedJob),
      send: vi.fn(),
    }
    const operations: TaskOperation[] = []

    await expect(provisionAndSendFirstTurn(api, {
      draft: {
        projectId: existing.projectId,
        title: 'Setup',
        baseRef: 'refs/heads/main',
        environmentId: 'node',
        environmentRevision: 'a'.repeat(64),
        input: [{ type: 'text', text: 'Setup' }],
      },
      includeLocalChanges: false,
    }, (operation) => operations.push(operation), existing)).rejects.toThrow(/failed/)

    expect(operations.at(-1)).toMatchObject({
      phase: 'setupFailed',
      taskId: existing.id,
      job: { id: 'job', logPath: '/tmp/setup.log', status: 'failed' },
    })
  })
})
