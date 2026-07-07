import z from 'zod'

export const updateStatusSchema = z.enum([
  'unknown',
  'checking',
  'upToDate',
  'updateAvailable',
  'blocked',
  'building',
  'readyToInstall',
  'installing',
  'failed',
])

export type UpdateStatus = z.infer<typeof updateStatusSchema>

export const updateBlockedReasonSchema = z.enum([
  'developmentMode',
  'noSourceRepo',
  'missingOrigin',
  'dirtySourceRepo',
  'sourceNotGitHub',
  'gitFetchFailed',
  'comparisonUnknown',
])

export type UpdateBlockedReason = z.infer<typeof updateBlockedReasonSchema>

export const updatePhaseSchema = z.enum([
  'preparing',
  'fetching',
  'dependencies',
  'building',
  'packaging',
  'readyToInstall',
  'backingUp',
  'replacing',
  'cleaningUp',
  'relaunching',
])

export type UpdatePhase = z.infer<typeof updatePhaseSchema>

export const updateInfoSchema = z.object({
  status: updateStatusSchema,
  currentCommit: z.string().nullable(),
  latestCommit: z.string().nullable(),
  commitsBehind: z.number().int().nullable(),
  sourceRepoPath: z.string().nullable(),
  sourceRepoDirty: z.boolean().nullable(),
  blockedReason: updateBlockedReasonSchema.nullable(),
  blockedMessage: z.string().nullable(),
  phase: updatePhaseSchema.nullable(),
  phaseMessage: z.string().nullable(),
  failedPhase: updatePhaseSchema.nullable(),
  failureMessage: z.string().nullable(),
  logPath: z.string().nullable(),
})

export type UpdateInfo = z.infer<typeof updateInfoSchema>

export const updateProgressSchema = z.object({
  phase: updatePhaseSchema,
  message: z.string(),
  percent: z.number().int().min(0).max(100).nullable(),
})

export type UpdateProgress = z.infer<typeof updateProgressSchema>

export const installResultSchema = z.object({
  success: z.boolean(),
  phase: updatePhaseSchema.nullable(),
  message: z.string().nullable(),
  logPath: z.string().nullable(),
})

export type InstallResult = z.infer<typeof installResultSchema>

export const installManifestSchema = z.object({
  currentAppPath: z.string(),
  stagedAppPath: z.string(),
  backupAppPath: z.string(),
  logPath: z.string(),
  resultManifestPath: z.string(),
  relaunchTarget: z.string(),
})

export type InstallManifest = z.infer<typeof installManifestSchema>

export type UpdateEvent =
  | { type: 'progress'; progress: UpdateProgress }
  | { type: 'status'; status: UpdateInfo }

