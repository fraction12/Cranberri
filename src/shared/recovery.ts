import { z } from 'zod'

export const recoveryStatusSchema = z.enum([
  'ready',
  'repaired',
  'retryable',
  'needsAttention',
])

export const recoveryReasonSchema = z.enum([
  'none',
  'localControlDeleted',
  'legacyBindingRestored',
  'projectMissing',
  'projectMismatch',
  'checkoutMissing',
  'checkoutUnavailable',
  'checkoutMismatch',
  'taskMissing',
  'taskMismatch',
  'worktreeMissing',
  'worktreeUnavailable',
  'interruptedOperation',
  'threadUnchecked',
  'threadMissing',
])

export const threadRecoveryStatusSchema = z.enum([
  'notApplicable',
  'unchecked',
  'available',
  'missing',
])

export const lifecycleRecoveryOutcomeSchema = z.object({
  taskId: z.string().min(1),
  operationId: z.string().min(1).nullable(),
  kind: z.enum(['archive', 'restore', 'delete', 'legacyArchive']),
  status: z.enum(['repaired', 'needsAttention']),
  reason: z.enum([
    'operationCompleted',
    'ignoredContent',
    'unsafeLegacyArchive',
    'threadMissing',
    'threadUnchecked',
    'executorBlocked',
    'authorityMismatch',
  ]),
  threadState: z.enum(['active', 'archived', 'missing']).nullable(),
  message: z.string().min(1),
}).strict()

export const windowRecoveryOutcomeSchema = z.object({
  windowId: z.string().min(1),
  workspaceProjectId: z.string().min(1),
  status: recoveryStatusSchema,
  reason: recoveryReasonSchema,
  message: z.string().min(1),
  bindingRevision: z.number().int().nonnegative().safe(),
  threadStatus: threadRecoveryStatusSchema,
}).strict()

export const startupRecoveryReportSchema = z.object({
  appState: z.object({
    status: recoveryStatusSchema,
    source: z.enum(['primary', 'backup', 'default', 'unavailable']),
    message: z.string().min(1),
  }).strict(),
  taskStore: z.object({
    status: recoveryStatusSchema,
    revision: z.number().int().nonnegative().safe(),
    repairedTaskIds: z.array(z.string().min(1)),
    message: z.string().min(1).optional(),
  }).strict(),
  lifecycle: z.array(lifecycleRecoveryOutcomeSchema).optional(),
  windows: z.array(windowRecoveryOutcomeSchema),
}).strict()

export type RecoveryStatus = z.infer<typeof recoveryStatusSchema>
export type RecoveryReason = z.infer<typeof recoveryReasonSchema>
export type ThreadRecoveryStatus = z.infer<typeof threadRecoveryStatusSchema>
export type LifecycleRecoveryOutcome = z.infer<typeof lifecycleRecoveryOutcomeSchema>
export type WindowRecoveryOutcome = z.infer<typeof windowRecoveryOutcomeSchema>
export type StartupRecoveryReport = z.infer<typeof startupRecoveryReportSchema>
