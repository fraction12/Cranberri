import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProjectRegistry } from '../../shared/projects'
import type { Task } from '../../shared/tasks'

const electron = vi.hoisted(() => ({ userDataPath: '' }))
vi.mock('electron', () => ({
  app: {
    getPath: () => electron.userDataPath,
    whenReady: () => new Promise(() => undefined),
    isPackaged: false,
    setPath: vi.fn(),
    on: vi.fn(),
  },
  ipcMain: { handle: vi.fn() },
  protocol: { registerSchemesAsPrivileged: vi.fn() },
  nativeTheme: {},
}))
vi.mock('../index', () => ({ getMainWindow: () => null }))

import { TaskStore } from '../task-store'
import { WorktreeLifecycle } from '../worktree-lifecycle'
import { EnvironmentRunner } from './runner'
import { EnvironmentStore } from './store'

const roots: string[] = []

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
}

function profile(script: string, inherit: string[] = []): string {
  return `version = 1\nname = "Test"\n[setup]\nscript = ${JSON.stringify(script)}\n[cranberri]\ninherit = ${JSON.stringify(inherit)}\n`
}

async function fixture(script: string, inherit: string[] = []) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cranberri-runner-'))
  roots.push(root)
  electron.userDataPath = root
  const repo = path.join(root, 'repo')
  const managedRoot = path.join(root, 'managed')
  fs.mkdirSync(repo)
  git(repo, 'init', '-b', 'main')
  git(repo, 'config', 'user.name', 'Cranberri Test')
  git(repo, 'config', 'user.email', 'test@cranberri.local')
  fs.writeFileSync(path.join(repo, 'tracked.txt'), 'tracked\n')
  git(repo, 'add', '.')
  git(repo, 'commit', '-m', 'initial')

  const taskStore = new TaskStore(path.join(root, 'tasks.json'))
  const lifecycle = new WorktreeLifecycle(taskStore)
  const environmentStore = new EnvironmentStore(path.join(root, 'environments'))
  const manifest = environmentStore.save('project', 'test', profile(script, inherit))
  environmentStore.trust('project', 'test', manifest.currentRevision)
  const worktree = await lifecycle.create({
    projectId: 'project', projectName: 'Project', taskId: 'task', taskName: 'Task',
    localCheckoutPath: repo, managedRoot, baseRef: 'main', cap: 15,
  })
  const task: Task = {
    id: 'task', projectId: 'project', threadId: null, checkoutId: worktree.checkoutId,
    worktreeId: worktree.id, role: 'root', location: 'worktree', state: 'setup',
    baseRef: 'main', baseSha: worktree.baseSha, environmentId: 'test',
    environmentRevision: manifest.currentRevision, pendingFirstTurn: null,
    createdAt: Date.now(), updatedAt: Date.now(), archivedAt: null,
  }
  await taskStore.update((state) => ({ ...state, tasks: [task] }))
  const registry: ProjectRegistry = {
    version: 1,
    projects: [{
      id: 'project', name: 'Project', gitCommonDir: fs.realpathSync(path.join(repo, '.git')),
      localCheckoutId: 'local', pinnedLocalBranch: 'main', defaultEnvironmentId: 'test',
      controlTaskId: 'control', localLeaseTaskId: 'control',
    }],
    checkouts: [{
      id: 'local', projectId: 'project', kind: 'local', canonicalPath: repo,
      gitCommonDir: fs.realpathSync(path.join(repo, '.git')), ownership: 'user', available: true,
    }],
    activeProjectId: 'project',
  }
  const runner = new EnvironmentRunner({
    taskStore, worktrees: lifecycle, environmentStore,
    readProjects: () => registry,
    readWorktreeSettings: () => ({ root: managedRoot, cap: 15 }),
    logsRoot: path.join(root, 'logs'),
    hostEnv: { PATH: process.env.PATH, HOME: process.env.HOME, ALLOWED: 'yes', SECRET: 'no' },
    platform: process.platform,
  })
  return { root, repo, managedRoot, taskStore, lifecycle, environmentStore, manifest, worktree, runner, registry }
}

beforeEach(() => { electron.userDataPath = '' })
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe('EnvironmentRunner', () => {
  it('runs setup in a managed worktree, filters env, logs privately, and accepts PTY input', async () => {
    const setup = await fixture('printf "Prompt:"; read answer; printf "%s|%s|%s" "$answer" "$ALLOWED" "${SECRET-unset}"; touch setup.marker', ['ALLOWED'])
    const started = await setup.runner.startSetup({ taskId: 'task' })
    await vi.waitFor(() => expect(setup.runner.snapshot(started.id).output).toContain('Prompt:'))
    setup.runner.write(started.id, 'hello\n')
    const finished = await setup.runner.wait(started.id)

    expect(finished.status).toBe('succeeded')
    expect(finished.output).toContain('hello|yes|unset')
    expect(fs.existsSync(path.join(setup.worktree.path, 'setup.marker'))).toBe(true)
    expect(fs.statSync(finished.logPath).mode & 0o777).toBe(0o600)
    expect(setup.taskStore.read().tasks[0].state).toBe('active')
  })

  it('retains retryable state on failure and refuses an untrusted exact revision', async () => {
    const setup = await fixture('printf failure; exit 7')
    const started = await setup.runner.startSetup({ taskId: 'task' })
    expect((await setup.runner.wait(started.id)).status).toBe('failed')
    expect(setup.taskStore.read().managedWorktrees[0].lifecycle).toBe('failed')

    setup.environmentStore.save('project', 'test', profile('true'))
    await expect(setup.runner.retrySetup({ taskId: 'task' })).rejects.toThrow(/not trusted/i)
  })

  it('cancels a running PTY job', async () => {
    const setup = await fixture('printf started; sleep 30')
    const started = await setup.runner.startSetup({ taskId: 'task' })
    await vi.waitFor(() => expect(setup.runner.snapshot(started.id).output).toContain('started'))
    setup.runner.cancel(started.id)
    expect((await setup.runner.wait(started.id)).status).toBe('cancelled')
  })

  it('provisions a temporary managed worktree for tests and removes it only when clean', async () => {
    const setup = await fixture('true')
    const started = await setup.runner.testEnvironment({
      projectId: 'project', environmentId: 'test', revision: setup.manifest.currentRevision,
    })
    expect((await setup.runner.wait(started.id)).status).toBe('succeeded')
    const testWorktree = setup.taskStore.read().managedWorktrees.find((item) => item.taskId?.startsWith('environment-test-'))
    expect(testWorktree?.lifecycle).toBe('removed')
    expect(fs.existsSync(testWorktree!.path)).toBe(false)
  })
})
