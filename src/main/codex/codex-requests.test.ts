import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CodexServerRequestHandler } from '../../shared/codex'
import {
  CODEX_HUMAN_SERVER_REQUEST_METHODS,
  CodexHumanRequestBrokerError,
  CodexHumanServerRequestBroker,
  type CodexPendingHumanServerRequest,
} from './codex-requests'

class FakeRegistrar {
  readonly handlers = new Map<string, CodexServerRequestHandler>()

  registerRequestHandler(method: string, handler: CodexServerRequestHandler): () => void {
    if (this.handlers.has(method)) throw new Error(`duplicate handler: ${method}`)
    this.handlers.set(method, handler)
    return () => {
      if (this.handlers.get(method) === handler) this.handlers.delete(method)
    }
  }

  invoke(method: string, params: Record<string, unknown>, id: string | number): Promise<unknown> {
    const handler = this.handlers.get(method)
    if (!handler) throw new Error(`missing handler: ${method}`)
    return handler(params, { id, method }) as Promise<unknown>
  }
}

const commandParams = {
  threadId: 'thread-1',
  turnId: 'turn-1',
  itemId: 'item-1',
  startedAtMs: 1_720_000_000_000,
  environmentId: null,
  command: 'npm test',
  cwd: '/repo',
  availableDecisions: ['accept', 'decline'],
} as const

const fileParams = {
  threadId: 'thread-1',
  turnId: 'turn-1',
  itemId: 'item-file-1',
  startedAtMs: 1_720_000_000_100,
  reason: 'Write a generated file',
  grantRoot: null,
} as const

