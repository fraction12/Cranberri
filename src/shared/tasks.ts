import { z } from 'zod'
import type { CodexSdkTurn } from './codex'

const firstTurnIdempotencyKeySchema = z.string().min(1).max(512)
const FIRST_TURN_IDEMPOTENCY_PROPERTY = '__cranberriFirstTurnIdempotencyKey'

export const pendingFirstTurnSchema = z.object({
  payload: z.object({
    input: z.array(z.record(z.string(), z.unknown())),
  }).passthrough(),
  delivery: z.enum(['pending', 'sending', 'acknowledged']),
})

export const worktreeTransitionSchema = z.object({
  phase: z.enum(['provisioning', 'setup', 'resuming', 'needsAttention']),
  previousCheckoutId: z.string().min(1),
  previousBaseRef: z.string().nullable(),
  previousBaseSha: z.string().nullable(),
  previousEnvironmentId: z.string().nullable(),
  previousEnvironmentRevision: z.string().nullable(),
  startedAt: z.number(),
  error: z.string().nullable(),
})

export const taskSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  threadId: z.string().min(1).nullable(),
  checkoutId: z.string().min(1),
  worktreeId: z.string().min(1).nullable(),
  role: z.enum(['control', 'root', 'worker']),
  location: z.enum(['local', 'worktree']),
  state: z.enum([
    'draft',
    'provisioning',
    'setup',
    'active',
    'handingOff',
    'local',
    'archived',
    'cleanupBlocked',
    'needsAttention',
    'removed',
    'failed',
  ]),
  baseRef: z.string().nullable(),
  baseSha: z.string().nullable(),
  environmentId: z.string().nullable(),
  environmentRevision: z.string().nullable(),
  pendingFirstTurn: pendingFirstTurnSchema.nullable(),
  firstTurnIdempotencyKey: firstTurnIdempotencyKeySchema.nullable().optional(),
  worktreeTransition: worktreeTransitionSchema.nullable().optional(),
  parentTaskId: z.string().nullable().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
  archivedAt: z.number().nullable().optional(),
  handoff: z.object({
    direction: z.enum(['toLocal', 'toWorktree']),
    phase: z.enum(['preflight', 'captured', 'branchReleased', 'applied', 'resumed', 'rollback', 'needsAttention']),
    branch: z.string().min(1),
    bundlePath: z.string().min(1).nullable(),
    startedAt: z.number(),
    error: z.string().nullable(),
  }).nullable().optional(),
})

export type PendingFirstTurn = z.infer<typeof pendingFirstTurnSchema>
export type Task = z.infer<typeof taskSchema>

export function firstTurnIdempotencyKey(input: readonly Record<string, unknown>[]): string | null {
  for (const item of input) {
    const parsed = firstTurnIdempotencyKeySchema.safeParse(item[FIRST_TURN_IDEMPOTENCY_PROPERTY])
    if (parsed.success) return parsed.data
  }
  return null
}

export function withFirstTurnIdempotencyKey<T extends Record<string, unknown>>(
  input: readonly T[],
  idempotencyKey: string,
): T[] {
  const parsedKey = firstTurnIdempotencyKeySchema.parse(idempotencyKey)
  if (input.length === 0) throw new Error('First-turn input cannot be empty')
  return input.map((item, index) => index === 0
    ? { ...item, [FIRST_TURN_IDEMPOTENCY_PROPERTY]: parsedKey }
    : { ...item })
}

export function withoutFirstTurnIdempotencyKey<T extends Record<string, unknown>>(input: readonly T[]): T[] {
  return input.map((item) => {
    const copy = { ...item }
    delete copy[FIRST_TURN_IDEMPOTENCY_PROPERTY]
    return copy
  })
}

export function taskFirstTurnIdempotencyKey(task: Task): string | null {
  if (task.firstTurnIdempotencyKey) return task.firstTurnIdempotencyKey
  return task.pendingFirstTurn
    ? firstTurnIdempotencyKey(task.pendingFirstTurn.payload.input)
    : null
}

export type PersistedFirstTurnState = 'empty' | 'matching' | 'conflicting'
export type FirstTurnRecoveryAction = 'send' | 'acknowledge' | 'alreadyAcknowledged' | 'notFirstTurn' | 'needsAttention'

function canonicalFirstTurnInput(item: Record<string, unknown> | string): Record<string, unknown> | null {
  if (typeof item === 'string') return { type: 'text', text: item, text_elements: [] }
  if (item.type === 'text' && typeof item.text === 'string') {
    return {
      type: 'text',
      text: item.text,
      text_elements: Array.isArray(item.text_elements) ? item.text_elements : [],
    }
  }
  if (item.type === 'image' && typeof item.url === 'string') {
    return { type: 'image', url: item.url, ...(typeof item.detail === 'string' ? { detail: item.detail } : {}) }
  }
  if (item.type === 'localImage' && typeof item.path === 'string') {
    return { type: 'localImage', path: item.path, ...(typeof item.detail === 'string' ? { detail: item.detail } : {}) }
  }
  if ((item.type === 'skill' || item.type === 'mention') && typeof item.name === 'string' && typeof item.path === 'string') {
    return { type: item.type, name: item.name, path: item.path }
  }
  return null
}

