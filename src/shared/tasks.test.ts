import { describe, expect, it } from 'vitest'
import {
  firstTurnIdempotencyKey,
  firstTurnRecoveryAction,
  persistedFirstTurnState,
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

    expect(firstTurnRecoveryAction(sending, tagged, 'empty')).toBe('send')
    expect(firstTurnRecoveryAction(sending, tagged, 'matching')).toBe('acknowledge')
    expect(firstTurnRecoveryAction(sending, tagged, 'conflicting')).toBe('needsAttention')
    expect(firstTurnRecoveryAction(task({
      pendingFirstTurn: { payload: { input: tagged }, delivery: 'acknowledged' },
    }), tagged, 'matching')).toBe('alreadyAcknowledged')
    expect(firstTurnRecoveryAction(task({ firstTurnIdempotencyKey: 'send-1' }), tagged, 'matching')).toBe('alreadyAcknowledged')
  })

  it('acknowledges only a single persisted turn with the expected user payload', () => {
    const tagged = withFirstTurnIdempotencyKey([{ type: 'text', text: 'Ship it' }], 'send-1')
    const turn = (text: string) => ({
      id: 'turn-1',
      items: [{ id: 'user-1', type: 'userMessage', content: [{ type: 'text', text }] }],
    })

    expect(persistedFirstTurnState([], tagged)).toBe('empty')
    expect(persistedFirstTurnState([turn('Ship it')], tagged)).toBe('matching')
    expect(persistedFirstTurnState([turn('Something else')], tagged)).toBe('conflicting')
    expect(persistedFirstTurnState([turn('Ship it'), turn('Follow-up')], tagged)).toBe('conflicting')
  })

  it('compares multimodal first-turn inputs and ordering exactly', () => {
    const input = withFirstTurnIdempotencyKey([
      { type: 'text', text: 'Inspect these', text_elements: [{ byteRange: { start: 0, end: 7 }, placeholder: null }] },
      { type: 'image', url: 'data:image/png;base64,abc', detail: 'high' },
      { type: 'localImage', path: '/tmp/capture.png', detail: 'low' },
      { type: 'skill', name: 'review', path: '/skills/review/SKILL.md' },
    ], 'send-multimodal')
    const persisted = withoutFirstTurnIdempotencyKey(input)
    const turn = (content: Array<Record<string, unknown>>) => ({
      id: 'turn-1', items: [{ id: 'user-1', type: 'userMessage', content }],
    })

    expect(persistedFirstTurnState([turn(persisted)], input)).toBe('matching')
    expect(persistedFirstTurnState([turn([...persisted].reverse())], input)).toBe('conflicting')
    expect(persistedFirstTurnState([turn(persisted.map((item, index) => (
      index === 1 ? { ...item, detail: 'low' } : item
    )))], input)).toBe('conflicting')
  })
})
