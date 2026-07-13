import { describe, expect, it, vi } from 'vitest'
import { CODEX_INITIALIZE_PARAMS, CodexClient, normalizeThreadList } from './client'
import { FakeCodexClient } from './fakeClient'
import { ThreadLifecycleDisagreementError } from './thread-lifecycle'

describe('CodexClient app-server handshake', () => {
  it('enables the experimental descendant API and completes initialization', async () => {
    const client = new CodexClient('/tmp/cranberri-client-test')
    const call = vi.fn(async () => ({ jsonrpc: '2.0' as const, id: 1, result: {} }))
    const notify = vi.fn()
    Object.defineProperty(client, 'call', { value: call })
    Object.defineProperty(client, 'notify', { value: notify })

    await (client as unknown as { initializeSession: () => Promise<void> }).initializeSession()

    expect(call).toHaveBeenCalledWith('initialize', CODEX_INITIALIZE_PARAMS)
    expect(notify).toHaveBeenCalledWith('initialized')
    expect(CODEX_INITIALIZE_PARAMS.capabilities).toEqual({ experimentalApi: true, requestAttestation: false })
  })
})

describe('CodexClient authoritative thread lifecycle inspection', () => {
  it('reads first and fully paginates active and archived lists before classifying an active thread', async () => {
    const client = new CodexClient('/tmp/cranberri-client-test')
    const call = vi.fn(async (method: string, params: Record<string, unknown>) => {
      if (method === 'thread/read') {
        return {
          jsonrpc: '2.0' as const,
          id: 1,
          result: { thread: { id: 'thread-1', cwd: '/tmp/project' } },
        }
      }
      if (method !== 'thread/list') throw new Error(`Unexpected method ${method}`)
      if (params.archived === false && params.cursor === null) {
        return { jsonrpc: '2.0' as const, id: 2, result: { data: [{ id: 'other-active' }], nextCursor: 'active-2' } }
      }
      if (params.archived === false) {
        return { jsonrpc: '2.0' as const, id: 3, result: { data: [{ id: 'thread-1' }], nextCursor: null } }
      }
      if (params.cursor === null) {
        return { jsonrpc: '2.0' as const, id: 4, result: { data: [{ id: 'other-archived' }], nextCursor: 'archived-2' } }
      }
      return { jsonrpc: '2.0' as const, id: 5, result: { data: [], nextCursor: null } }
    })
    Object.defineProperty(client, 'call', { value: call })

    await expect(client.inspectThreadLifecycle('thread-1')).resolves.toEqual({
      threadId: 'thread-1',
      state: 'active',
      cwd: '/tmp/project',
    })
    expect(call.mock.calls).toEqual([
      ['thread/read', { threadId: 'thread-1', includeTurns: false }],
      ['thread/list', expect.objectContaining({ cwd: '/tmp/project', archived: false, cursor: null })],
      ['thread/list', expect.objectContaining({ cwd: '/tmp/project', archived: false, cursor: 'active-2' })],
      ['thread/list', expect.objectContaining({ cwd: '/tmp/project', archived: true, cursor: null })],
      ['thread/list', expect.objectContaining({ cwd: '/tmp/project', archived: true, cursor: 'archived-2' })],
    ])
  })

  it('classifies a read thread found only in the fully paginated archived list', async () => {
    const client = new CodexClient('/tmp/cranberri-client-test')
    const call = vi.fn(async (method: string, params: Record<string, unknown>) => {
      if (method === 'thread/read') {
        return { jsonrpc: '2.0' as const, id: 1, result: { thread: { id: 'thread-1', cwd: { path: '/tmp/project' } } } }
      }
      if (params.archived === false) {
        return { jsonrpc: '2.0' as const, id: 2, result: { data: [], nextCursor: null } }
      }
      if (params.cursor === null) {
        return { jsonrpc: '2.0' as const, id: 3, result: { data: [{ id: 'other-archived' }], nextCursor: 'archived-2' } }
      }
      return { jsonrpc: '2.0' as const, id: 4, result: { data: [{ id: 'thread-1' }], nextCursor: null } }
    })
    Object.defineProperty(client, 'call', { value: call })

    await expect(client.inspectThreadLifecycle('thread-1')).resolves.toEqual({
      threadId: 'thread-1',
      state: 'archived',
      cwd: '/tmp/project',
    })
    expect(call).toHaveBeenCalledWith('thread/list', expect.objectContaining({
      cwd: '/tmp/project',
      archived: true,
      cursor: 'archived-2',
    }))
  })

  it.each(['thread not found', 'thread not loaded'])('normalizes authoritative "%s" read errors as missing', async (message) => {
    const client = new CodexClient('/tmp/cranberri-client-test')
    const call = vi.fn(async () => {
      throw new Error(`${message}: thread-1`)
    })
    Object.defineProperty(client, 'call', { value: call })

    await expect(client.inspectThreadLifecycle('thread-1')).resolves.toEqual({
      threadId: 'thread-1',
      state: 'missing',
      cwd: null,
    })
    expect(call).toHaveBeenCalledTimes(1)
  })

  it('rejects a successful read that appears in neither lifecycle list', async () => {
    const client = new CodexClient('/tmp/cranberri-client-test')
    const call = vi.fn(async (method: string) => method === 'thread/read'
      ? { jsonrpc: '2.0' as const, id: 1, result: { thread: { id: 'thread-1', cwd: '/tmp/project' } } }
      : { jsonrpc: '2.0' as const, id: 2, result: { data: [], nextCursor: null } })
    Object.defineProperty(client, 'call', { value: call })

    await expect(client.inspectThreadLifecycle('thread-1')).rejects.toBeInstanceOf(ThreadLifecycleDisagreementError)
  })

  it('rejects a successful read that appears in both lifecycle lists', async () => {
    const client = new CodexClient('/tmp/cranberri-client-test')
    const call = vi.fn(async (method: string) => method === 'thread/read'
      ? { jsonrpc: '2.0' as const, id: 1, result: { thread: { id: 'thread-1', cwd: '/tmp/project' } } }
      : { jsonrpc: '2.0' as const, id: 2, result: { data: [{ id: 'thread-1' }], nextCursor: null } })
    Object.defineProperty(client, 'call', { value: call })

    await expect(client.inspectThreadLifecycle('thread-1')).rejects.toBeInstanceOf(ThreadLifecycleDisagreementError)
  })

  it('keeps the fake lifecycle gateway behavior aligned with the real client contract', async () => {
    const client = new FakeCodexClient('/tmp/project')
    const thread = await client.createThread()

    await expect(client.inspectThreadLifecycle(thread.id)).resolves.toMatchObject({ state: 'active', cwd: '/tmp/project' })
    await client.archiveThread(thread.id)
    await expect(client.inspectThreadLifecycle(thread.id)).resolves.toMatchObject({ state: 'archived', cwd: '/tmp/project' })
    await client.deleteThread(thread.id)
    await expect(client.inspectThreadLifecycle(thread.id)).resolves.toEqual({ threadId: thread.id, state: 'missing', cwd: null })
  })
})

