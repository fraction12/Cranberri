import { app } from 'electron'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { taskSchema } from '../shared/tasks'
import { managedWorktreeSchema } from '../shared/worktrees'

export const taskStoreSchema = z.object({
  version: z.literal(1),
  revision: z.number().int().nonnegative().safe().default(0),
  tasks: z.array(taskSchema),
  managedWorktrees: z.array(managedWorktreeSchema),
  localLeaseByProjectId: z.record(z.string(), z.string().nullable()),
  interruptedOperations: z.array(z.record(z.string(), z.unknown())),
})

export type TaskStoreState = z.infer<typeof taskStoreSchema>

export const EMPTY_TASK_STORE: TaskStoreState = {
  version: 1,
  revision: 0,
  tasks: [],
  managedWorktrees: [],
  localLeaseByProjectId: {},
  interruptedOperations: [],
}

export interface TaskStoreCommittedChange {
  revision: number
  affectedIds?: string[]
}

type TaskStoreSubscriber = (change: TaskStoreCommittedChange) => void

function changedIds<T extends { id: string }>(before: T[], after: T[]): string[] {
  const beforeById = new Map(before.map((item) => [item.id, JSON.stringify(item)]))
  const afterById = new Map(after.map((item) => [item.id, JSON.stringify(item)]))
  return [...new Set([...beforeById.keys(), ...afterById.keys()])]
    .filter((id) => beforeById.get(id) !== afterById.get(id))
    .sort()
}

function affectedIds(before: TaskStoreState, after: TaskStoreState): string[] | undefined {
  const ids = [
    ...changedIds(before.tasks, after.tasks),
    ...changedIds(before.managedWorktrees, after.managedWorktrees),
  ]
  return ids.length ? [...new Set(ids)].sort() : undefined
}

function emptyTaskStore(): TaskStoreState {
  return structuredClone(EMPTY_TASK_STORE)
}

export class TaskStore {
  private writes: Promise<void> = Promise.resolve()
  private readonly subscribers = new Set<TaskStoreSubscriber>()

  constructor(private readonly configuredPath?: string) {}

  private targetPath(): string {
    return this.configuredPath ?? path.join(app.getPath('userData'), 'tasks.json')
  }

  read(): TaskStoreState {
    const targetPath = this.targetPath()
    if (!fs.existsSync(targetPath)) return emptyTaskStore()
    try {
      return taskStoreSchema.parse(JSON.parse(fs.readFileSync(targetPath, 'utf8')))
    } catch (error) {
      throw new Error('Cannot read authoritative task store', { cause: error })
    }
  }

  subscribe(subscriber: TaskStoreSubscriber): () => void {
    this.subscribers.add(subscriber)
    return () => this.subscribers.delete(subscriber)
  }

  update(updater: (state: TaskStoreState) => TaskStoreState | Promise<TaskStoreState>): Promise<TaskStoreState> {
    let result!: TaskStoreState
    const operation = this.writes.then(async () => {
      const current = this.read()
      const validated = taskStoreSchema.parse(await updater(current))
      if (current.revision >= Number.MAX_SAFE_INTEGER) throw new Error('Task store revision exhausted')
      result = { ...validated, revision: current.revision + 1 }
      this.write(result)
      const changed = affectedIds(current, result)
      const change: TaskStoreCommittedChange = {
        revision: result.revision,
        ...(changed ? { affectedIds: changed } : {}),
      }
      for (const subscriber of this.subscribers) {
        try {
          subscriber(change)
        } catch (error) {
          console.error('Task store subscriber failed:', error)
        }
      }
    })
    this.writes = operation.catch(() => undefined)
    return operation.then(() => result)
  }

  private write(state: TaskStoreState): void {
    const targetPath = this.targetPath()
    const temporary = `${targetPath}.${process.pid}.tmp`
    fs.mkdirSync(path.dirname(targetPath), { recursive: true })
    try {
      fs.writeFileSync(temporary, JSON.stringify(state, null, 2))
      fs.renameSync(temporary, targetPath)
    } catch (error) {
      if (fs.existsSync(temporary)) {
        try {
          execFileSync('/usr/bin/trash', [temporary], { stdio: 'ignore' })
        } catch {
          // Preserve the temporary file when recoverable cleanup is unavailable.
        }
      }
      throw error
    }
  }
}
