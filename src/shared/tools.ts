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
  name: z.string().min(1),
  title: z.string().min(1).optional(),
  kind: toolEventKindSchema,
  status: toolEventStatusSchema,
  timestamp: z.string().min(1),
  argumentsPreview: z.string().optional(),
  resultPreview: z.string().optional(),
  error: z.string().optional(),
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

export type ToolEventStatus = z.infer<typeof toolEventStatusSchema>
export type ToolEventKind = z.infer<typeof toolEventKindSchema>
export type ToolEventRecord = z.infer<typeof toolEventSchema>
export type ToolRegistryApp = z.infer<typeof toolRegistryAppSchema>
export type ToolRegistryMcpTool = z.infer<typeof toolRegistryMcpToolSchema>
export type ToolRegistryMcpServer = z.infer<typeof toolRegistryMcpServerSchema>
export type ToolRegistrySnapshot = z.infer<typeof toolRegistrySnapshotSchema>

export function parseToolEvent(value: unknown): ToolEventRecord | null {
  const parsed = toolEventSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}
