import { z } from 'zod'

export const toolEventStatusSchema = z.enum([
  'pending',
  'running',
  'progress',
  'approval_requested',
  'approved',
  'denied',
  'completed',
  'failed',
  'disabled',
])

export const toolEventKindSchema = z.enum([
  'command',
  'file_change',
  'mcp',
  'dynamic',
  'collab',
  'approval',
  'web_search',
  'image',
  'unknown',
])

export const toolEventSchema = z.object({
  eventId: z.string().min(1),
  threadId: z.string().min(1),
  toolCallId: z.string().min(1).optional(),
  catalogId: z.string().min(1).optional(),
  name: z.string().min(1),
  title: z.string().min(1).optional(),
  kind: toolEventKindSchema,
  status: toolEventStatusSchema,
  timestamp: z.string().min(1),
  argumentsPreview: z.string().optional(),
  resultPreview: z.string().optional(),
  error: z.string().optional(),
  errorCode: z.string().min(1).optional(),
  durationMs: z.number().nonnegative().nullable().optional(),
  reviewId: z.string().optional(),
  server: z.string().optional(),
  connectorId: z.string().nullable().optional(),
  connectorName: z.string().nullable().optional(),
})

export const toolRegistryAppSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().nullable(),
  logoUrl: z.string().nullable(),
  enabled: z.boolean(),
  accessible: z.boolean(),
  distributionChannel: z.string().nullable(),
  pluginDisplayNames: z.array(z.string()),
})

export const toolRegistryMcpToolSchema = z.object({
  name: z.string().min(1),
  title: z.string().nullable(),
  description: z.string().nullable(),
})

export const toolRegistryMcpServerSchema = z.object({
  name: z.string().min(1),
  authStatus: z.string().min(1),
  toolCount: z.number().int().nonnegative(),
  resourceCount: z.number().int().nonnegative(),
  resourceTemplateCount: z.number().int().nonnegative(),
  tools: z.array(toolRegistryMcpToolSchema),
})

export const toolRegistrySnapshotSchema = z.object({
  generatedAt: z.string().min(1),
  apps: z.array(toolRegistryAppSchema),
  mcpServers: z.array(toolRegistryMcpServerSchema),
  capabilities: z.object({
    appList: z.boolean(),
    mcpServerStatus: z.boolean(),
    errors: z.array(z.string()),
  }),
})

const toolCatalogIdComponent = '(?:[A-Za-z0-9._~-]|%[0-9A-F]{2})+'
const toolCatalogIdPattern = new RegExp(
  `^(?:(?:codex|cli):${toolCatalogIdComponent}|(?:browser|mcp):${toolCatalogIdComponent}:${toolCatalogIdComponent})$`,
)

export const toolCatalogIdSchema = z.string().regex(toolCatalogIdPattern)

export const toolCatalogSourceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('codex') }).strict(),
  z.object({ kind: z.literal('cli') }).strict(),
  z.object({
    kind: z.literal('browser'),
    providerId: z.string().min(1),
    providerName: z.string().min(1).optional(),
  }).strict(),
  z.object({
    kind: z.literal('mcp'),
    providerId: z.string().min(1),
    providerName: z.string().min(1).optional(),
  }).strict(),
])

export const toolCatalogMachineStatusSchema = z.enum([
  'unknown',
  'available',
  'installed',
  'missing',
  'connected',
  'disconnected',
  'authentication-required',
])

export const toolCatalogTaskStatusSchema = z.enum([
  'no-active-task',
  'unknown',
  'addressable',
  'usable',
  'unavailable',
  'authentication-required',
  'approval-required',
  'denied',
])

export const toolCatalogMachineProvenanceSchema = z.enum([
  'none',
  'local-probe',
  'global-registry',
  'active-task-inventory',
  'stale-thread-fallback',
  'last-good',
])

export const toolCatalogTaskProvenanceSchema = z.enum([
  'none',
  'no-active-task',
  'global-registry',
  'stale-thread-fallback',
  'active-task-inventory',
  'machine-unavailable',
  'authoritative-capability',
  'same-task-started',
  'same-task-success',
  'same-task-failure',
  'same-task-denied',
  'same-task-authentication',
  'same-task-approval',
])

export const toolCatalogProbeCapabilitySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('automatic') }).strict(),
  z.object({ kind: z.literal('manual-only'), reason: z.string().min(1) }).strict(),
  z.object({ kind: z.literal('unsupported'), reason: z.string().min(1) }).strict(),
])

export const toolCatalogTaskKeySchema = z.object({
  threadId: z.string().min(1),
  capabilityEpoch: z.string().min(1),
}).strict()

export const toolCatalogDirectOutcomeSchema = z.enum([
  'started',
  'succeeded',
  'failed',
  'denied',
  'authentication-required',
  'approval-required',
])

export const toolCatalogActivitySummarySchema = z.object({
  outcome: toolCatalogDirectOutcomeSchema,
  observedAt: z.string().min(1),
  callId: z.string().min(1).nullable(),
  durationMs: z.number().nonnegative().nullable(),
}).strict()

export const toolCatalogMachineStateSchema = z.object({
  status: toolCatalogMachineStatusSchema,
  version: z.string().min(1).nullable(),
  observedAt: z.string().min(1).nullable(),
  stale: z.boolean(),
  provenance: toolCatalogMachineProvenanceSchema,
  diagnosticCode: z.string().min(1).nullable(),
}).strict()

export const toolCatalogTaskStateSchema = z.object({
  status: toolCatalogTaskStatusSchema,
  taskKey: toolCatalogTaskKeySchema.nullable(),
  observedAt: z.string().min(1).nullable(),
  provenance: toolCatalogTaskProvenanceSchema,
}).strict()

export const toolCatalogDescriptorSchema = z.object({
  id: toolCatalogIdSchema,
  name: z.string().min(1),
  source: toolCatalogSourceSchema,
  description: z.string().min(1).nullable(),
  isDefault: z.boolean(),
  probeCapability: toolCatalogProbeCapabilitySchema,
}).strict()

export const toolCatalogEntrySchema = toolCatalogDescriptorSchema.extend({
  isPinned: z.boolean(),
  isDismissedDefault: z.boolean(),
  inRail: z.boolean(),
  isOrphan: z.boolean(),
  machine: toolCatalogMachineStateSchema,
  task: toolCatalogTaskStateSchema,
  activity: toolCatalogActivitySummarySchema.nullable(),
}).strict()

export const toolCatalogRefreshStateSchema = z.object({
  status: z.enum(['fresh', 'stale', 'failed']),
  observedAt: z.string().min(1),
  errorCode: z.string().min(1).nullable(),
}).strict()

export const toolCatalogSnapshotSchema = z.object({
  generatedAt: z.string().min(1),
  taskKey: toolCatalogTaskKeySchema.nullable(),
  entries: z.array(toolCatalogEntrySchema),
  railToolIds: z.array(toolCatalogIdSchema),
  preservedPinnedToolIds: z.array(z.string().min(1)),
  orphanPinnedToolIds: z.array(z.string().min(1)),
  refresh: toolCatalogRefreshStateSchema,
}).strict()

export const toolCatalogProbeResultSchema = z.object({
  catalogId: toolCatalogIdSchema,
  status: toolCatalogMachineStatusSchema,
  version: z.string().min(1).nullable(),
  observedAt: z.string().min(1),
  diagnosticCode: z.string().min(1).nullable(),
}).strict()

const toolCatalogRegistryEvidenceFields = {
  observedAt: z.string().min(1),
  snapshot: toolRegistrySnapshotSchema,
}

export const toolCatalogRegistryEvidenceSchema = z.discriminatedUnion('scope', [
  z.object({
    scope: z.literal('global'),
    taskKey: z.null(),
    ...toolCatalogRegistryEvidenceFields,
  }).strict(),
  z.object({
    scope: z.literal('active-task'),
    taskKey: toolCatalogTaskKeySchema,
    ...toolCatalogRegistryEvidenceFields,
  }).strict(),
  z.object({
    scope: z.literal('stale-thread-fallback'),
    taskKey: z.null(),
    ...toolCatalogRegistryEvidenceFields,
  }).strict(),
])