describe('CodexClient turn transport', () => {
  it('sends the resolved model, effort, and service tier to turn/start', async () => {
    const client = new CodexClient('/tmp/cranberri-client-test')
    const call = vi.fn(async (_method: string, _params: Record<string, unknown>) => ({
      jsonrpc: '2.0' as const,
      id: 1,
      result: { turn: { id: 'turn-1' } },
    }))
    Object.defineProperty(client, 'call', { value: call })

    await client.sendMessage('thread-1', [{ type: 'text', text: 'hello' }], {
      model: 'gpt-5.6-sol',
      effort: 'ultra',
      speed: 'fast',
      approvalMode: 'custom',
    })

    expect(call).toHaveBeenCalledWith('turn/start', {
      threadId: 'thread-1',
      input: [{ type: 'text', text: 'hello' }],
      model: 'gpt-5.6-sol',
      effort: 'ultra',
      serviceTier: 'priority',
    })
  })

  it('clears Fast and normalizes unsupported settings before transport', async () => {
    const client = new CodexClient('/tmp/cranberri-client-test')
    const call = vi.fn(async () => ({ jsonrpc: '2.0' as const, id: 1, result: {} }))
    Object.defineProperty(client, 'call', { value: call })

    await client.sendMessage('thread-1', [{ type: 'text', text: 'hello' }], {
      model: 'gpt-5.4-mini',
      effort: 'ultra',
      speed: 'fast',
    })

    expect(call).toHaveBeenCalledWith('turn/start', expect.objectContaining({
      model: 'gpt-5.4-mini',
      effort: 'medium',
      serviceTier: null,
    }))
  })

  it('steers the currently active root turn with the app-server precondition', async () => {
    const client = new CodexClient('/tmp/cranberri-client-test')
    const call = vi.fn(async (method: string) => ({
      jsonrpc: '2.0' as const,
      id: 1,
      result: method === 'turn/start' ? { turn: { id: 'turn-1' } } : {},
    }))
    Object.defineProperty(client, 'call', { value: call })

    await client.sendMessage('parent-1', [{ type: 'text', text: 'start' }])
    await client.steerThread('parent-1', [{ type: 'text', text: 'focus on renderer state' }])

    expect(call).toHaveBeenLastCalledWith('turn/steer', {
      threadId: 'parent-1',
      input: [{ type: 'text', text: 'focus on renderer state' }],
      expectedTurnId: 'turn-1',
    })
  })

  it('routes a live worker instruction through the active parent turn', async () => {
    const client = new CodexClient('/tmp/cranberri-client-test')
    const call = vi.fn(async (method: string) => {
      if (method === 'thread/read') {
        return {
          jsonrpc: '2.0' as const,
          id: 1,
          result: { thread: { id: 'parent-1', turns: [{ id: 'parent-turn', status: 'inProgress' }] } },
        }
      }
      return { jsonrpc: '2.0' as const, id: 2, result: {} }
    })
    Object.defineProperty(client, 'call', { value: call })

    await client.controlWorker('parent-1', 'worker-1', 'message', [{ type: 'text', text: 'Inspect renderer state.' }])

    expect(call).toHaveBeenNthCalledWith(1, 'thread/read', { threadId: 'parent-1', includeTurns: true })
    expect(call).toHaveBeenNthCalledWith(2, 'turn/steer', {
      threadId: 'parent-1',
      input: [expect.objectContaining({ type: 'text', text: expect.stringContaining('Target subagent thread: worker-1') })],
      expectedTurnId: 'parent-turn',
    })
  })

  it('resumes an inactive parent before asking it to resume a worker', async () => {
    const client = new CodexClient('/tmp/cranberri-client-test')
    const call = vi.fn(async (method: string) => {
      if (method === 'thread/read') {
        return { jsonrpc: '2.0' as const, id: 1, result: { thread: { id: 'parent-1', turns: [] } } }
      }
      if (method === 'thread/resume') {
        return { jsonrpc: '2.0' as const, id: 2, result: { thread: { id: 'parent-1', turns: [] } } }
      }
      if (method === 'turn/start') {
        return { jsonrpc: '2.0' as const, id: 3, result: { turn: { id: 'parent-turn-2' } } }
      }
      return { jsonrpc: '2.0' as const, id: 4, result: {} }
    })
    Object.defineProperty(client, 'call', { value: call })

    await client.controlWorker('parent-1', 'worker-1', 'resume', [{ type: 'text', text: 'Continue the audit.' }])

    expect(call).toHaveBeenNthCalledWith(1, 'thread/read', { threadId: 'parent-1', includeTurns: true })
    expect(call).toHaveBeenNthCalledWith(2, 'thread/resume', expect.objectContaining({
      threadId: 'parent-1',
      cwd: '/tmp/cranberri-client-test',
    }))
    expect(call).toHaveBeenNthCalledWith(3, 'turn/start', expect.objectContaining({
      threadId: 'parent-1',
      input: [expect.objectContaining({ type: 'text', text: expect.stringContaining('resume_agent') })],
    }))
  })

  it('falls back to a new parent turn when the active parent finishes during worker steering', async () => {
    const client = new CodexClient('/tmp/cranberri-client-test')
    let reads = 0
    const call = vi.fn(async (method: string) => {
      if (method === 'thread/read') {
        reads += 1
        return {
          jsonrpc: '2.0' as const,
          id: reads,
          result: { thread: { id: 'parent-1', turns: reads === 1 ? [{ id: 'turn-old', status: 'inProgress' }] : [] } },
        }
      }
      if (method === 'turn/steer') throw new Error('expected active turn turn-old but found none')
      if (method === 'thread/resume') {
        return { jsonrpc: '2.0' as const, id: 3, result: { thread: { id: 'parent-1', turns: [] } } }
      }
      if (method === 'turn/start') {
        return { jsonrpc: '2.0' as const, id: 4, result: { turn: { id: 'turn-new' } } }
      }
      return { jsonrpc: '2.0' as const, id: 5, result: {} }
    })
    Object.defineProperty(client, 'call', { value: call })

    await client.controlWorker('parent-1', 'worker-1', 'message', [{ type: 'text', text: 'Continue.' }])

    expect(call).toHaveBeenCalledWith('thread/resume', expect.objectContaining({ threadId: 'parent-1' }))
    expect(call).toHaveBeenLastCalledWith('turn/start', expect.objectContaining({ threadId: 'parent-1' }))
  })

  it('recovers a restored active turn before interrupting it', async () => {
    const client = new CodexClient('/tmp/cranberri-client-test')
    const call = vi.fn(async (method: string) => {
      if (method === 'thread/read') {
        return {
          jsonrpc: '2.0' as const,
          id: 1,
          result: { thread: { id: 'worker-1', turns: [{ id: 'turn-restored', status: 'inProgress' }] } },
        }
      }
      return { jsonrpc: '2.0' as const, id: 2, result: {} }
    })
    Object.defineProperty(client, 'call', { value: call })

    await client.interrupt('worker-1')

    expect(call).toHaveBeenNthCalledWith(1, 'thread/read', { threadId: 'worker-1', includeTurns: true })
    expect(call).toHaveBeenNthCalledWith(2, 'turn/interrupt', { threadId: 'worker-1', turnId: 'turn-restored' })
  })

  it('uses thread-level sandbox settings when resuming a worker', async () => {
    const client = new CodexClient('/tmp/cranberri-client-test')
    const call = vi.fn(async (_method: string, _params: Record<string, unknown>) => ({
      jsonrpc: '2.0' as const,
      id: 1,
      result: { thread: { id: 'worker-1', turns: [] } },
    }))
    Object.defineProperty(client, 'call', { value: call })

    await client.resumeThread('worker-1', '/tmp/worker-worktree', {
      model: 'gpt-5.6-sol',
      effort: 'high',
      approvalMode: 'full',
    })

    expect(call).toHaveBeenCalledWith('thread/resume', expect.objectContaining({
      threadId: 'worker-1',
      cwd: '/tmp/worker-worktree',
      sandbox: { type: 'dangerFullAccess' },
    }))
    expect(call.mock.calls[0][1]).not.toHaveProperty('sandboxPolicy')
  })
})

