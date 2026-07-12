import { describe, expect, it } from 'vitest'
import {
  firstTurnIdempotencyKey,
  firstTurnRecoveryAction,
  taskFirstTurnIdempotencyKey,
  withFirstTurnIdempotencyKey,
  withoutFirstTurnIdempotencyKey,
  type Task,
} from './tasks'

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    projectId: 'project-1',
    threadId: null,
    checkoutId: 'checkout-1',
    worktreeId: null,
    role: 'root',
    location: 'local',
    state: 'local',
    baseRef: 'refs/heads/main',
    baseSha: null,
    environmentId: null,
    environmentRevision: null,
    pendingFirstTurn: null,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

describe('first-turn idempotency', () => {
  it('round-trips one private key without changing Codex input', () => {
    const input = [{ type: 'text', text: 'Ship it' }]
    const tagged = withFirstTurnIdempotencyKey(input, 'send-1')

    expect(firstTurnIdempotencyKey(tagged)).toBe('send-1')
    expect(withoutFirstTurnIdempotencyKey(tagged)).toEqual(input)
  })

  it('finds the same key while pending and after acknowledgement', () => {
    const tagged = withFirstTurnIdempotencyKey([{ type: 'text', text: 'Ship it' }], 'send-1')
    expect(taskFirstTurnIdempotencyKey(task({
      pendingFirstTurn: { payload: { input: tagged }, delivery: 'sending' },
    }))).toBe('send-1')
    expect(taskFirstTurnIdempotencyKey(task({ firstTurnIdempotencyKey: 'send-1' }))).toBe('send-1')
  })

  it('reconciles crashes before send, after send, and after acknowledgement', () => {
    const tagged = withFirstTurnIdempotencyKey([{ type: 'text', text: 'Ship it' }], 'send-1')
    const sending = task({ pendingFirstTurn: { payload: { input: tagged }, delivery: 'sending' } })

    expect(firstTurnRecoveryAction(sending, tagged, 0)).toBe('send')
    expect(firstTurnRecoveryAction(sending, tagged, 1)).toBe('acknowledge')
    expect(firstTurnRecoveryAction(task({
      pendingFirstTurn: { payload: { input: tagged }, delivery: 'acknowledged' },
    }), tagged, 1)).toBe('alreadyAcknowledged')
    expect(firstTurnRecoveryAction(task({ firstTurnIdempotencyKey: 'send-1' }), tagged, 1)).toBe('alreadyAcknowledged')
  })
})
