import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { taskSchema } from '../shared/tasks'
import { managedWorktreeSchema } from '../shared/worktrees'

export const taskStoreSchema = z.object({
  version: z.literal(1),
  tasks: z.array(taskSchema),
  managedWorktrees: z.array(managedWorktreeSchema),
  localLeaseByProjectId: z.record(z.string(), z.string().nullable()),
  interruptedOperations: z.array(z.record(z.string(), z.unknown())),
})

export type TaskStoreState = z.infer<typeof taskStoreSchema>

export const EMPTY_TASK_STORE: TaskStoreState = {
  version: 1,
  tasks: [],
  managedWorktrees: [],
  localLeaseByProjectId: {},
  interruptedOperations: [],
}

function emptyTaskStore(): TaskStoreState {
  return structuredClone(EMPTY_TASK_STORE)
}

export class TaskStore {
  private writes: Promise<void> = Promise.resolve()
  private readonly targetPath: string

  constructor(targetPath = path.join(app.getPath('userData'), 'tasks.json')) {
    this.targetPath = targetPath
  }

  read(): TaskStoreState {
    if (!fs.existsSync(this.targetPath)) return emptyTaskStore()
    try {
      return taskStoreSchema.parse(JSON.parse(fs.readFileSync(this.targetPath, 'utf8')))
    } catch (error) {
      throw new Error('Cannot read authoritative task store', { cause: error })
    }
  }

  update(updater: (state: TaskStoreState) => TaskStoreState | Promise<TaskStoreState>): Promise<TaskStoreState> {
    let result!: TaskStoreState
    const operation = this.writes.then(async () => {
      result = taskStoreSchema.parse(await updater(this.read()))
      this.write(result)
    })
    this.writes = operation.catch(() => undefined)
    return operation.then(() => result)
  }

  private write(state: TaskStoreState): void {
    const temporary = `${this.targetPath}.${process.pid}.tmp`
    fs.mkdirSync(path.dirname(this.targetPath), { recursive: true })
    try {
      fs.writeFileSync(temporary, JSON.stringify(state, null, 2))
      fs.renameSync(temporary, this.targetPath)
    } catch (error) {
      fs.rmSync(temporary, { force: true })
      throw error
    }
  }
}