export function persistedFirstTurnState(
  turns: readonly CodexSdkTurn[],
  expectedInput: readonly Record<string, unknown>[],
): PersistedFirstTurnState {
  if (turns.length === 0) return 'empty'
  if (turns.length !== 1) return 'conflicting'
  const expected = withoutFirstTurnIdempotencyKey(expectedInput).map(canonicalFirstTurnInput)
  if (expected.length === 0 || expected.some((item) => item === null)) return 'conflicting'
  const actual = (turns[0]?.items ?? []).flatMap((item) => {
    if (item.type !== 'userMessage' || !Array.isArray(item.content)) return []
    return [item.content.map(canonicalFirstTurnInput)]
  })
  if (actual.length !== 1 || actual[0].some((item) => item === null)) return 'conflicting'
  return JSON.stringify(actual[0]) === JSON.stringify(expected) ? 'matching' : 'conflicting'
}

export function firstTurnRecoveryAction(
  task: Task,
  requestInput: readonly Record<string, unknown>[],
  persistedState: PersistedFirstTurnState,
): FirstTurnRecoveryAction {
  const requestKey = firstTurnIdempotencyKey(requestInput)
  if (!requestKey) return 'notFirstTurn'
  if (task.firstTurnIdempotencyKey === requestKey) return 'alreadyAcknowledged'
  if (taskFirstTurnIdempotencyKey(task) !== requestKey) return 'notFirstTurn'
  if (task.pendingFirstTurn?.delivery === 'acknowledged') return 'alreadyAcknowledged'
  if (task.pendingFirstTurn?.delivery !== 'sending') return 'send'
  if (persistedState === 'matching') return 'acknowledge'
  return persistedState === 'empty' ? 'send' : 'needsAttention'
}

export const taskIdRequestSchema = z.object({ taskId: z.string().min(1) }).strict()
export const taskListRequestSchema = z.object({ projectId: z.string().min(1).optional() }).strict()
export const taskSendRequestSchema = z.object({
  taskId: z.string().min(1),
  input: z.array(z.record(z.string(), z.unknown())).min(1),
  settings: z.unknown().optional(),
}).strict()
export const taskReadRequestSchema = taskIdRequestSchema.extend({ archived: z.boolean().optional() })
export const taskHistoryRequestSchema = z.object({
  projectId: z.string().min(1),
  archived: z.boolean().optional(),
  cursor: z.string().nullable().optional(),
  limit: z.number().int().min(1).max(100).optional(),
  searchTerm: z.string().nullable().optional(),
}).strict()

export const taskDraftRequestSchema = z.object({
  projectId: z.string().min(1),
  title: z.string().trim().min(1).max(160),
  baseRef: z.string().min(1),
  environmentId: z.string().min(1).nullable(),
  environmentRevision: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  input: z.array(z.record(z.string(), z.unknown())).min(1),
}).strict()
export const localTaskDraftRequestSchema = z.object({
  projectId: z.string().min(1),
  title: z.string().trim().min(1).max(160),
  input: z.array(z.record(z.string(), z.unknown())).min(1),
}).strict()
export const localTaskAdoptRequestSchema = z.object({
  projectId: z.string().min(1),
  threadId: z.string().min(1),
  archived: z.boolean().default(false),
}).strict()
export const taskContinueInWorktreeRequestSchema = taskIdRequestSchema
export const taskProvisionRequestSchema = z.object({
  taskId: z.string().min(1),
  includeLocalChanges: z.boolean().default(false),
}).strict()
export const taskHandoffRequestSchema = z.object({
  taskId: z.string().min(1),
  branch: z.string().trim().min(1),
  createBranch: z.boolean().optional(),
}).strict()

export type TaskIdRequest = z.infer<typeof taskIdRequestSchema>
export type TaskSendRequest = z.infer<typeof taskSendRequestSchema>
export type TaskHistoryRequest = z.infer<typeof taskHistoryRequestSchema>
export type TaskDraftRequest = z.infer<typeof taskDraftRequestSchema>
export type LocalTaskDraftRequest = z.infer<typeof localTaskDraftRequestSchema>
export type LocalTaskAdoptRequest = z.infer<typeof localTaskAdoptRequestSchema>
export type TaskProvisionRequest = z.infer<typeof taskProvisionRequestSchema>
export type TaskHandoffRequest = z.infer<typeof taskHandoffRequestSchema>
