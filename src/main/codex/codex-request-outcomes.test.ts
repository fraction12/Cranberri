import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type {
  CodexHumanServerRequest,
  CodexHumanServerRequestResponse,
} from '../../shared/codex-requests'
import {
  CodexRequestOutcomeLedger,
  codexRequestOutcomeEntrySchema,
  type CodexRequestOutcomeFileSystem,
} from './codex-request-outcomes'

let directory = ''

beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cranberri-request-outcomes-'))
})

afterEach(() => {
  if (directory) execFileSync('/usr/bin/trash', [directory])
})

function targetPath(): string {
  return path.join(directory, 'request-outcomes.json')
}

function commandRequest(id: string | number = 'request-1'): CodexHumanServerRequest {
  return {
    id,
    method: 'item/commandExecution/requestApproval',
    params: {
      threadId: 'thread-1',
      turnId: 'turn-1',
      itemId: 'item-1',
      startedAtMs: 100,
      environmentId: null,
      reason: 'SENSITIVE_REASON',
      command: 'SENSITIVE_COMMAND',
      cwd: '/SENSITIVE/CWD',
      networkApprovalContext: { host: 'SENSITIVE_HOST', protocol: 'https' },
      commandActions: [{ type: 'unknown', command: 'SENSITIVE_ACTION' }],
      proposedNetworkPolicyAmendments: [{ host: 'SENSITIVE_AMENDMENT_HOST', action: 'allow' }],
      availableDecisions: ['accept', 'decline'],
    },
  }
}

function commandResponse(
  id: string | number = 'request-1',
  decision: 'accept' | 'acceptForSession' | 'decline' | 'cancel' = 'accept',
): CodexHumanServerRequestResponse {
  return {
    id,
    method: 'item/commandExecution/requestApproval',
    response: { decision },
  }
}

function recordResolved(
  ledger: CodexRequestOutcomeLedger,
  id: string | number = 'request-1',
  completedAt = 200,
): void {
  ledger.record({
    request: commandRequest(id),
    response: commandResponse(id),
    attempt: 1,
    receivedAt: 90,
    completedAt,
  })
}

