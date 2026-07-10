import { randomUUID } from 'node:crypto'
import type { CodexEvent, PendingApproval, ToolCall } from '@/shared/codex'
import {
  toolEventSchema,
  toolRegistrySnapshotSchema,
  type ToolEventKind,
  type ToolEventRecord,
  type ToolEventStatus,
  type ToolRegistryApp,
  type ToolRegistryMcpServer,
  type ToolRegistryMcpTool,
  type ToolRegistrySnapshot,
} from '../shared/tools'
import { createToolCatalogId } from './tool-catalog'
import { logTelemetry } from './telemetry'

type ToolItemPhase = 'started' | 'completed'

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function normalizeStatus(rawStatus: unknown, fallback: ToolEventStatus): ToolEventStatus {
  const status = String(rawStatus ?? '').toLowerCase()
  if (['completed', 'complete', 'success', 'succeeded'].includes(status)) return 'completed'
  if (['failed', 'failure', 'error', 'errored'].includes(status)) return 'failed'
  if (['running', 'inprogress', 'in_progress', 'started', 'executing'].includes(status)) return 'running'
  if (['pending', 'queued'].includes(status)) return 'pending'
  return fallback
}

function itemKind(type: string): ToolEventKind | null {
  switch (type) {
    case 'commandExecution':
    case 'local_shell_call':
      return 'command'
    case 'fileChange':
      return 'file_change'
    case 'mcpToolCall':
      return 'mcp'
    case 'dynamicToolCall':
    case 'function_call':
    case 'custom_tool_call':
    case 'tool_search_call':
      return 'dynamic'
    case 'collabAgentToolCall':
      return 'collab'
    case 'web_search_call':
      return 'web_search'
    case 'image_generation_call':
      return 'image'
    default:
      return null
  }
}

function itemIdentity(item: Record<string, unknown>, kind: ToolEventKind): { name: string; catalogId?: string } {
  if (kind === 'command') return { name: 'exec_command', catalogId: createToolCatalogId({ kind: 'codex' }, 'exec_command') }
  if (kind === 'file_change') return { name: 'apply_patch', catalogId: createToolCatalogId({ kind: 'codex' }, 'apply_patch') }
  const server = stringValue(item.server)
  const namespace = stringValue(item.namespace)
  const tool = stringValue(item.tool) ?? stringValue(item.name)
  if (server && tool) {
    return {
      name: tool,
      catalogId: createToolCatalogId({ kind: 'mcp', providerId: server, providerName: server }, tool),
    }
  }
  if (kind === 'web_search') {
    return {
      name: 'web_search',
      catalogId: createToolCatalogId({ kind: 'browser', providerId: 'codex-runtime' }, 'web_search'),
    }
  }
  if (kind === 'image') {
    return {
      name: 'image_generation',
      catalogId: createToolCatalogId({ kind: 'browser', providerId: 'codex-runtime' }, 'image_generation'),
    }
  }
  if (tool) {
    return {
      name: tool,
      catalogId: createToolCatalogId({ kind: 'codex' }, tool),
    }
  }
  if (namespace) return { name: namespace }
  if (kind === 'collab') return { name: 'collaboration' }
  return { name: 'tool_call' }
}

function itemStatus(item: Record<string, unknown>, phase: ToolItemPhase): ToolEventStatus {
  if (item.error) return 'failed'
  const status = normalizeStatus(item.status, phase === 'started' ? 'running' : 'completed')
  const success = item.success
  if (success === false) return 'failed'
  const exitCode = numberValue(item.exitCode)
  if (exitCode !== undefined && exitCode !== 0) return 'failed'
  return status
}

function itemErrorCode(item: Record<string, unknown>, status: ToolEventStatus): string | undefined {
  if (status !== 'failed') return undefined
  const error = asRecord(item.error)
  const code = stringValue(error?.code)
  if (code) return code.slice(0, 80)
  const exitCode = numberValue(item.exitCode)
  return exitCode === undefined ? 'tool-failed' : `exit-${exitCode}`
}