describe('CodexClient worker session normalization', () => {
  it('nests subagent sessions beneath their parent instead of listing them as top-level tasks', () => {
    const sessions = normalizeThreadList([
      {
        id: 'parent-1',
        sessionId: 'tree-1',
        name: 'Parent task',
        createdAt: 1,
        updatedAt: 2,
        status: { type: 'idle' },
        turns: [],
      },
      {
        id: 'worker-1',
        sessionId: 'tree-1',
        parentThreadId: 'parent-1',
        name: 'Inspect tests',
        agentNickname: 'Euclid',
        agentRole: 'explorer',
        createdAt: 1,
        updatedAt: 2,
        status: { type: 'active', activeFlags: [] },
        turns: [],
      },
    ], false)

    expect(sessions).toHaveLength(1)
    expect(sessions[0]).toMatchObject({ id: 'parent-1' })
    expect(sessions[0].workers).toEqual([expect.objectContaining({
      threadId: 'worker-1',
      parentThreadId: 'parent-1',
      nickname: 'Euclid',
      role: 'explorer',
      status: 'running',
    })])
  })

  it('preserves nested worker ancestry recursively', () => {
    const sessions = normalizeThreadList([
      { id: 'parent-1', name: 'Parent', createdAt: 1, updatedAt: 4, turns: [] },
      { id: 'worker-1', parentThreadId: 'parent-1', agentNickname: 'Euclid', createdAt: 2, updatedAt: 4, status: { type: 'idle' }, turns: [] },
      { id: 'worker-2', parentThreadId: 'worker-1', agentNickname: 'Noether', createdAt: 3, updatedAt: 4, status: { type: 'active', activeFlags: [] }, turns: [] },
    ], false)

    expect(sessions).toHaveLength(1)
    expect(sessions[0].workers?.[0]).toMatchObject({
      threadId: 'worker-1',
      workers: [expect.objectContaining({ threadId: 'worker-2', parentThreadId: 'worker-1', status: 'running' })],
    })
  })

  it('paginates descendants and keeps them out of the top-level session list', async () => {
    const client = new CodexClient('/tmp/cranberri-client-test')
    const events: Array<{ type: string; threadId?: string; worker?: { threadId: string; status: string } }> = []
    client.on('event', (event) => events.push(event))
    const call = vi.fn(async (method: string, params: Record<string, unknown>) => {
      if (method === 'thread/turns/list') {
        return { jsonrpc: '2.0' as const, id: 5, result: { data: [{ id: 'turn-1', status: 'completed' }], nextCursor: null } }
      }
      if (method !== 'thread/list') throw new Error(`Unexpected method ${method}`)
      if (!params.ancestorThreadId) {
        return { jsonrpc: '2.0' as const, id: 1, result: { data: [{ id: 'parent-1', name: 'Parent', turns: [] }], nextCursor: null } }
      }
      if (params.archived === true) {
        return { jsonrpc: '2.0' as const, id: 2, result: { data: [], nextCursor: null } }
      }
      if (params.cursor === null) {
        return {
          jsonrpc: '2.0' as const,
          id: 3,
          result: { data: [{ id: 'worker-1', parentThreadId: 'parent-1', agentNickname: 'Euclid', status: { type: 'idle' }, turns: [] }], nextCursor: 'page-2' },
        }
      }
      return {
        jsonrpc: '2.0' as const,
        id: 4,
        result: { data: [{ id: 'worker-2', parentThreadId: 'worker-1', agentNickname: 'Noether', status: { type: 'active', activeFlags: [] }, turns: [] }], nextCursor: null },
      }
    })
    Object.defineProperty(client, 'call', { value: call })

    const result = await client.listThreads('/tmp/project', { limit: 8 })

    expect(result.sessions).toHaveLength(1)
    expect(result.sessions[0].workers?.[0]).toMatchObject({
      threadId: 'worker-1',
      status: 'completed',
      workers: [expect.objectContaining({ threadId: 'worker-2', status: 'running' })],
    })
    expect(call).toHaveBeenCalledWith('thread/list', expect.objectContaining({ ancestorThreadId: 'parent-1', cursor: 'page-2' }))
    expect(call).toHaveBeenCalledWith('thread/turns/list', expect.objectContaining({ threadId: 'worker-1', limit: 1 }))

    const transport = client as unknown as { handleMessage: (message: unknown) => void }
    transport.handleMessage({
      jsonrpc: '2.0',
      method: 'turn/completed',
      params: { threadId: 'worker-2', turn: { status: 'interrupted' } },
    })
    expect(events.at(-1)).toMatchObject({
      type: 'worker_updated',
      threadId: 'worker-1',
      worker: { threadId: 'worker-2', status: 'interrupted' },
    })
  })

  it('uses the latest persisted turn outcome when a descendant is not loaded', async () => {
    const client = new CodexClient('/tmp/cranberri-client-test')
    const call = vi.fn(async (method: string, params: Record<string, unknown>) => {
      if (method === 'thread/read') {
        return { jsonrpc: '2.0' as const, id: 1, result: { thread: { id: 'parent-1', name: 'Parent', turns: [] } } }
      }
      if (method === 'thread/turns/list') {
        return { jsonrpc: '2.0' as const, id: 2, result: { data: [{ id: 'turn-1', status: 'interrupted' }], nextCursor: null } }
      }
      if (method === 'thread/list' && params.archived === false) {
        return {
          jsonrpc: '2.0' as const,
          id: 3,
          result: { data: [{ id: 'worker-1', parentThreadId: 'parent-1', agentNickname: 'Euclid', status: { type: 'notLoaded' }, turns: [] }], nextCursor: null },
        }
      }
      return { jsonrpc: '2.0' as const, id: 4, result: { data: [], nextCursor: null } }
    })
    Object.defineProperty(client, 'call', { value: call })

    const restored = await client.readThread('parent-1')

    expect(restored.workers).toEqual([expect.objectContaining({
      threadId: 'worker-1',
      status: 'interrupted',
      nickname: 'Euclid',
    })])
  })

  it('lets a descendant turn outcome override a newer inferred parent event', async () => {
    const client = new CodexClient('/tmp/cranberri-client-test')
    const call = vi.fn(async (method: string, params: Record<string, unknown>) => {
      if (method === 'thread/read') {
        return {
          jsonrpc: '2.0' as const,
          id: 1,
          result: {
            thread: {
              id: 'parent-1',
              name: 'Parent',
              turns: [{
                id: 'parent-turn',
                completedAt: 300,
                items: [{
                  type: 'collabAgentToolCall',
                  tool: 'spawnAgent',
                  status: 'completed',
                  senderThreadId: 'parent-1',
                  receiverThreadIds: ['worker-1'],
                }],
              }],
            },
          },
        }
      }
      if (method === 'thread/turns/list') {
        return { jsonrpc: '2.0' as const, id: 2, result: { data: [{ id: 'worker-turn', status: 'completed' }], nextCursor: null } }
      }
      if (method === 'thread/list' && params.archived === false) {
        return {
          jsonrpc: '2.0' as const,
          id: 3,
          result: {
            data: [{
              id: 'worker-1',
              parentThreadId: 'parent-1',
              agentNickname: 'Euclid',
              status: { type: 'notLoaded' },
              createdAt: 100,
              updatedAt: 200,
              turns: [],
            }],
            nextCursor: null,
          },
        }
      }
      return { jsonrpc: '2.0' as const, id: 4, result: { data: [], nextCursor: null } }
    })
    Object.defineProperty(client, 'call', { value: call })

    const restored = await client.readThread('parent-1')

    expect(restored.workers).toEqual([expect.objectContaining({
      threadId: 'worker-1',
      nickname: 'Euclid',
      status: 'completed',
    })])
  })
})