describe('CodexRequestOutcomeLedger', () => {
  it('rehydrates resolved outcomes from a new ledger instance after restart', () => {
    const filePath = targetPath()
    recordResolved(new CodexRequestOutcomeLedger({ filePath }), 'request-restart', 250)

    const restored = new CodexRequestOutcomeLedger({ filePath }).listByThread('thread-1')

    expect(restored).toHaveLength(1)
    expect(restored[0]).toMatchObject({
      requestId: 'request-restart',
      status: 'resolved',
      decision: { kind: 'accepted', scope: 'request', count: 1 },
    })
  })

  it('persists only display-safe summaries for every human request family', () => {
    const ledger = new CodexRequestOutcomeLedger({ filePath: targetPath(), now: () => 1_000 })
    const userInputRequest: CodexHumanServerRequest = {
      id: 'input-1',
      method: 'item/tool/requestUserInput',
      params: {
        threadId: 'thread-1',
        turnId: 'turn-2',
        itemId: 'item-2',
        autoResolutionMs: null,
        questions: [{
          id: 'secret-question',
          header: 'SENSITIVE_HEADER',
          question: 'SENSITIVE_QUESTION',
          isOther: false,
          isSecret: true,
          options: [{ label: 'SENSITIVE_LABEL', description: 'SENSITIVE_DESCRIPTION' }],
        }],
      },
    }
    const userInputResponse: CodexHumanServerRequestResponse = {
      id: 'input-1',
      method: 'item/tool/requestUserInput',
      response: { answers: { 'secret-question': { answers: ['SENSITIVE_SECRET_VALUE'] } } },
    }
    const mcpRequest: CodexHumanServerRequest = {
      id: 'mcp-1',
      method: 'mcpServer/elicitation/request',
      params: {
        threadId: 'thread-1',
        turnId: null,
        serverName: 'SENSITIVE_SERVER',
        _meta: { hidden: 'SENSITIVE_META' },
        message: 'SENSITIVE_MESSAGE',
        mode: 'url',
        url: 'https://SENSITIVE_URL.example',
        elicitationId: 'SENSITIVE_ELICITATION',
      },
    }
    const mcpResponse: CodexHumanServerRequestResponse = {
      id: 'mcp-1',
      method: 'mcpServer/elicitation/request',
      response: { action: 'accept', content: { token: 'SENSITIVE_MCP_CONTENT' }, _meta: null },
    }

    ledger.record({
      request: commandRequest(),
      response: commandResponse(),
      attempt: 2,
      receivedAt: 90,
      completedAt: 200,
    })
    ledger.record({
      request: userInputRequest,
      response: userInputResponse,
      attempt: 1,
      receivedAt: 201,
      completedAt: 202,
    })
    ledger.record({
      request: mcpRequest,
      response: mcpResponse,
      attempt: 1,
      receivedAt: 203,
      completedAt: 204,
    })

    const bytes = fs.readFileSync(targetPath(), 'utf8')
    for (const secret of [
      'SENSITIVE_REASON',
      'SENSITIVE_COMMAND',
      '/SENSITIVE/CWD',
      'SENSITIVE_HOST',
      'SENSITIVE_AMENDMENT_HOST',
      'SENSITIVE_HEADER',
      'SENSITIVE_QUESTION',
      'SENSITIVE_SECRET_VALUE',
      'SENSITIVE_SERVER',
      'SENSITIVE_META',
      'SENSITIVE_MESSAGE',
      'SENSITIVE_URL',
      'SENSITIVE_ELICITATION',
      'SENSITIVE_MCP_CONTENT',
    ]) {
      expect(bytes).not.toContain(secret)
    }
    expect(ledger.listByThread('thread-1')).toEqual([
      expect.objectContaining({
        requestId: 'mcp-1',
        itemId: null,
        decision: { kind: 'accepted', scope: 'request', count: 1 },
      }),
      expect.objectContaining({
        requestId: 'input-1',
        decision: { kind: 'answered', scope: 'request', count: 1 },
      }),
      expect.objectContaining({
        requestId: 'request-1',
        attempt: 2,
        decision: { kind: 'accepted', scope: 'request', count: 1 },
      }),
    ])
  })

  it.each([
    ['declined', 'declined'],
    ['cancelled', 'cancelled'],
    ['failed', 'failed'],
    ['external', 'external'],
  ] as const)('records a display-safe %s terminal state', (status, kind) => {
    const ledger = new CodexRequestOutcomeLedger({ filePath: targetPath(), now: () => 500 })
    const entry = ledger.record({
      request: commandRequest(),
      status,
      attempt: 3,
      receivedAt: 100,
    })

    expect(entry).toMatchObject({
      status,
      decision: { kind, scope: 'request', count: 1 },
      completedAt: 500,
    })
  })

  it('derives declined and cancelled states from correlated typed responses', () => {
    const ledger = new CodexRequestOutcomeLedger({ filePath: targetPath() })
    const declined = ledger.record({
      request: commandRequest('declined'),
      response: commandResponse('declined', 'decline'),
      attempt: 1,
      receivedAt: 1,
      completedAt: 2,
    })
    const cancelled = ledger.record({
      request: commandRequest('cancelled'),
      response: commandResponse('cancelled', 'cancel'),
      attempt: 1,
      receivedAt: 3,
      completedAt: 4,
    })

    expect(declined.status).toBe('declined')
    expect(cancelled.status).toBe('cancelled')
  })

  it('rejects mismatched responses and unknown persisted fields', () => {
    const ledger = new CodexRequestOutcomeLedger({ filePath: targetPath() })
    expect(() => ledger.record({
      request: commandRequest('request-1'),
      response: commandResponse('request-2'),
      attempt: 1,
      receivedAt: 1,
    })).toThrow('does not match')
    expect(fs.existsSync(targetPath())).toBe(false)

    expect(() => codexRequestOutcomeEntrySchema.parse({
      requestId: 'request-1',
      method: 'item/commandExecution/requestApproval',
      threadId: 'thread-1',
      turnId: 'turn-1',
      itemId: 'item-1',
      status: 'resolved',
      decision: { kind: 'accepted', scope: 'request', count: 1 },
      requestedAt: 1,
      completedAt: 2,
      attempt: 1,
      rawRequest: { command: 'must never persist' },
    })).toThrow()
  })

  it('recovers from corrupt and oversized primary files through the last-good snapshot', () => {
    const target = targetPath()
    const ledger = new CodexRequestOutcomeLedger({ filePath: target, maxEntries: 2, maxBytes: 2_048 })
    recordResolved(ledger, 'first', 100)
    recordResolved(ledger, 'second', 200)
    fs.writeFileSync(target, '{"version":1')

    expect(ledger.read()).toMatchObject({
      source: 'backup',
      store: { entries: [expect.objectContaining({ requestId: 'first' })] },
    })

    recordResolved(ledger, 'replacement', 300)
    const oversized = {
      version: 1,
      entries: Array.from({ length: 3 }, (_, index) => ({
        ...ledger.listByThread('thread-1')[0],
        requestId: `oversized-${index}`,
      })),
    }
    fs.writeFileSync(target, JSON.stringify(oversized))

    expect(ledger.read()).toMatchObject({
      source: 'backup',
      store: { entries: [expect.objectContaining({ requestId: 'first' })] },
    })
  })

  it('updates duplicate identities and lists only the requested thread newest first', () => {
    const ledger = new CodexRequestOutcomeLedger({ filePath: targetPath() })
    recordResolved(ledger, 'same', 100)
    ledger.record({
      request: commandRequest('same'),
      status: 'failed',
      attempt: 2,
      receivedAt: 90,
      completedAt: 300,
    })
    const otherThread = commandRequest('same')
    otherThread.params.threadId = 'thread-2'
    ledger.record({
      request: otherThread,
      response: commandResponse('same'),
      attempt: 1,
      receivedAt: 100,
      completedAt: 400,
    })

    expect(ledger.listByThread('thread-1')).toEqual([
      expect.objectContaining({ requestId: 'same', status: 'failed', attempt: 2 }),
    ])
    expect(ledger.listByThread('thread-2')).toEqual([
      expect.objectContaining({ requestId: 'same', status: 'resolved', attempt: 1 }),
    ])
    expect(ledger.read().store.entries).toHaveLength(2)
  })

  it('prunes all outcomes for one thread without disturbing another', () => {
    const ledger = new CodexRequestOutcomeLedger({ filePath: targetPath() })
    recordResolved(ledger, 'one', 100)
    recordResolved(ledger, 'two', 200)
    const other = commandRequest('other')
    other.params.threadId = 'thread-2'
    ledger.record({
      request: other,
      response: commandResponse('other'),
      attempt: 1,
      receivedAt: 200,
      completedAt: 300,
    })

    expect(ledger.pruneThread('thread-1')).toBe(2)
    expect(ledger.pruneThread('thread-1')).toBe(0)
    expect(ledger.listByThread('thread-1')).toEqual([])
    expect(ledger.listByThread('thread-2')).toHaveLength(1)
  })

  it('bounds entry count and serialized bytes by evicting the oldest outcomes', () => {
    const ledger = new CodexRequestOutcomeLedger({
      filePath: targetPath(),
      maxEntries: 3,
      maxBytes: 700,
    })
    for (let index = 0; index < 8; index += 1) {
      recordResolved(ledger, `request-${index}-${'x'.repeat(80)}`, 100 + index)
    }

    const result = ledger.read().store
    expect(result.entries.length).toBeLessThanOrEqual(3)
    expect(result.entries.at(-1)?.requestId).toContain('request-7-')
    expect(Buffer.byteLength(JSON.stringify(result), 'utf8')).toBeLessThanOrEqual(700)
  })

  it('promotes writes atomically and rotates only a valid primary to last-good', () => {
    const renames: Array<[string, string]> = []
    const fileSystem: CodexRequestOutcomeFileSystem = {
      existsSync: fs.existsSync,
      mkdirSync: fs.mkdirSync,
      readFileSync: fs.readFileSync,
      writeFileSync: fs.writeFileSync,
      renameSync(from, to) {
        renames.push([from, to])
        fs.renameSync(from, to)
      },
    }
    const target = targetPath()
    const ledger = new CodexRequestOutcomeLedger({ filePath: target, fileSystem, now: () => 42 })
    recordResolved(ledger, 'first', 100)
    recordResolved(ledger, 'second', 200)

    expect(renames.some(([from, to]) => from.endsWith('.tmp') && to === target)).toBe(true)
    expect(renames.some(([from, to]) => from.endsWith('.tmp') && to === `${target}.last-good`)).toBe(true)
    expect(fs.readdirSync(directory).every((name) => !name.endsWith('.tmp'))).toBe(true)
    expect(JSON.parse(fs.readFileSync(`${target}.last-good`, 'utf8')).entries).toEqual([
      expect.objectContaining({ requestId: 'first' }),
    ])
  })
})
