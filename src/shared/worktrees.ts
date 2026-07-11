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

export const gitRefSchema = z.object({
  name: z.string().min(1),
  fullName: z.string().min(1),
  sha: z.string().regex(/^[a-f0-9]{40,64}$/),
  kind: z.enum(['local', 'remote', 'tag']),
})

export const refRefreshResultSchema = z.object({
  refreshedRemotes: z.array(z.string()),
  failedRemotes: z.array(z.string()),
  usedLocalFallback: z.boolean(),
})

export const projectIdRequestSchema = z.object({ projectId: z.string().min(1) }).strict()
export const selectableRefsResultSchema = z.object({ refs: z.array(gitRefSchema) })
export const refreshRefsResultSchema = selectableRefsResultSchema.extend({ refresh: refRefreshResultSchema })

export type GitRef = z.infer<typeof gitRefSchema>
export type RefRefreshResult = z.infer<typeof refRefreshResultSchema>
export type SelectableRefsResult = z.infer<typeof selectableRefsResultSchema>
export type RefreshRefsResult = z.infer<typeof refreshRefsResultSchema>