describe('CodexClient live worker notifications', () => {
  it('supports current Guardian review notification names without entering generic request transport', () => {
    const client = new CodexClient('/tmp/cranberri-client-test')
    const events: Array<Record<string, unknown>> = []
    client.on('event', (event) => events.push(event as unknown as Record<string, unknown>))
    const transport = client as unknown as { handleMessage: (message: unknown) => void }

    transport.handleMessage({
      jsonrpc: '2.0',
      method: 'item/autoApprovalReview/started',
      params: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        reviewId: 'review-1',
        targetItemId: 'command-1',
        action: { type: 'command', command: 'npm test' },
        review: { status: 'inProgress' },
      },
    })
    transport.handleMessage({
      jsonrpc: '2.0',
      method: 'item/autoApprovalReview/completed',
      params: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        reviewId: 'review-1',
        targetItemId: 'command-1',
        action: { type: 'command', command: 'npm test' },
        review: { status: 'approved' },
      },
    })

    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'approval_request',
        threadId: 'thread-1',
        approval: expect.objectContaining({ reviewId: 'review-1', targetItemId: 'command-1' }),
      }),
      expect.objectContaining({
        type: 'approval_completed',
        threadId: 'thread-1',
        reviewId: 'review-1',
        action: 'approved',
      }),
    ]))
  })

  it('correlates externally resolved server requests without ending the turn', () => {
    const client = new CodexClient('/tmp/cranberri-client-test')
    const events: Array<Record<string, unknown>> = []
    client.on('event', (event) => events.push(event as unknown as Record<string, unknown>))
    const transport = client as unknown as { handleMessage: (message: unknown) => void }

    transport.handleMessage({
      jsonrpc: '2.0',
      method: 'serverRequest/resolved',
      params: { threadId: 'thread-1', requestId: 42 },
    })

    expect(events).toContainEqual({ type: 'server_request_resolved', threadId: 'thread-1', requestId: 42 })
    expect(events).not.toEqual(expect.arrayContaining([expect.objectContaining({ type: 'run_end' })]))
  })

  it('forwards rich item progress with complete protocol identity', () => {
    const client = new CodexClient('/tmp/cranberri-client-test')
    const events: Array<Record<string, unknown>> = []
    client.on('event', (event) => events.push(event as unknown as Record<string, unknown>))
    const transport = client as unknown as { handleMessage: (message: unknown) => void }

    transport.handleMessage({
      jsonrpc: '2.0',
      method: 'item/commandExecution/outputDelta',
      params: { threadId: 'thread-1', turnId: 'turn-1', itemId: 'command-1', delta: 'test output\n' },
    })
    transport.handleMessage({
      jsonrpc: '2.0',
      method: 'item/fileChange/patchUpdated',
      params: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        itemId: 'patch-1',
        changes: [{ path: 'src/app.ts', kind: { type: 'update' }, diff: '+updated' }],
      },
    })
    transport.handleMessage({
      jsonrpc: '2.0',
      method: 'item/mcpToolCall/progress',
      params: { threadId: 'thread-1', turnId: 'turn-1', itemId: 'mcp-1', message: 'Reading records' },
    })
    transport.handleMessage({
      jsonrpc: '2.0',
      method: 'turn/diff/updated',
      params: { threadId: 'thread-1', turnId: 'turn-1', diff: 'diff --git a/src/app.ts b/src/app.ts' },
    })

    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'item_progress',
        threadId: 'thread-1',
        turnId: 'turn-1',
        itemId: 'command-1',
        progress: { type: 'command_output', delta: 'test output\n' },
      }),
      expect.objectContaining({
        type: 'item_progress',
        threadId: 'thread-1',
        turnId: 'turn-1',
        itemId: 'patch-1',
        progress: {
          type: 'file_patch',
          changes: [{ path: 'src/app.ts', kind: { type: 'update' }, diff: '+updated' }],
        },
      }),
      expect.objectContaining({
        type: 'item_progress',
        threadId: 'thread-1',
        turnId: 'turn-1',
        itemId: 'mcp-1',
        progress: { type: 'mcp_progress', message: 'Reading records' },
      }),
      expect.objectContaining({
        type: 'turn_diff_updated',
        threadId: 'thread-1',
        turnId: 'turn-1',
        diff: 'diff --git a/src/app.ts b/src/app.ts',
      }),
    ]))
    expect(events).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'log', level: 'command-output' }),
    ]))
  })

  it('forwards typed turn and item lifecycle identity to the renderer', () => {
    const client = new CodexClient('/tmp/cranberri-client-test')
    const events: Array<Record<string, unknown>> = []
    client.on('event', (event) => events.push(event as unknown as Record<string, unknown>))
    const transport = client as unknown as { handleMessage: (message: unknown) => void }

    transport.handleMessage({
      jsonrpc: '2.0',
      method: 'turn/started',
      params: { threadId: 'thread-1', turn: { id: 'turn-1', startedAt: 10 } },
    })
    transport.handleMessage({
      jsonrpc: '2.0',
      method: 'item/started',
      params: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        startedAtMs: 10_100,
        item: { id: 'command-1', type: 'commandExecution', command: 'npm test', status: 'inProgress' },
      },
    })
    transport.handleMessage({
      jsonrpc: '2.0',
      method: 'item/started',
      params: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        startedAtMs: 10_110,
        item: { id: 'commentary-1', type: 'agentMessage', phase: 'commentary', text: '' },
      },
    })
    transport.handleMessage({
      jsonrpc: '2.0',
      method: 'item/agentMessage/delta',
      params: { threadId: 'thread-1', turnId: 'turn-1', itemId: 'commentary-1', delta: 'Checking the state.' },
    })
    transport.handleMessage({
      jsonrpc: '2.0',
      method: 'item/completed',
      params: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        completedAtMs: 10_200,
        item: { id: 'command-1', type: 'commandExecution', command: 'npm test', status: 'completed', exitCode: 0 },
      },
    })
    transport.handleMessage({
      jsonrpc: '2.0',
      method: 'turn/completed',
      params: { threadId: 'thread-1', turn: { id: 'turn-1', status: 'completed', completedAt: 11, durationMs: 1_000 } },
    })

    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'run_start', threadId: 'thread-1', turnId: 'turn-1', startedAt: 10_000 }),
      expect.objectContaining({
        type: 'item_started',
        threadId: 'thread-1',
        turnId: 'turn-1',
        itemId: 'command-1',
        startedAt: 10_100,
        item: expect.objectContaining({ type: 'commandExecution', command: 'npm test' }),
      }),
      expect.objectContaining({
        type: 'item_completed',
        threadId: 'thread-1',
        turnId: 'turn-1',
        itemId: 'command-1',
        completedAt: 10_200,
      }),
      expect.objectContaining({
        type: 'agent_message_delta',
        threadId: 'thread-1',
        turnId: 'turn-1',
        itemId: 'commentary-1',
        phase: 'commentary',
      }),
      expect.objectContaining({
        type: 'run_end',
        threadId: 'thread-1',
        turnId: 'turn-1',
        status: 'completed',
        completedAt: 11_000,
        durationMs: 1_000,
      }),
    ]))
  })

  it('routes child and nested lifecycle updates to their immediate parent without regressing interruption', () => {
    const client = new CodexClient('/tmp/cranberri-client-test')
    const events: Array<{ type: string; threadId?: string; worker?: { threadId: string; status: string; message?: string } }> = []
    client.on('event', (event) => events.push(event))
    const transport = client as unknown as { handleMessage: (message: unknown) => void }

    transport.handleMessage({
      jsonrpc: '2.0',
      method: 'thread/started',
      params: {
        thread: {
          id: 'worker-1',
          parentThreadId: 'parent-1',
          agentNickname: 'Euclid',
          createdAt: 1,
          updatedAt: 1,
          status: { type: 'active', activeFlags: [] },
          turns: [],
        },
      },
    })
    transport.handleMessage({
      jsonrpc: '2.0',
      method: 'item/started',
      params: {
        threadId: 'worker-1',
        item: {
          id: 'spawn-nested',
          type: 'collabAgentToolCall',
          tool: 'spawnAgent',
          status: 'inProgress',
          senderThreadId: 'worker-1',
          receiverThreadIds: ['worker-2'],
        },
      },
    })
    transport.handleMessage({
      jsonrpc: '2.0',
      method: 'turn/completed',
      params: { threadId: 'worker-1', turn: { status: 'interrupted' } },
    })
    transport.handleMessage({
      jsonrpc: '2.0',
      method: 'thread/status/changed',
      params: { threadId: 'worker-1', status: { type: 'idle' } },
    })

    const workerEvents = events.filter((event) => event.type === 'worker_updated')
    expect(workerEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({ threadId: 'parent-1', worker: expect.objectContaining({ threadId: 'worker-1', status: 'running' }) }),
      expect.objectContaining({ threadId: 'worker-1', worker: expect.objectContaining({ threadId: 'worker-2', status: 'pendingInit' }) }),
      expect.objectContaining({ threadId: 'parent-1', worker: expect.objectContaining({ threadId: 'worker-1', status: 'interrupted' }) }),
    ]))
    expect(workerEvents.filter((event) => event.worker?.threadId === 'worker-1').at(-1)?.worker).toMatchObject({
      status: 'interrupted',
      message: '',
    })
  })

  it('marks a failed child turn as errored even when app-server omits an error message', () => {
    const client = new CodexClient('/tmp/cranberri-client-test')
    const events: Array<{ type: string; worker?: { threadId: string; status: string; message?: string } }> = []
    client.on('event', (event) => events.push(event))
    const transport = client as unknown as { handleMessage: (message: unknown) => void }

    transport.handleMessage({
      jsonrpc: '2.0',
      method: 'thread/started',
      params: {
        thread: {
          id: 'worker-1',
          parentThreadId: 'parent-1',
          status: { type: 'active', activeFlags: [] },
          turns: [],
        },
      },
    })
    transport.handleMessage({
      jsonrpc: '2.0',
      method: 'turn/completed',
      params: { threadId: 'worker-1', turn: { status: 'failed' } },
    })

    expect(events.filter((event) => event.worker?.threadId === 'worker-1').at(-1)?.worker).toMatchObject({
      status: 'errored',
      message: 'Worker turn failed',
    })
  })
})

