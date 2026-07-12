import { z } from 'zod'

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

export type FirstTurnRecoveryAction = 'send' | 'acknowledge' | 'alreadyAcknowledged' | 'notFirstTurn'

export function firstTurnRecoveryAction(
  task: Task,
  requestInput: readonly Record<string, unknown>[],
  persistedTurnCount: number,
): FirstTurnRecoveryAction {
  const requestKey = firstTurnIdempotencyKey(requestInput)
  if (!requestKey) return 'notFirstTurn'
  if (task.firstTurnIdempotencyKey === requestKey) return 'alreadyAcknowledged'
  if (taskFirstTurnIdempotencyKey(task) !== requestKey) return 'notFirstTurn'
  if (task.pendingFirstTurn?.delivery === 'acknowledged') return 'alreadyAcknowledged'
  return task.pendingFirstTurn?.delivery === 'sending' && persistedTurnCount > 0
    ? 'acknowledge'
    : 'send'
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
