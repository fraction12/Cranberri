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
