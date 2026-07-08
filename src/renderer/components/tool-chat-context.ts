import type { ToolEventRecord } from '@/shared/tools'

export type ToolChatContextEvent = ToolEventRecord & Partial<{
  telemetryId: number
  telemetryType: string
  persistedAt: string
}>

const MAX_TOOL_CONTEXT_CHARS = 12000

function boundedTail(value: string, maxChars = MAX_TOOL_CONTEXT_CHARS): string {
  const text = value.trim()
  if (text.length <= maxChars) return text
  return `${text.slice(-maxChars).trimStart()}\n\n[Tool context truncated: ${text.length - maxChars} chars omitted from the beginning]`
}

function optionalLine(label: string, value: string | number | null | undefined): string | null {
  if (value === undefined || value === null || value === '') return null
  return `${label}: ${value}`
}

export function toolEventChatContext(event: ToolChatContextEvent): string {
  const title = event.title ?? event.name
  const details = [
    `Tool: ${title}`,
    title !== event.name ? `Name: ${event.name}` : null,
    `Kind: ${event.kind}`,
    `Status: ${event.status}`,
    `Thread: ${event.threadId}`,
    optionalLine('Tool call', event.toolCallId),
    optionalLine('Server', event.server),
    optionalLine('Connector', event.connectorName),
    optionalLine('Review', event.reviewId),
    typeof event.durationMs === 'number' ? `Duration: ${Math.round(event.durationMs)}ms` : null,
    `Timestamp: ${event.timestamp}`,
    event.argumentsPreview ? '\nArguments preview:' : null,
    event.argumentsPreview ?? null,
    event.resultPreview ? '\nResult preview:' : null,
    event.resultPreview ?? null,
    event.error ? '\nError:' : null,
    event.error ?? null,
  ].filter((line): line is string => Boolean(line)).join('\n')

  return [
    'Tool event context:',
    boundedTail(details) || '[No tool event details available]',
  ].join('\n')
}