export const toolCatalogCapabilityEvidenceSchema = z.object({
  catalogId: toolCatalogIdSchema,
  taskKey: toolCatalogTaskKeySchema,
  status: z.enum([
    'usable',
    'unavailable',
    'authentication-required',
    'approval-required',
    'denied',
  ]),
  observedAt: z.string().min(1),
}).strict()

export const toolCatalogDirectEventSchema = z.object({
  catalogId: toolCatalogIdSchema,
  taskKey: toolCatalogTaskKeySchema,
  outcome: toolCatalogDirectOutcomeSchema,
  observedAt: z.string().min(1),
  callId: z.string().min(1).nullable(),
  durationMs: z.number().nonnegative().nullable(),
}).strict()

export const toolCatalogPreferencesSchema = z.object({
  pinnedToolIds: z.array(z.string().min(1)),
  dismissedDefaultToolIds: z.array(z.string().min(1)),
}).strict()

export const toolCatalogRefreshFailureSchema = z.object({
  code: z.string().min(1),
  observedAt: z.string().min(1),
}).strict()

export type ToolEventStatus = z.infer<typeof toolEventStatusSchema>
export type ToolEventKind = z.infer<typeof toolEventKindSchema>
export type ToolEventRecord = z.infer<typeof toolEventSchema>
export type ToolRegistryApp = z.infer<typeof toolRegistryAppSchema>
export type ToolRegistryMcpTool = z.infer<typeof toolRegistryMcpToolSchema>
export type ToolRegistryMcpServer = z.infer<typeof toolRegistryMcpServerSchema>
export type ToolRegistrySnapshot = z.infer<typeof toolRegistrySnapshotSchema>
export type ToolCatalogId = z.infer<typeof toolCatalogIdSchema>
export type ToolCatalogSource = z.infer<typeof toolCatalogSourceSchema>
export type ToolCatalogMachineStatus = z.infer<typeof toolCatalogMachineStatusSchema>
export type ToolCatalogTaskStatus = z.infer<typeof toolCatalogTaskStatusSchema>
export type ToolCatalogMachineProvenance = z.infer<typeof toolCatalogMachineProvenanceSchema>
export type ToolCatalogTaskProvenance = z.infer<typeof toolCatalogTaskProvenanceSchema>
export type ToolCatalogProbeCapability = z.infer<typeof toolCatalogProbeCapabilitySchema>
export type ToolCatalogTaskKey = z.infer<typeof toolCatalogTaskKeySchema>
export type ToolCatalogDirectOutcome = z.infer<typeof toolCatalogDirectOutcomeSchema>
export type ToolCatalogActivitySummary = z.infer<typeof toolCatalogActivitySummarySchema>
export type ToolCatalogMachineState = z.infer<typeof toolCatalogMachineStateSchema>
export type ToolCatalogTaskState = z.infer<typeof toolCatalogTaskStateSchema>
export type ToolCatalogDescriptor = z.infer<typeof toolCatalogDescriptorSchema>
export type ToolCatalogEntry = z.infer<typeof toolCatalogEntrySchema>
export type ToolCatalogSnapshot = z.infer<typeof toolCatalogSnapshotSchema>
export type ToolCatalogProbeResult = z.infer<typeof toolCatalogProbeResultSchema>
export type ToolCatalogRegistryEvidence = z.infer<typeof toolCatalogRegistryEvidenceSchema>
export type ToolCatalogCapabilityEvidence = z.infer<typeof toolCatalogCapabilityEvidenceSchema>
export type ToolCatalogDirectEvent = z.infer<typeof toolCatalogDirectEventSchema>
export type ToolCatalogPreferences = z.infer<typeof toolCatalogPreferencesSchema>
export type ToolCatalogRefreshFailure = z.infer<typeof toolCatalogRefreshFailureSchema>

export function parseToolEvent(value: unknown): ToolEventRecord | null {
  const parsed = toolEventSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}