function setup(options: Partial<ConstructorParameters<typeof CodexHumanServerRequestBroker>[0]> = {}) {
  const pending: CodexPendingHumanServerRequest[] = []
  const registrar = new FakeRegistrar()
  const broker = new CodexHumanServerRequestBroker({
    onPending: (request) => pending.push(request),
    timeoutMs: 10_000,
    replayTtlMs: 30_000,
    ...options,
  })
  const unregister = broker.register(registrar)
  return { broker, pending, registrar, unregister }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('CodexHumanServerRequestBroker registration and validation', () => {
  it('registers exactly the five human methods and never Guardian transport', () => {
    const { broker, registrar, unregister } = setup()

    expect([...registrar.handlers.keys()]).toEqual(CODEX_HUMAN_SERVER_REQUEST_METHODS)
    expect(registrar.handlers.has('thread/approveGuardianDeniedAction')).toBe(false)
    expect(registrar.handlers.has('item/autoApprovalReview/started')).toBe(false)

    unregister()
    expect(registrar.handlers.size).toBe(0)
    expect(broker.pendingCount).toBe(0)
  })

  it('rejects malformed params and mismatched handler context before emitting pending work', async () => {
    const { broker, pending, registrar } = setup()
    const commandHandler = registrar.handlers.get('item/commandExecution/requestApproval')
    expect(commandHandler).toBeDefined()

    await expect(registrar.invoke('item/commandExecution/requestApproval', {
      ...commandParams,
      unexpected: true,
    }, 'invalid')).rejects.toMatchObject({ code: 'invalid_request' })

    const mismatched = commandHandler?.(commandParams, {
      id: 'guardian',
      method: 'thread/approveGuardianDeniedAction',
    })
    await expect(mismatched).rejects.toMatchObject({ code: 'invalid_request' })
    expect(pending).toEqual([])
    expect(broker.pendingCount).toBe(0)
  })

  it('rolls back partial registration and can be registered again', () => {
    const registrar = new FakeRegistrar()
    registrar.handlers.set('item/permissions/requestApproval', vi.fn())
    const broker = new CodexHumanServerRequestBroker({ onPending: vi.fn() })

    expect(() => broker.register(registrar)).toThrow('duplicate handler')
    expect([...registrar.handlers.keys()]).toEqual(['item/permissions/requestApproval'])

    registrar.handlers.clear()
    const unregister = broker.register(registrar)
    expect(registrar.handlers.size).toBe(5)
    unregister()
  })
})

describe('CodexHumanServerRequestBroker response lifecycle', () => {
  it.each([
    {
      method: 'item/permissions/requestApproval',
      params: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        itemId: 'permissions-1',
        environmentId: null,
        startedAtMs: 1_720_000_000_200,
        cwd: '/repo',
        reason: 'Needs broader access',
        permissions: { network: { enabled: true }, fileSystem: null },
      },
      response: { permissions: { network: { enabled: true } }, scope: 'turn' },
    },
    {
      method: 'item/tool/requestUserInput',
      params: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        itemId: 'input-1',
        questions: [{
          id: 'target',
          header: 'Target',
          question: 'Where should this run?',
          isOther: false,
          isSecret: false,
          options: [{ label: 'Local', description: 'Run on this machine' }],
        }],
        autoResolutionMs: null,
      },
      response: { answers: { target: { answers: ['Local'] } } },
    },
    {
      method: 'mcpServer/elicitation/request',
      params: {
        threadId: 'thread-1',
        turnId: null,
        serverName: 'github',
        _meta: null,
        message: 'Choose repository settings',
        mode: 'form',
        requestedSchema: { type: 'object', properties: { private: { type: 'boolean' } } },
      },
      response: { action: 'accept', content: { private: true }, _meta: null },
    },
  ] as const)('routes and correlates $method', async ({ method, params, response }) => {
    const { broker, registrar } = setup()
    const result = registrar.invoke(method, params as unknown as Record<string, unknown>, `request:${method}`)

    broker.respond({ id: `request:${method}`, method, response })

    await expect(result).resolves.toEqual(response)
  })

  it('emits a validated pending request and resolves it with a correlated renderer response', async () => {
    const { broker, pending, registrar } = setup()
    const result = registrar.invoke('item/commandExecution/requestApproval', commandParams, 'request-1')

    expect(pending).toHaveLength(1)
    expect(pending[0]).toMatchObject({
      attempt: 1,
      request: {
        id: 'request-1',
        method: 'item/commandExecution/requestApproval',
        params: commandParams,
      },
    })
    expect(broker.listPending()).toEqual(pending)

    expect(broker.respond({
      id: 'request-1',
      method: 'item/commandExecution/requestApproval',
      response: { decision: 'accept' },
    })).toBe(true)
    await expect(result).resolves.toEqual({ decision: 'accept' })
    expect(broker.pendingCount).toBe(0)
  })

  it('keeps the original resolver for identical in-flight duplicates', async () => {
    const { broker, pending, registrar } = setup()
    const first = registrar.invoke('item/fileChange/requestApproval', fileParams, 7)
    const duplicate = registrar.invoke('item/fileChange/requestApproval', { ...fileParams }, 7)

    expect(duplicate).toBe(first)
    expect(pending).toHaveLength(1)

    broker.respond({
      id: 7,
      method: 'item/fileChange/requestApproval',
      response: { decision: 'decline' },
    })
    await expect(Promise.all([first, duplicate])).resolves.toEqual([
      { decision: 'decline' },
      { decision: 'decline' },
    ])
  })

  it('rejects conflicting duplicate ids without disturbing the original request', async () => {
    const { broker, registrar } = setup()
    const original = registrar.invoke('item/commandExecution/requestApproval', commandParams, 'same-id')
    const conflict = registrar.invoke('item/commandExecution/requestApproval', {
      ...commandParams,
      command: 'npm run build',
    }, 'same-id')

    await expect(conflict).rejects.toMatchObject({ code: 'duplicate_request' })
    expect(broker.pendingCount).toBe(1)

    broker.respond({
      id: 'same-id',
      method: 'item/commandExecution/requestApproval',
      response: { decision: 'cancel' },
    })
    await expect(original).resolves.toEqual({ decision: 'cancel' })
  })

  it('validates response shape and method correlation before settling', async () => {
    const { broker, registrar } = setup()
    const result = registrar.invoke('item/fileChange/requestApproval', fileParams, 'response-check')

    expect(() => broker.respond({
      id: 'response-check',
      method: 'item/fileChange/requestApproval',
      response: { decision: { applyNetworkPolicyAmendment: { network_policy_amendment: { host: 'x', action: 'allow' } } } },
    })).toThrowError(CodexHumanRequestBrokerError)
    expect(() => broker.respond({
      id: 'response-check',
      method: 'item/commandExecution/requestApproval',
      response: { decision: 'accept' },
    })).toThrow(expect.objectContaining({ code: 'method_mismatch' }))
    expect(broker.pendingCount).toBe(1)

    broker.respond({
      id: 'response-check',
      method: 'item/fileChange/requestApproval',
      response: { decision: 'acceptForSession' },
    })
    await expect(result).resolves.toEqual({ decision: 'acceptForSession' })
  })

  it('replays a successful response for an identical transport retry', async () => {
    const { broker, pending, registrar } = setup()
    const first = registrar.invoke('item/commandExecution/requestApproval', commandParams, 'retry-success')
    broker.respond({
      id: 'retry-success',
      method: 'item/commandExecution/requestApproval',
      response: { decision: 'acceptForSession' },
    })
    await first

    await expect(registrar.invoke(
      'item/commandExecution/requestApproval',
      { ...commandParams },
      'retry-success',
    )).resolves.toEqual({ decision: 'acceptForSession' })
    expect(pending).toHaveLength(1)

    await expect(registrar.invoke('item/commandExecution/requestApproval', {
      ...commandParams,
      command: 'different command',
    }, 'retry-success')).rejects.toMatchObject({ code: 'duplicate_request' })
  })

  it('isolates pending callbacks and replay state from consumer mutation', async () => {
    const { broker, pending, registrar } = setup()
    const first = registrar.invoke('item/commandExecution/requestApproval', commandParams, 'isolated')
    const callbackRequest = pending[0].request as { method: string }
    callbackRequest.method = 'thread/approveGuardianDeniedAction'

    broker.respond({
      id: 'isolated',
      method: 'item/commandExecution/requestApproval',
      response: { decision: 'accept' },
    })
    const firstResponse = await first as { decision: string }
    firstResponse.decision = 'decline'

    await expect(registrar.invoke(
      'item/commandExecution/requestApproval',
      commandParams,
      'isolated',
    )).resolves.toEqual({ decision: 'accept' })
  })

  it('bounds pending requests and distinguishes string ids from numeric ids', async () => {
    const { broker, registrar } = setup({ maxPending: 2 })
    const numeric = registrar.invoke('item/fileChange/requestApproval', fileParams, 1)
    const textual = registrar.invoke('item/fileChange/requestApproval', {
      ...fileParams,
      itemId: 'item-file-2',
    }, '1')

    await expect(registrar.invoke('item/fileChange/requestApproval', {
      ...fileParams,
      itemId: 'item-file-3',
    }, 3)).rejects.toMatchObject({ code: 'capacity' })
    expect(broker.pendingCount).toBe(2)

    broker.cancel(1)
    broker.cancel('1')
    await expect(numeric).rejects.toMatchObject({ code: 'cancelled' })
    await expect(textual).rejects.toMatchObject({ code: 'cancelled' })
  })
})

