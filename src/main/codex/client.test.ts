import { describe, expect, it, vi } from 'vitest'
import { CodexClient } from './client'

describe('CodexClient turn transport', () => {
  it('sends the resolved model, effort, and service tier to turn/start', async () => {
    const client = new CodexClient('/tmp/cranberri-client-test')
    const call = vi.fn(async () => ({
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