describe('CodexClient app-server inventory evidence', () => {
  it('preserves global versus active-thread registry scope without inventing usability fields', async () => {
    const appsResult = {
      data: [{
        id: 'connector-1',
        name: 'Connector',
        isAccessible: true,
        isEnabled: true,
      }],
      nextCursor: null,
    }
    const mcpResult = {
      data: [{
        name: 'provider-1',
        authStatus: 'oAuth',
        tools: {
          search: { name: 'search', title: 'Search', description: 'Search records' },
        },
        resources: [],
        resourceTemplates: [],
      }],
      nextCursor: null,
    }
    const call = vi.fn(async (method: string) => ({
      jsonrpc: '2.0' as const,
      id: 1,
      result: method === 'app/list' ? appsResult : mcpResult,
    }))
    const client = new CodexClient('/tmp/cranberri-client-test')
    Object.defineProperty(client, 'call', { value: call })

    const globalApps = await client.listApps()
    const activeApps = await client.listApps({ threadId: 'thread-1', forceRefetch: true })
    const globalMcp = await client.listMcpServerStatus()
    const activeMcp = await client.listMcpServerStatus({ threadId: 'thread-1' })

    expect(call).toHaveBeenNthCalledWith(1, 'app/list', {
      limit: 100,
      threadId: null,
      forceRefetch: false,
    })
    expect(call).toHaveBeenNthCalledWith(2, 'app/list', {
      limit: 100,
      threadId: 'thread-1',
      forceRefetch: true,
    })
    expect(call).toHaveBeenNthCalledWith(3, 'mcpServerStatus/list', {
      limit: 100,
      detail: 'toolsAndAuthOnly',
      threadId: null,
    })
    expect(call).toHaveBeenNthCalledWith(4, 'mcpServerStatus/list', {
      limit: 100,
      detail: 'toolsAndAuthOnly',
      threadId: 'thread-1',
    })
    expect(globalApps).toBe(appsResult)
    expect(activeApps).toBe(appsResult)
    expect(globalMcp).toBe(mcpResult)
    expect(activeMcp).toBe(mcpResult)
    expect(activeApps).not.toHaveProperty('capabilityEpoch')
    expect(activeMcp).not.toHaveProperty('capabilityEpoch')
    expect(activeMcp).not.toHaveProperty('taskStatus')
  })

  it('surfaces the generated thread-not-found error used by stale-thread fallback', async () => {
    const call = vi.fn(async () => ({
      jsonrpc: '2.0' as const,
      id: 1,
      error: {
        code: -32600,
        message: 'thread not found: 00000000-0000-4000-8000-000000000001',
      },
    }))
    const client = new CodexClient('/tmp/cranberri-client-test')
    Object.defineProperty(client, 'call', { value: call })

    await expect(client.listApps({ threadId: '00000000-0000-4000-8000-000000000001' }))
      .rejects.toThrow('thread not found')
    await expect(client.listMcpServerStatus({ threadId: '00000000-0000-4000-8000-000000000001' }))
      .rejects.toThrow('thread not found')
  })
})
