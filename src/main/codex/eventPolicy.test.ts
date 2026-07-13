import { describe, expect, it } from 'vitest'
import type { CodexEvent } from '../../shared/codex'
import { shouldForwardCodexEventToRenderer, shouldPersistCodexEventTelemetry } from './eventPolicy'

describe('Codex event policy', () => {
  it('does not forward raw app-server log events to the renderer', () => {
    const event: CodexEvent = { type: 'log', level: 'stderr', text: 'dropping overload response' }

    expect(shouldForwardCodexEventToRenderer(event)).toBe(false)
  })

  it('does not persist high-volume stream events as telemetry', () => {
    const delta: CodexEvent = {
      type: 'agent_message_delta',
      threadId: 'thread-1',
      itemId: 'item-1',
      delta: 'token',
    }
    const itemStarted: CodexEvent = {
      type: 'item_started',
      threadId: 'thread-1',
      itemId: 'item-2',
      itemType: 'reasoning',
    }
    const itemProgress: CodexEvent = {
      type: 'item_progress',
      threadId: 'thread-1',
      turnId: 'turn-1',
      itemId: 'item-3',
      progress: { type: 'command_output', delta: 'sensitive command output' },
    }
    const turnDiff: CodexEvent = {
      type: 'turn_diff_updated',
      threadId: 'thread-1',
      turnId: 'turn-1',
      diff: 'sensitive source diff',
    }

    expect(shouldPersistCodexEventTelemetry(delta)).toBe(false)
    expect(shouldPersistCodexEventTelemetry(itemStarted)).toBe(false)
    expect(shouldPersistCodexEventTelemetry(itemProgress)).toBe(false)
    expect(shouldPersistCodexEventTelemetry(turnDiff)).toBe(false)
  })

  it('keeps low-volume lifecycle events visible to renderer and telemetry', () => {
    const event: CodexEvent = { type: 'run_end', threadId: 'thread-1' }

    expect(shouldForwardCodexEventToRenderer(event)).toBe(true)
    expect(shouldPersistCodexEventTelemetry(event)).toBe(true)
  })

  it('routes tool and approval payloads through metadata-only telemetry instead', () => {
    const approval: CodexEvent = {
      type: 'approval_request',
      threadId: 'thread-1',
      approval: {
        id: 'approval-1',
        reviewId: 'review-1',
        action: { type: 'command', command: 'echo secret' },
        review: {},
        description: 'Run command: echo secret',
      },
    }
    const tool: CodexEvent = {
      type: 'tool_call',
      threadId: 'thread-1',
      tool: { id: 'tool-1', function: 'exec_command', arguments: { command: 'echo secret' } },
    }
    const worker: CodexEvent = {
      type: 'worker_updated',
      threadId: 'thread-1',
      worker: {
        threadId: 'worker-1',
        parentThreadId: 'thread-1',
        prompt: 'Sensitive task context',
        status: 'running',
        updatedAt: 1,
      },
    }
    const humanRequest: CodexEvent = {
      type: 'human_request_pending',
      threadId: 'thread-1',
      pending: {
        request: {
          id: 'request-1',
          method: 'item/commandExecution/requestApproval',
          params: {
            threadId: 'thread-1',
            turnId: 'turn-1',
            itemId: 'item-1',
            startedAtMs: 1,
            environmentId: null,
            command: 'echo secret',
          },
        },
        attempt: 1,
        receivedAt: 1,
        deadlineAt: 2,
      },
    }

    expect(shouldPersistCodexEventTelemetry(approval)).toBe(false)
    expect(shouldPersistCodexEventTelemetry(tool)).toBe(false)
    expect(shouldPersistCodexEventTelemetry(worker)).toBe(false)
    expect(shouldPersistCodexEventTelemetry(humanRequest)).toBe(false)
  })
})
