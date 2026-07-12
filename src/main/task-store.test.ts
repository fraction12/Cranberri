import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => ({ userDataPath: '' }))
vi.mock('electron', () => ({ app: { getPath: () => electron.userDataPath } }))
import { EMPTY_TASK_STORE, TaskStore } from './task-store'

const tempDirs: string[] = []
beforeEach(() => { electron.userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'cranberri-tasks-')); tempDirs.push(electron.userDataPath) })
afterEach(() => { for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }) })

describe('TaskStore', () => {
  const task = (id: string) => ({ id, projectId: 'project', threadId: null, checkoutId: 'local', worktreeId: null, role: 'root' as const, location: 'local' as const, state: 'draft' as const, baseRef: null, baseSha: null, environmentId: null, environmentRevision: null, pendingFirstTurn: null, createdAt: 1, updatedAt: 1 })

  it('persists nullable threads, pending first turns, and the Local lease', async () => {
    const store = new TaskStore()
    await store.update((state) => ({ ...state, localLeaseByProjectId: { project: 'task' }, tasks: [{ ...task('task'), baseRef: 'refs/heads/main', pendingFirstTurn: { payload: { input: [{ type: 'text', text: 'hello' }] }, delivery: 'pending' as const } }] }))
    expect(store.read()).toMatchObject({ localLeaseByProjectId: { project: 'task' }, tasks: [{ threadId: null, pendingFirstTurn: { delivery: 'pending' } }] })
  })

  it('migrates a revisionless v1 store to revision zero', () => {
    const target = path.join(electron.userDataPath, 'tasks.json')
    const legacy: Partial<typeof EMPTY_TASK_STORE> = structuredClone(EMPTY_TASK_STORE)
    Reflect.deleteProperty(legacy, 'revision')
    fs.writeFileSync(target, JSON.stringify(legacy))

    expect(new TaskStore().read().revision).toBe(0)
  })

  it('increments the persisted revision exactly once per successful update', async () => {
    const store = new TaskStore()

    const first = await store.update((state) => ({ ...state, revision: 99, tasks: [task('one')] }))
    const second = await store.update((state) => ({ ...state, tasks: [...state.tasks, task('two')] }))

    expect(first.revision).toBe(1)
    expect(second.revision).toBe(2)
    expect(store.read().revision).toBe(2)
  })

  it('notifies subscribers after commit with only derivable affected IDs', async () => {
    const store = new TaskStore()
    const subscriber = vi.fn(() => {
      expect(store.read().revision).toBe(1)
    })
    const unsubscribe = store.subscribe(subscriber)

    await store.update((state) => ({ ...state, tasks: [task('changed')] }))
    await store.update((state) => ({ ...state, localLeaseByProjectId: { project: 'changed' } }))
    unsubscribe()
    await store.update((state) => ({ ...state, interruptedOperations: [{ ignored: true }] }))

    expect(subscriber).toHaveBeenCalledTimes(2)
    expect(subscriber).toHaveBeenNthCalledWith(1, { revision: 1, affectedIds: ['changed'] })
    expect(subscriber).toHaveBeenNthCalledWith(2, { revision: 2 })
  })

  it('does not notify subscribers when the atomic commit fails', async () => {
    const store = new TaskStore()
    const subscriber = vi.fn()
    store.subscribe(subscriber)
    const rename = vi.spyOn(fs, 'renameSync').mockImplementationOnce(() => {
      throw new Error('rename failed')
    })

    await expect(store.update((state) => ({ ...state, tasks: [task('lost')] }))).rejects.toThrow('rename failed')

    rename.mockRestore()
    expect(subscriber).not.toHaveBeenCalled()
    expect(store.read().revision).toBe(0)
  })

  it('serializes two concurrent writes without dropping either task', async () => {
    const store = new TaskStore()
    const add = (id: string) => store.update(async (state) => { await new Promise((resolve) => setTimeout(resolve, id === 'one' ? 10 : 0)); return { ...state, tasks: [...state.tasks, task(id)] } })
    await Promise.all([add('one'), add('two')])
    expect(store.read().tasks.map((item) => item.id)).toEqual(['one', 'two'])
  })

  it('preserves corrupt authoritative bytes', () => {
    const target = path.join(electron.userDataPath, 'tasks.json'); fs.writeFileSync(target, 'broken'); const store = new TaskStore()
    expect(() => store.read()).toThrow(/task store/i); expect(fs.readFileSync(target, 'utf8')).toBe('broken')
  })

  it('resolves the default user-data path lazily', async () => {
    const store = new TaskStore()
    const nextUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'cranberri-tasks-late-path-'))
    tempDirs.push(nextUserData)
    electron.userDataPath = nextUserData

    await store.update((state) => ({ ...state, tasks: [task('late')] }))

    expect(fs.existsSync(path.join(nextUserData, 'tasks.json'))).toBe(true)
    expect(store.read().tasks[0]?.id).toBe('late')
  })
})
