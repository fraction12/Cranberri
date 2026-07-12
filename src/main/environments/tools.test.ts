import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Task } from '../../shared/tasks'
import type { EnvironmentRunner } from './runner'
import { EnvironmentStore } from './store'
import { environmentDynamicTools, EnvironmentToolRouter } from './tools'
import { TaskStore } from '../task-store'

const roots: string[] = []
const toml = 'version = 1\nname = "Node"\n\n[setup]\nscript = "npm install"\n'

function fixture(approve = vi.fn(async () => true)) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cranberri-environment-tools-'))
  roots.push(root)
  const store = new EnvironmentStore(path.join(root, 'environments'))
  const taskStore = new TaskStore(path.join(root, 'tasks.json'))
  const testEnvironment = vi.fn(async () => ({ id: 'job' }))
  const router = new EnvironmentToolRouter({
    store,
    taskStore,
    runner: { testEnvironment } as unknown as EnvironmentRunner,
    approve,
  })
  const control: Task = {
    id: 'control', projectId: 'project', threadId: 'thread', checkoutId: 'local',
    worktreeId: null, role: 'root', location: 'local', state: 'local', baseRef: null,
    baseSha: null, environmentId: null, environmentRevision: null, pendingFirstTurn: null,
    createdAt: 1, updatedAt: 1,
  }
  return { router, store, taskStore, approve, testEnvironment, control }
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe('EnvironmentToolRouter', () => {
  it('advertises the arguments required by each dynamic tool', () => {
    const create = environmentDynamicTools.find((tool) => tool.name === 'create')
    expect(create?.inputSchema).toEqual(expect.objectContaining({
      type: 'object',
      required: expect.arrayContaining(['projectId', 'environmentId', 'toml']),
      properties: expect.objectContaining({
        projectId: expect.any(Object),
        environmentId: expect.any(Object),
        toml: expect.any(Object),
      }),
    }))
  })

  it('allows validated reads and edits only on the bound Local project session', async () => {
    const { router, store, control } = fixture()
    const created = await router.handle({
      threadId: 'thread', namespace: 'cranberri_environments', tool: 'create',
      arguments: { projectId: 'project', environmentId: 'node', toml },
    }, control)
    expect(created.manifest).toEqual(expect.objectContaining({ trustedRevision: null }))
    expect(store.list('project')).toHaveLength(1)

    await expect(router.handle({
      threadId: 'other', tool: 'list', arguments: { projectId: 'project' },
    }, control)).rejects.toThrow(/Local project session/)
    await expect(router.handle({
      threadId: 'thread', tool: 'create', arguments: { projectId: 'project' },
    }, control)).rejects.toThrow()
  })

  it('requires exact-revision approval before a test and trusts only that revision', async () => {
    const { router, store, approve, testEnvironment, control } = fixture()
    const manifest = store.save('project', 'node', toml)
    await router.handle({
      threadId: 'thread', tool: 'test', arguments: {
        projectId: 'project', environmentId: 'node', revision: manifest.currentRevision,
      },
    }, control)

    expect(approve).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'trust-revision', revision: manifest.currentRevision,
    }))
    expect(store.readManifest('project', 'node').trustedRevision).toBe(manifest.currentRevision)
    expect(testEnvironment).toHaveBeenCalledOnce()
  })

  it('routes deletion through confirmation and refuses referenced revisions', async () => {
    const { router, store, taskStore, approve, control } = fixture()
    const manifest = store.save('project', 'node', toml)
    await taskStore.update((state) => ({ ...state, tasks: [{
      ...control, environmentId: 'node', environmentRevision: manifest.currentRevision,
    }] }))
    await expect(router.handle({
      threadId: 'thread', tool: 'delete', arguments: { projectId: 'project', environmentId: 'node' },
    }, control)).rejects.toThrow(/referenced revisions/)
    expect(approve).toHaveBeenCalledWith(expect.objectContaining({ kind: 'delete-environment' }))
  })
})
