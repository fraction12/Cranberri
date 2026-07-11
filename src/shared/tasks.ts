import { z } from 'zod'

export const pendingFirstTurnSchema = z.object({
  payload: z.object({
    input: z.array(z.record(z.string(), z.unknown())),
  }).passthrough(),
  delivery: z.enum(['pending', 'sending', 'acknowledged']),
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
  parentTaskId: z.string().nullable().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
  archivedAt: z.number().nullable().optional(),
})

export type PendingFirstTurn = z.infer<typeof pendingFirstTurnSchema>
export type Task = z.infer<typeof taskSchema>
