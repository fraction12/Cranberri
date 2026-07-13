import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CodexEvent, CodexSdkThreadItem } from '../../shared/codex'
import { FakeCodexClient } from './fakeClient'
import { CodexHumanServerRequestBroker } from './codex-requests'

const RICH_ACTIVITY_FIXTURE = 'cranberri-rich-activity-fixture'

function collectEvents(client: FakeCodexClient): CodexEvent[] {
  const events: CodexEvent[] = []
  client.on('event', (event: CodexEvent) => events.push(event))
  return events
}

function itemEvent(
  events: CodexEvent[],
  type: 'item_started' | 'item_completed',
  itemId: string,
): Extract<CodexEvent, { type: 'item_started' | 'item_completed' }> | undefined {
  return events.find((event): event is Extract<CodexEvent, { type: 'item_started' | 'item_completed' }> => (
    event.type === type && event.itemId === itemId
  ))
}

describe('FakeCodexClient rich activity fixture', () => {
  beforeEach(() => vi.useFakeTimers())

  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it('keeps the existing fake turn contract unchanged unless explicitly requested', async () => {
    const client = new FakeCodexClient('/tmp/project')
    const thread = await client.createThread()
    const events = collectEvents(client)

    await client.sendMessage(thread.id, [{ type: 'text', text: 'ordinary fake turn' }])
    await vi.advanceTimersByTimeAsync(100)

    expect(events.some((event) => event.type === 'item_progress')).toBe(false)
    expect(events.some((event) => event.type === 'turn_diff_updated')).toBe(false)
    expect(events.filter((event) => event.type === 'item_started').map((event) => event.itemType))
      .toEqual(['reasoning', 'commandExecution', 'fileChange'])
  })

  it('emits deterministic live rich activity with full thread, turn, and item identity', async () => {
    const client = new FakeCodexClient('/tmp/project')
    const thread = await client.createThread()
    const events = collectEvents(client)

    await client.sendMessage(thread.id, [{ type: 'text', text: RICH_ACTIVITY_FIXTURE }])
    await vi.advanceTimersByTimeAsync(100)

    const turnId = 'fake-turn-1'
    const commandId = `${turnId}-command`
    const fileChangeId = `${turnId}-tool`
    const mcpResultId = `${turnId}-mcp-result`
    const mcpErrorId = `${turnId}-mcp-error`

    expect(events.filter((event) => event.type === 'item_progress')).toEqual([
      { type: 'item_progress', threadId: thread.id, turnId, itemId: commandId, progress: { type: 'command_output', delta: 'synthetic match one\n' } },
      { type: 'item_progress', threadId: thread.id, turnId, itemId: commandId, progress: { type: 'command_output', delta: 'synthetic match two\n' } },
      {
        type: 'item_progress',
        threadId: thread.id,
        turnId,
        itemId: fileChangeId,
        progress: {
          type: 'file_patch',
          changes: [{ path: 'src/example.ts', kind: { type: 'update' }, diff: '@@ -1 +1 @@\n-old fixture\n+new fixture' }],
        },
      },
      { type: 'item_progress', threadId: thread.id, turnId, itemId: mcpResultId, progress: { type: 'mcp_progress', message: 'Reading synthetic fixture' } },
      { type: 'item_progress', threadId: thread.id, turnId, itemId: mcpResultId, progress: { type: 'mcp_progress', message: 'Synthetic fixture ready' } },
    ])
    expect(events).toContainEqual({
      type: 'turn_diff_updated',
      threadId: thread.id,
      turnId,
      diff: 'diff --git a/src/example.ts b/src/example.ts\n-old fixture\n+new fixture',
    })

    for (const itemId of [commandId, fileChangeId, mcpResultId, mcpErrorId]) {
      const startedIndex = events.indexOf(itemEvent(events, 'item_started', itemId)!)
      const completedIndex = events.indexOf(itemEvent(events, 'item_completed', itemId)!)
      expect(startedIndex).toBeGreaterThanOrEqual(0)
      expect(completedIndex).toBeGreaterThan(startedIndex)
    }
    expect(itemEvent(events, 'item_completed', commandId)?.item).toMatchObject({
      type: 'commandExecution',
      aggregatedOutput: 'synthetic match one\nsynthetic match two\n',
      exitCode: 2,
      status: 'failed',
    })
    expect(itemEvent(events, 'item_completed', mcpResultId)?.item).toMatchObject({
      type: 'mcpToolCall',
      result: { summary: 'Synthetic fixture inspected', count: 2 },
      status: 'completed',
    })
    expect(itemEvent(events, 'item_completed', mcpErrorId)?.item).toMatchObject({
      type: 'mcpToolCall',
      error: { message: 'Synthetic fixture unavailable' },
      status: 'failed',
    })
    expect(itemEvent(events, 'item_completed', `${turnId}-web-search`)?.itemType).toBe('webSearch')
    expect(itemEvent(events, 'item_completed', `${turnId}-image-generation`)?.itemType).toBe('imageGeneration')
    expect(itemEvent(events, 'item_completed', `${turnId}-collaboration`)?.itemType).toBe('collabAgentToolCall')
    expect(events.at(-1)).toMatchObject({ type: 'run_end', threadId: thread.id, turnId, status: 'completed' })
  })

  it('restores the completed rich activity from normal thread history', async () => {
    const client = new FakeCodexClient('/tmp/project')
    const thread = await client.createThread()

    await client.sendMessage(thread.id, [{ type: 'text', text: RICH_ACTIVITY_FIXTURE }])
    await vi.advanceTimersByTimeAsync(100)

    const restored = await client.resumeThread(thread.id, '/tmp/project')
    const items = restored.turns.at(-1)?.items ?? []
    const byType = (type: string): CodexSdkThreadItem[] => items.filter((item) => item.type === type)

    expect(byType('commandExecution')).toContainEqual(expect.objectContaining({
      aggregatedOutput: 'synthetic match one\nsynthetic match two\n',
      exitCode: 2,
      status: 'failed',
    }))
    expect(byType('fileChange')).toContainEqual(expect.objectContaining({
      changes: [{ path: 'src/example.ts', kind: { type: 'update' }, diff: '@@ -1 +1 @@\n-old fixture\n+new fixture' }],
    }))
    expect(byType('mcpToolCall')).toEqual(expect.arrayContaining([
      expect.objectContaining({ result: { summary: 'Synthetic fixture inspected', count: 2 }, status: 'completed' }),
      expect.objectContaining({ error: { message: 'Synthetic fixture unavailable' }, status: 'failed' }),
    ]))
    expect(byType('webSearch')).toContainEqual(expect.objectContaining({
      query: 'deterministic Cranberri fixture',
      action: { type: 'search', query: 'deterministic Cranberri fixture', queries: ['deterministic Cranberri fixture'] },
    }))
    expect(byType('imageGeneration')).toContainEqual(expect.objectContaining({
      status: 'completed',
      result: expect.stringMatching(/^data:image\//),
      savedPath: '/tmp/cranberri-rich-activity-fixture.png',
    }))
    expect(byType('collabAgentToolCall')).toContainEqual(expect.objectContaining({
      tool: 'sendInput',
      senderThreadId: thread.id,
      receiverThreadIds: ['synthetic-worker-thread'],
    }))
  })

  it('drives a human request through the production broker before completing the fake turn', async () => {
    const client = new FakeCodexClient('/tmp/project')
    const thread = await client.createThread()
    const pending = vi.fn()
    const settled = vi.fn()
    const broker = new CodexHumanServerRequestBroker({ onPending: pending, onSettled: settled })
    broker.register(client)

    const sending = client.sendMessage(thread.id, [{ type: 'text', text: 'cranberri-human-request-fixture' }])
    expect(pending).toHaveBeenCalledOnce()
    const request = pending.mock.calls[0][0]
    expect(request.request).toMatchObject({
      id: 'fake-turn-1-human-request',
      method: 'item/commandExecution/requestApproval',
      params: { threadId: thread.id, turnId: 'fake-turn-1', itemId: 'fake-turn-1-command' },
    })

    expect(broker.respond({
      id: request.request.id,
      method: request.request.method,
      response: { decision: 'accept' },
    })).toBe(true)
    await sending
    await vi.advanceTimersByTimeAsync(100)

    expect(settled).toHaveBeenCalledWith(expect.objectContaining({ type: 'response' }))
    expect((await client.readThread(thread.id)).turns.at(-1)?.status).toBe('completed')
    broker.dispose()
  })
})
