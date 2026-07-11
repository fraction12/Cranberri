import { z } from 'zod'

export const terminalIdentitySchema = z.object({
  projectId: z.string().min(1),
  taskId: z.string().min(1),
  checkoutId: z.string().min(1),
  worktreeId: z.string().min(1).nullable(),
})

export const environmentJobKindSchema = z.enum(['setup', 'test'])

export const environmentJobStatusSchema = z.enum([
  'running',
  'succeeded',
  'failed',
  'cancelled',
])

export const environmentJobSchema = z.object({
  id: z.string().min(1),
  kind: environmentJobKindSchema,
  identity: terminalIdentitySchema,
  environmentId: z.string().min(1),
  revision: z.string().regex(/^[a-f0-9]{64}$/),
  status: environmentJobStatusSchema,
  pid: z.number().int().positive().nullable(),
  output: z.string(),
  logPath: z.string().min(1),
  startedAt: z.number().int().nonnegative(),
  endedAt: z.number().int().nonnegative().nullable(),
  exitCode: z.number().int().nullable(),
  signal: z.union([z.number(), z.string()]).nullable(),
})

export const environmentSetupRequestSchema = z.object({
  taskId: z.string().min(1),
})

export const environmentTestRequestSchema = z.object({
  projectId: z.string().min(1),
  environmentId: z.string().min(1),
  revision: z.string().regex(/^[a-f0-9]{64}$/),
  baseRef: z.string().min(1).optional(),
})

export const environmentJobIdRequestSchema = z.object({ jobId: z.string().min(1) })
export const environmentJobWriteRequestSchema = environmentJobIdRequestSchema.extend({ data: z.string() })
export const environmentActionRequestSchema = z.object({
  taskId: z.string().min(1),
  actionId: z.string().regex(/^[a-z][a-z0-9-]*$/),
})

export const taskTerminalCreateRequestSchema = z.object({
  id: z.string().min(1),
  taskId: z.string().min(1),
  cols: z.number().int().positive().optional(),
  rows: z.number().int().positive().optional(),
})

export type TaskTerminalCreateRequest = z.infer<typeof taskTerminalCreateRequestSchema>

export const environmentJobDataEventSchema = z.object({ jobId: z.string(), data: z.string() })
export const environmentJobExitEventSchema = z.object({
  jobId: z.string(),
  status: environmentJobStatusSchema,
  exitCode: z.number().int().nullable(),
  signal: z.union([z.number(), z.string()]).nullable(),
})

export type TerminalIdentity = z.infer<typeof terminalIdentitySchema>
export type EnvironmentJob = z.infer<typeof environmentJobSchema>
export type EnvironmentSetupRequest = z.infer<typeof environmentSetupRequestSchema>
export type EnvironmentTestRequest = z.infer<typeof environmentTestRequestSchema>
export type EnvironmentActionRequest = z.infer<typeof environmentActionRequestSchema>
export type EnvironmentJobDataEvent = z.infer<typeof environmentJobDataEventSchema>
export type EnvironmentJobExitEvent = z.infer<typeof environmentJobExitEventSchema>