describe('CodexHumanServerRequestBroker terminal behavior', () => {
  it('reports response and terminal settlements without exposing them to transport control', async () => {
    const settlements: unknown[] = []
    const { broker, registrar } = setup({ onSettled: (settlement) => settlements.push(settlement) })
    const accepted = registrar.invoke('item/commandExecution/requestApproval', commandParams, 'accepted')
    broker.respond({
      id: 'accepted',
      method: 'item/commandExecution/requestApproval',
      response: { decision: 'accept' },
    })
    await accepted

    const cancelled = registrar.invoke('item/fileChange/requestApproval', fileParams, 'cancelled')
    broker.cancel('cancelled')
    await expect(cancelled).rejects.toMatchObject({ code: 'cancelled' })

    expect(settlements).toEqual([
      expect.objectContaining({
        type: 'response',
        pending: expect.objectContaining({ request: expect.objectContaining({ id: 'accepted' }) }),
        response: expect.objectContaining({ response: { decision: 'accept' } }),
      }),
      expect.objectContaining({
        type: 'terminal',
        code: 'cancelled',
        pending: expect.objectContaining({ request: expect.objectContaining({ id: 'cancelled' }) }),
      }),
    ])
  })

  it('times out a request, emits no stale response, and permits a new retry attempt', async () => {
    vi.useFakeTimers()
    const { broker, pending, registrar } = setup({ timeoutMs: 1_000 })
    const first = registrar.invoke('item/fileChange/requestApproval', fileParams, 'timeout')
    const timedOut = expect(first).rejects.toMatchObject({ code: 'timeout' })

    await vi.advanceTimersByTimeAsync(1_000)
    await timedOut
    expect(broker.respond({
      id: 'timeout',
      method: 'item/fileChange/requestApproval',
      response: { decision: 'accept' },
    })).toBe(false)

    const retry = registrar.invoke('item/fileChange/requestApproval', fileParams, 'timeout')
    expect(pending.at(-1)?.attempt).toBe(2)
    broker.respond({
      id: 'timeout',
      method: 'item/fileChange/requestApproval',
      response: { decision: 'accept' },
    })
    await expect(retry).resolves.toEqual({ decision: 'accept' })
  })

  it('supports explicit cancellation and external serverRequest/resolved', async () => {
    const { broker, pending, registrar } = setup()
    const cancelled = registrar.invoke('item/fileChange/requestApproval', fileParams, 'cancel-me')
    expect(broker.cancel('cancel-me', 'Task closed')).toBe(true)
    expect(broker.cancel('cancel-me')).toBe(false)
    await expect(cancelled).rejects.toMatchObject({ code: 'cancelled', message: 'Task closed' })

    const external = registrar.invoke('item/fileChange/requestApproval', fileParams, 'external')
    expect(broker.handleServerRequestResolved({ requestId: 'external' })).toBe(true)
    expect(broker.handleServerRequestResolved({ requestId: 'external' })).toBe(false)
    await expect(external).rejects.toMatchObject({ code: 'externally_resolved' })
    expect(() => broker.handleServerRequestResolved({ requestId: { bad: true } })).toThrow(
      expect.objectContaining({ code: 'invalid_resolution' }),
    )

    const retry = registrar.invoke('item/fileChange/requestApproval', fileParams, 'external')
    expect(pending.at(-1)?.attempt).toBe(2)
    broker.respond({
      id: 'external',
      method: 'item/fileChange/requestApproval',
      response: { decision: 'cancel' },
    })
    await expect(retry).resolves.toEqual({ decision: 'cancel' })
  })

  it('cleans up when pending delivery throws and when the broker is disposed', async () => {
    const registrar = new FakeRegistrar()
    const broker = new CodexHumanServerRequestBroker({
      onPending: () => { throw new Error('renderer unavailable') },
    })
    broker.register(registrar)

    await expect(registrar.invoke(
      'item/commandExecution/requestApproval',
      commandParams,
      'callback-failure',
    )).rejects.toMatchObject({ code: 'delivery_failed' })
    expect(broker.pendingCount).toBe(0)

    const delivered: CodexPendingHumanServerRequest[] = []
    const secondRegistrar = new FakeRegistrar()
    const second = new CodexHumanServerRequestBroker({ onPending: (request) => delivered.push(request) })
    second.register(secondRegistrar)
    const active = secondRegistrar.invoke('item/fileChange/requestApproval', fileParams, 'dispose')
    second.dispose()

    await expect(active).rejects.toMatchObject({ code: 'cancelled' })
    expect(secondRegistrar.handlers.size).toBe(0)
    expect(second.pendingCount).toBe(0)
    expect(() => second.register(secondRegistrar)).toThrow(expect.objectContaining({ code: 'disposed' }))
  })
})
