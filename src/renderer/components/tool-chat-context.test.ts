import { describe, expect, it } from 'vitest'
import type { ToolEventRecord } from '@/shared/tools'
import { toolEventChatContext } from './tool-chat-context'
import type { ToolTimelineEvent } from '../state/tools'

function toolEvent(overrides: Partial<ToolTimelineEvent> = {}): ToolTimelineEvent {
  return {
    telemetryId: 12,
    telemetryType: 'tool_event',
    persistedAt: '2026-07-07T10:00:01.000Z',
    eventId: 'event-1',
    threadId: 'thread-1',
    toolCallId: 'call-1',
    name: 'shell.exec',
    title: 'Run command',
    kind: 'command',
    status: 'completed',
    timestamp: '2026-07-07T10:00:00.000Z',
    argumentsPreview: 'npm test',
    resultPreview: '94 tests passed',
    durationMs: 1532,
    ...overrides,
  }
}

describe('tool chat context', () => {
  it('formats completed tool arguments and result for chat', () => {
    const context = toolEventChatContext(toolEvent())

    expect(context).toContain('Tool event context:')
    expect(context).toContain('Tool: Run command')
    expect(context).toContain('Name: shell.exec')
    expect(context).toContain('Status: completed')
    expect(context).toContain('Arguments preview:')
    expect(context).toContain('npm test')
    expect(context).toContain('Result preview:')
    expect(context).toContain('94 tests passed')
    expect(context).toContain('Duration: 1532ms')
  })

  it('includes failed tool errors and connector metadata', () => {
    const context = toolEventChatContext(toolEvent({
      name: 'github.create_issue',
      title: undefined,
      kind: 'mcp',
      status: 'failed',
      server: 'github',
      connectorName: 'GitHub',
      resultPreview: undefined,
      error: 'Missing repository permission',
    }))

    expect(context).toContain('Tool: github.create_issue')
    expect(context).toContain('Kind: mcp')
    expect(context).toContain('Status: failed')
    expect(context).toContain('Server: github')
    expect(context).toContain('Connector: GitHub')
    expect(context).toContain('Error:')
    expect(context).toContain('Missing repository permission')
  })

  it('formats persisted tool event records without telemetry metadata', () => {
    const event: ToolEventRecord = {
      eventId: 'event-plain',
      threadId: 'thread-1',
      toolCallId: 'call-plain',
      name: 'mcp.tool',
      kind: 'mcp',
      status: 'completed',
      timestamp: '2026-07-07T10:00:00.000Z',
      resultPreview: 'Plain record result',
    }
    const context = toolEventChatContext(event)

    expect(context).toContain('Tool: mcp.tool')
    expect(context).toContain('Status: completed')
    expect(context).toContain('Plain record result')
  })

  it('keeps newest tool output when context is too large', () => {
    const context = toolEventChatContext(toolEvent({
      argumentsPreview: 'old-args',
      resultPreview: `${'x'.repeat(13000)}\nlatest-tool-result`,
    }))

    expect(context).toContain('latest-tool-result')
    expect(context).toContain('Tool context truncated')
    expect(context.length).toBeLessThan(12500)
  })
})
