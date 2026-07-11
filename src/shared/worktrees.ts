import { z } from 'zod'

export const managedWorktreeSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  checkoutId: z.string().min(1),
  taskId: z.string().min(1).nullable(),
  path: z.string().min(1),
  recordedRoot: z.string().min(1),
  gitCommonDir: z.string().min(1),
  manifestPath: z.string().min(1),
  baseRef: z.string().nullable(),
  baseSha: z.string().min(1),
  branch: z.string().nullable(),
  headSha: z.string().nullable(),
  archiveHeadSha: z.string().nullable(),
  privateRef: z.string().nullable(),
  lifecycle: z.enum([
    'provisioning',
    'setup',
    'active',
    'handedOff',
    'archived',
    'cleanupBlocked',
    'needsAttention',
    'removed',
    'failed',
  ]),
  cleanupReason: z.string().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
  archivedAt: z.number().nullable(),
  environmentRevision: z.string().nullable().optional(),
})

export type ManagedWorktree = z.infer<typeof managedWorktreeSchema>