function buildToolEvent(input: Omit<ToolEventRecord, 'timestamp'> & { timestamp?: string }): ToolEventRecord {
  return toolEventSchema.parse({
    timestamp: new Date().toISOString(),
    ...input,
  })
}

export function createToolEventFromItem(threadId: string, itemValue: unknown, phase: ToolItemPhase): ToolEventRecord | null {
  const item = asRecord(itemValue)
  const type = stringValue(item?.type)
  if (!item || !type) return null

  const kind = itemKind(type)
  if (!kind) return null

  const toolCallId = stringValue(item.id) ?? stringValue(item.call_id)
  const status = itemStatus(item, phase)
  const server = stringValue(item.server)
  const appContext = asRecord(item.appContext)
  const identity = itemIdentity(item, kind)

  return buildToolEvent({
    eventId: `${threadId}:${toolCallId ?? randomUUID()}:${phase}:${status}`,
    threadId,
    toolCallId,
    catalogId: identity.catalogId,
    name: identity.name,
    title: stringValue(item.title),
    kind,
    status,
    errorCode: itemErrorCode(item, status),
    durationMs: numberValue(item.durationMs) ?? null,
    server,
    connectorId: typeof appContext?.connectorId === 'string' ? appContext.connectorId : undefined,
  })
}

export function createMcpToolProgressEvent(threadId: string, itemId: string | undefined, message: string): ToolEventRecord | null {
  if (!threadId || !message.trim()) return null
  return buildToolEvent({
    eventId: `${threadId}:${itemId ?? randomUUID()}:progress`,
    threadId,
    toolCallId: itemId,
    name: 'MCP tool',
    kind: 'mcp',
    status: 'progress',
  })
}

export function createToolEventFromLegacyToolCall(threadId: string, tool: ToolCall): ToolEventRecord {
  const catalogId = createToolCatalogId({ kind: 'codex' }, tool.function)
  return buildToolEvent({
    eventId: `${threadId}:${tool.id}:legacy-tool-call`,
    threadId,
    toolCallId: tool.id,
    catalogId,
    name: tool.function,
    kind: 'dynamic',
    status: 'running',
  })
}

export function createToolEventFromApproval(threadId: string, approval: PendingApproval): ToolEventRecord | null {
  const action = asRecord(approval.action)
  if (!action) return null
  const actionType = stringValue(action.type) ?? 'approval'
  const kind: ToolEventKind = actionType === 'mcpToolCall'
    ? 'mcp'
    : actionType === 'command' || actionType === 'execve'
      ? 'command'
      : actionType === 'applyPatch'
        ? 'file_change'
        : 'approval'
  const server = stringValue(action.server)
  const toolName = stringValue(action.toolName) ?? stringValue(action.program) ?? stringValue(action.command)
  const identity = !toolName && kind !== 'command' && kind !== 'file_change'
    ? { name: approval.description }
    : itemIdentity({ server, tool: toolName }, kind)

  return buildToolEvent({
    eventId: `${threadId}:${approval.reviewId || approval.id}:approval-requested`,
    threadId,
    toolCallId: stringValue(action.targetItemId) ?? approval.targetItemId ?? undefined,
    catalogId: identity.catalogId,
    name: identity.name,
    title: stringValue(action.toolTitle),
    kind,
    status: 'approval_requested',
    reviewId: approval.reviewId,
    server,
    connectorId: typeof action.connectorId === 'string' ? action.connectorId : undefined,
    connectorName: typeof action.connectorName === 'string' ? action.connectorName : undefined,
  })
}

export function createApprovalCompletedEvent(threadId: string, reviewId: string, action: string): ToolEventRecord | null {
  if (!threadId || !reviewId) return null
  const status: ToolEventStatus = action === 'denied' || action === 'timedOut' || action === 'aborted' ? 'denied' : 'approved'
  return buildToolEvent({
    eventId: `${threadId}:${reviewId}:approval-${status}`,
    threadId,
    name: `Approval ${status}`,
    kind: 'approval',
    status,
    reviewId,
  })
}

