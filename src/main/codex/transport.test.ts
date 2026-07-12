import { describe, expect, it, vi } from 'vitest'
import { CodexClient } from './client'
import { FakeCodexClient } from './fakeClient'

describe('CodexClient explicit runtime routing', () => {
  it('does not cross-route concurrent calls with different cwd values', async () => {
    const client = new CodexClient('/default')
    client.setTransportCapabilities({ cwdArrayHistory: true, explicitTurnCwd: true, dynamicTools: true })
    const calls: Array<{ method: string; params?: Record<string, unknown> }> = []
    const call = vi.fn(async (method: string, params?: Record<string, unknown>) => {
      calls.push({ method, params })
      await Promise.resolve()
      if (method === 'thread/start') {
        return { jsonrpc: '2.0' as const, id: calls.length, result: { thread: { id: `thread-${String(params?.cwd)}` } } }
      }
      return { jsonrpc: '2.0' as const, id: calls.length, result: { turn: { id: 'turn' } } }
    })
    Object.defineProperty(client, 'call', { value: call })

    const [left, right] = await Promise.all([
      client.createThread('/repo/left'),
      client.createThread('/repo/right'),
    ])
    await Promise.all([
      client.sendMessage(left.id, [{ type: 'text', text: 'left' }], undefined, { cwd: '/repo/left', taskId: 'task-left' }),
      client.sendMessage(right.id, [{ type: 'text', text: 'right' }], undefined, { cwd: '/repo/right', taskId: 'task-right' }),
    ])

    expect(calls.filter(({ method }) => method === 'thread/start').map(({ params }) => params?.cwd)).toEqual([
      '/repo/left',
      '/repo/right',
    ])
    expect(calls.filter(({ method }) => method === 'turn/start').map(({ params }) => params?.cwd)).toEqual([
      '/repo/left',
      '/repo/right',
    ])
  })

  it('responds to registered incoming requests and rejects unknown methods', async () => {
    const client = new CodexClient('/default')
    const writes: string[] = []
    Object.defineProperty(client, 'process', {
      value: { stdin: { writable: true, write: (value: string) => writes.push(value) } },
      configurable: true,
    })
    client.registerRequestHandler('item/tool/call', async (params) => ({ echoed: params.value }))
    const transport = client as unknown as { handleMessage: (message: unknown) => void }

    transport.handleMessage({ jsonrpc: '2.0', id: 91, method: 'item/tool/call', params: { value: 'ok' } })
    transport.handleMessage({ jsonrpc: '2.0', id: 92, method: 'unknown/request', params: {} })
    await vi.waitFor(() => expect(writes).toHaveLength(2))

    const responses = writes.map((value) => JSON.parse(value) as { id: number; result?: unknown; error?: unknown })
    expect(responses.find(({ id }) => id === 91)).toEqual({ jsonrpc: '2.0', id: 91, result: { echoed: 'ok' } })
    expect(responses.find(({ id }) => id === 92)).toMatchObject({ jsonrpc: '2.0', id: 92, error: { code: -32601 } })
  })

  it('sends multiple cwd roots in one history request', async () => {
    const client = new CodexClient('/default')
    const call = vi.fn(async () => ({ jsonrpc: '2.0' as const, id: 1, result: { data: [] } }))
    Object.defineProperty(client, 'call', { value: call })
    client.setTransportCapabilities({ cwdArrayHistory: true, explicitTurnCwd: true, dynamicTools: true })

    await client.listThreads(['/repo/local', '/repo/worktree'])

    expect(call).toHaveBeenCalledWith('thread/list', expect.objectContaining({
      cwd: ['/repo/local', '/repo/worktree'],
    }))
  })

  it('merges individual root history when array history is unavailable', async () => {
    const client = new CodexClient('/default')
    const call = vi.fn(async (method: string, params?: Record<string, unknown>) => {
      if (method !== 'thread/list' || !params || params.ancestorThreadId) {
        return { jsonrpc: '2.0' as const, id: 1, result: { data: [] } }
      }
      const cwd = String(params.cwd)
      return {
        jsonrpc: '2.0' as const,
        id: 1,
        result: {
          data: [{
            id: cwd.endsWith('worktree') ? 'worktree-thread' : 'local-thread',
            name: cwd,
            cwd,
            createdAt: cwd.endsWith('worktree') ? 20 : 10,
            updatedAt: cwd.endsWith('worktree') ? 20 : 10,
          }],
          nextCursor: `${cwd}-next`,
        },
      }
    })
    Object.defineProperty(client, 'call', { value: call })

    const firstPage = await client.listThreads(['/repo/local', '/repo/worktree'], { limit: 10 })

    expect(firstPage.sessions.map((session) => session.id)).toEqual(['worktree-thread', 'local-thread'])
    expect(firstPage.nextCursor).toMatch(/^cranberri-multi-root:/)
    expect(call.mock.calls.filter(([method, params]) => method === 'thread/list' && !params?.ancestorThreadId)
      .map(([, params]) => params?.cwd)).toEqual(['/repo/local', '/repo/worktree'])

    call.mockClear()
    await client.listThreads(['/repo/local', '/repo/worktree'], { cursor: firstPage.nextCursor })
    expect(call.mock.calls.filter(([method, params]) => method === 'thread/list' && !params?.ancestorThreadId)
      .map(([, params]) => params?.cursor)).toEqual(['/repo/local-next', '/repo/worktree-next'])
  })
})

describe('FakeCodexClient task identity', () => {
  it('filters history by cwd and keeps explicit task identity on a thread', async () => {
    const client = new FakeCodexClient('/default')
    await client.createThread({ cwd: '/repo/a', taskId: 'task-a' })
    await client.createThread({ cwd: '/repo/b', taskId: 'task-b' })

    const a = await client.listThreads('/repo/a')
    const b = await client.listThreads(['/repo/a', '/repo/b'])

    expect(a.sessions.map((session) => session.cwd)).toEqual(['/repo/a'])
    expect(b.sessions).toHaveLength(2)
    expect(client.getTaskIdForThread(a.sessions[0].id)).toBe('task-a')
  })

  it('allows the same task thread to move from Local into a worktree', async () => {
    const client = new FakeCodexClient('/default')
    const thread = await client.createThread({ cwd: '/repo/local', taskId: 'task-a' })

    const resumed = await client.resumeThread(thread.id, { cwd: '/repo/worktree', taskId: 'task-a' })

    expect(resumed.cwd).toBe('/repo/worktree')
    await expect(client.resumeThread(thread.id, { cwd: '/repo/other', taskId: 'task-b' }))
      .rejects.toThrow(/task identity/)
  })
})
