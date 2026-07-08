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
import { logTelemetry } from './telemetry'

const MAX_PREVIEW_LENGTH = 1200
const MAX_STRING_LENGTH = 500
const SECRET_KEY_RE = /token|secret|password|authorization|cookie|apikey|api_key|credential/i

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

function sanitize(value: unknown, depth = 0): unknown {
  if (depth > 5) return '[depth-limit]'
  if (value === null || value === undefined) return value
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'string') return value.length > MAX_STRING_LENGTH ? `${value.slice(0, MAX_STRING_LENGTH)}...` : value
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => sanitize(item, depth + 1))
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .map(([key, item]) => [key, SECRET_KEY_RE.test(key) ? '[redacted]' : sanitize(item, depth + 1)]),
    )
  }
  return String(value)
}

export function safePayloadPreview(value: unknown, maxLength = MAX_PREVIEW_LENGTH): string | undefined {
  if (value === undefined || value === null) return undefined
  const sanitized = sanitize(value)
  const raw = typeof sanitized === 'string' ? sanitized : JSON.stringify(sanitized)
  if (!raw || raw === '{}' || raw === '[]') return undefined
  return raw.length > maxLength ? `${raw.slice(0, maxLength)}...` : raw
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

function commandName(item: Record<string, unknown>): string {
  const command = item.command
  if (Array.isArray(command)) return command.map(String).join(' ')
  if (typeof command === 'string' && command.trim()) return command
  const action = asRecord(item.action)
  if (action?.command) return String(action.command)
  return 'Command'
}

function itemName(item: Record<string, unknown>, kind: ToolEventKind): string {
  if (kind === 'command') return commandName(item)
  if (kind === 'file_change') return 'File change'
  const server = stringValue(item.server)
  const namespace = stringValue(item.namespace)
  const tool = stringValue(item.tool) ?? stringValue(item.name)
  if (server && tool) return `${server}.${tool}`
  if (namespace && tool) return `${namespace}.${tool}`
  if (tool) return tool
  if (kind === 'web_search') return 'Web search'
  if (kind === 'image') return 'Image generation'
  if (kind === 'collab') return 'Collaboration tool'
  return 'Tool call'
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

function itemError(item: Record<string, unknown>): string | undefined {
  const error = item.error
  if (!error) return undefined
  if (typeof error === 'string') return error
  const record = asRecord(error)
  return stringValue(record?.message) ?? safePayloadPreview(error, 400)
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

  return buildToolEvent({
    eventId: `${threadId}:${toolCallId ?? randomUUID()}:${phase}:${status}`,
    threadId,
    toolCallId,
    name: itemName(item, kind),
    title: stringValue(item.title),
    kind,
    status,
    argumentsPreview: safePayloadPreview(
      kind === 'command'
        ? { command: item.command, cwd: item.cwd, source: item.source }
        : item.arguments ?? item.input ?? item.changes ?? item.prompt,
    ),
    resultPreview: safePayloadPreview(item.result ?? item.output ?? item.contentItems ?? item.exitCode),
    error: itemError(item),
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
    resultPreview: message,
  })
}

export function createToolEventFromLegacyToolCall(threadId: string, tool: ToolCall): ToolEventRecord {
  return buildToolEvent({
    eventId: `${threadId}:${tool.id}:legacy-tool-call`,
    threadId,
    toolCallId: tool.id,
    name: tool.function,
    kind: 'dynamic',
    status: 'running',
    argumentsPreview: safePayloadPreview(tool.arguments),
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

  return buildToolEvent({
    eventId: `${threadId}:${approval.reviewId || approval.id}:approval-requested`,
    threadId,
    toolCallId: stringValue(action.targetItemId) ?? approval.targetItemId ?? undefined,
    name: server && toolName ? `${server}.${toolName}` : toolName ?? approval.description,
    title: stringValue(action.toolTitle),
    kind,
    status: 'approval_requested',
    argumentsPreview: safePayloadPreview(action),
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