export function toolEventsFromCodexEvent(event: CodexEvent): ToolEventRecord[] {
  switch (event.type) {
    case 'tool_event':
      return [event.event]
    case 'tool_call':
      return [createToolEventFromLegacyToolCall(event.threadId, event.tool)]
    case 'approval_request': {
      const approvalEvent = createToolEventFromApproval(event.threadId, event.approval)
      return approvalEvent ? [approvalEvent] : []
    }
    case 'approval_completed': {
      const approvalEvent = createApprovalCompletedEvent(event.threadId, event.reviewId, event.action)
      return approvalEvent ? [approvalEvent] : []
    }
    default:
      return []
  }
}

export async function recordToolEventsForCodexEvent(event: CodexEvent): Promise<void> {
  const records = toolEventsFromCodexEvent(event)
  await Promise.all(records.map((record) => logTelemetry('tool', record.status, record)))
}

function listData(value: unknown): unknown[] {
  const record = asRecord(value)
  return Array.isArray(record?.data) ? record.data : []
}

function boolValue(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

function normalizeRegistryApp(value: unknown): ToolRegistryApp | null {
  const app = asRecord(value)
  const id = stringValue(app?.id)
  const name = stringValue(app?.name)
  if (!app || !id || !name) return null
  const plugins = Array.isArray(app.pluginDisplayNames) ? app.pluginDisplayNames.map(String) : []
  return {
    id,
    name,
    description: stringOrNull(app.description),
    logoUrl: stringOrNull(app.logoUrlDark) ?? stringOrNull(app.logoUrl),
    enabled: boolValue(app.isEnabled, true),
    accessible: boolValue(app.isAccessible, true),
    distributionChannel: stringOrNull(app.distributionChannel),
    pluginDisplayNames: plugins,
  }
}

function normalizeRegistryMcpTool(name: string, value: unknown): ToolRegistryMcpTool {
  const tool = asRecord(value)
  return {
    name: stringValue(tool?.name) ?? name,
    title: stringOrNull(tool?.title),
    description: stringOrNull(tool?.description),
  }
}

function normalizeRegistryMcpServer(value: unknown): ToolRegistryMcpServer | null {
  const server = asRecord(value)
  const name = stringValue(server?.name)
  if (!server || !name) return null
  const rawTools = asRecord(server.tools) ?? {}
  const tools = Object.entries(rawTools)
    .map(([toolName, toolValue]) => normalizeRegistryMcpTool(toolName, toolValue))
    .sort((a, b) => a.name.localeCompare(b.name))

  return {
    name,
    authStatus: stringValue(server.authStatus) ?? 'unknown',
    toolCount: tools.length,
    resourceCount: Array.isArray(server.resources) ? server.resources.length : 0,
    resourceTemplateCount: Array.isArray(server.resourceTemplates) ? server.resourceTemplates.length : 0,
    tools,
  }
}

export function normalizeToolRegistrySnapshot(input: {
  appsResult?: unknown
  mcpResult?: unknown
  appListAvailable: boolean
  mcpServerStatusAvailable: boolean
  errors?: string[]
}): ToolRegistrySnapshot {
  return toolRegistrySnapshotSchema.parse({
    generatedAt: new Date().toISOString(),
    apps: listData(input.appsResult)
      .map(normalizeRegistryApp)
      .filter((app): app is ToolRegistryApp => Boolean(app))
      .sort((a, b) => a.name.localeCompare(b.name)),
    mcpServers: listData(input.mcpResult)
      .map(normalizeRegistryMcpServer)
      .filter((server): server is ToolRegistryMcpServer => Boolean(server))
      .sort((a, b) => a.name.localeCompare(b.name)),
    capabilities: {
      appList: input.appListAvailable,
      mcpServerStatus: input.mcpServerStatusAvailable,
      errors: input.errors ?? [],
    },
  })
}
