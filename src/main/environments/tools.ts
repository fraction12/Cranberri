import { z } from 'zod'
import type { Task } from '../../shared/tasks'
import { parseEnvironmentToml } from './parser'
import type { EnvironmentRunner } from './runner'
import { EnvironmentStore } from './store'
import { readProjectRegistry, writeProjectRegistry } from '../repos'
import { TaskStore } from '../task-store'

const idSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/)
const baseSchema = z.object({ projectId: idSchema }).strict()
const environmentSchema = baseSchema.extend({ environmentId: idSchema })
const revisionSchema = environmentSchema.extend({ revision: z.string().regex(/^[a-f0-9]{64}$/) })

const argumentsByTool = {
  list: baseSchema,
  read: revisionSchema,
  create: environmentSchema.extend({ toml: z.string().min(1) }).strict(),
  update: environmentSchema.extend({ toml: z.string().min(1) }).strict(),
  validate: z.object({ toml: z.string().min(1) }).strict(),
  test: revisionSchema.extend({ baseRef: z.string().min(1).optional() }).strict(),
  'set-default': environmentSchema,
  delete: environmentSchema,
} as const

export type EnvironmentToolName = keyof typeof argumentsByTool

export interface EnvironmentToolApproval {
  kind: 'trust-revision' | 'delete-environment'
  projectId: string
  environmentId: string
  revision?: string
}

export interface EnvironmentToolRouterDependencies {
  store?: EnvironmentStore
  runner?: EnvironmentRunner
  taskStore?: TaskStore
  approve: (approval: EnvironmentToolApproval) => Promise<boolean>
}

export const environmentDynamicTools = Object.keys(argumentsByTool).map((name) => ({
  name,
  description: `Manage Cranberri environment profiles: ${name}.`,
  inputSchema: { type: 'object', additionalProperties: false },
}))

const toolCallSchema = z.object({
  threadId: z.string().min(1),
  namespace: z.string().optional(),
  tool: z.string().optional(),
  name: z.string().optional(),
  arguments: z.unknown().optional(),
  input: z.unknown().optional(),
}).passthrough()

export class EnvironmentToolRouter {
  private readonly store: EnvironmentStore
  private readonly runner: EnvironmentRunner | undefined
  private readonly taskStore: TaskStore

  constructor(private readonly dependencies: EnvironmentToolRouterDependencies) {
    this.store = dependencies.store ?? new EnvironmentStore()
    this.runner = dependencies.runner
    this.taskStore = dependencies.taskStore ?? new TaskStore()
  }

  async handle(raw: Record<string, unknown>, controlTask: Task): Promise<Record<string, unknown>> {
    const call = toolCallSchema.parse(raw)
    if (call.threadId !== controlTask.threadId || controlTask.role !== 'control') {
      throw new Error('Environment tools are available only in the Local control task')
    }
    if (call.namespace && call.namespace !== 'cranberri_environments') {
      throw new Error(`Unknown dynamic tool namespace: ${call.namespace}`)
    }
    const rawName = call.tool ?? call.name ?? ''
    const name = rawName.replace(/^cranberri_environments[./:]/, '') as EnvironmentToolName
    const schema = argumentsByTool[name]
    if (!schema) throw new Error(`Unknown environment tool: ${rawName || '<empty>'}`)
    const input = schema.parse(call.arguments ?? call.input ?? {}) as Record<string, string>
    if ('projectId' in input && input.projectId !== controlTask.projectId) {
      throw new Error('Environment tool project does not match the control task')
    }

    switch (name) {
      case 'list':
        return { environments: this.store.list(input.projectId) }
      case 'read':
        return { profile: this.store.readRevision(input.projectId, input.environmentId, input.revision) }
      case 'validate':
        return { valid: true, profile: parseEnvironmentToml(input.toml) }
      case 'create':
      case 'update':
        return { manifest: this.store.save(input.projectId, input.environmentId, input.toml) }
      case 'set-default': {
        const registry = readProjectRegistry()
        if (!this.store.list(input.projectId).some((item) => item.environmentId === input.environmentId)) {
          throw new Error('Environment not found')
        }
        writeProjectRegistry({
          ...registry,
          projects: registry.projects.map((project) => project.id === input.projectId
            ? { ...project, defaultEnvironmentId: input.environmentId }
            : project),
        })
        return { ok: true }
      }
      case 'test': {
        const approved = await this.dependencies.approve({
          kind: 'trust-revision',
          projectId: input.projectId,
          environmentId: input.environmentId,
          revision: input.revision,
        })
        if (!approved) throw new Error('Environment test was not approved')
        this.store.trust(input.projectId, input.environmentId, input.revision)
        const runner = this.runner ?? new (await import('./runner')).EnvironmentRunner()
        return { job: await runner.testEnvironment({
          projectId: input.projectId,
          environmentId: input.environmentId,
          revision: input.revision,
          baseRef: input.baseRef,
        }) }
      }
      case 'delete': {
        const approved = await this.dependencies.approve({
          kind: 'delete-environment',
          projectId: input.projectId,
          environmentId: input.environmentId,
        })
        if (!approved) throw new Error('Environment deletion was not approved')
        const references = this.taskStore.read().tasks.flatMap((task) =>
          task.environmentId && task.environmentRevision
            ? [{ projectId: task.projectId, environmentId: task.environmentId, revision: task.environmentRevision }]
            : [],
        )
        this.store.delete(input.projectId, input.environmentId, { references })
        return { ok: true }
      }
    }
  }
}
