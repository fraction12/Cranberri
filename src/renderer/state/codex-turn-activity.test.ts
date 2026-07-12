import { describe, expect, it } from 'vitest'
import type { CodexSessionThread, CodexThread } from '../../shared/codex'
import {
  appendCodexSteeringItem,
  appendCodexTurnError,
  applyCodexItemLifecycle,
  completeCodexActivityTurn,
  createOptimisticCodexTurn,
  hydrateCodexTranscript,
  reconcileCodexTurnStarted,
} from './codex-turn-activity'

function thread(): CodexThread {
  const messageId = 'user-local'
  const turn = createOptimisticCodexTurn(messageId, 1_000)
  return {
    id: 'thread-1',
    title: 'Thread',
    repoId: 'repo-1',
    messages: [{ id: messageId, role: 'user', content: 'Inspect this', timestamp: 1_000, turnId: turn.id }],
    activityTurns: [turn],
    pendingApprovals: [],
    isRunning: true,
  }
}

describe('Codex turn activity state', () => {
  it('hydrates persisted tools, reasoning, steering, and final answers into one turn', () => {
    const session: CodexSessionThread = {
      id: 'thread-1',
      title: 'Thread',
      preview: 'Inspect this',
      createdAt: 1,
      updatedAt: 3,
      archived: false,
      turnCount: 1,
      turns: [{
        id: 'turn-1',
        status: 'completed',
        startedAt: 1,
        completedAt: 3,
        durationMs: 2_000,
        items: [
          { id: 'user-1', type: 'userMessage', content: [{ type: 'text', text: 'Inspect this' }] },
          { id: 'reasoning-1', type: 'reasoning', summary: ['Reading the state'], content: [] },
          { id: 'command-1', type: 'commandExecution', command: 'rg state src', status: 'completed', exitCode: 0 },
          { id: 'steer-1', type: 'userMessage', content: [{ type: 'text', text: 'Focus on chat only' }] },
          { id: 'answer-1', type: 'agentMessage', phase: 'final_answer', text: 'Done.' },
        ],
      }],
    }

    const result = hydrateCodexTranscript(session)

    expect(result.messages).toEqual([
      expect.objectContaining({ id: 'user-1', role: 'user', turnId: 'turn-1' }),
      expect.objectContaining({ id: 'reasoning-1', role: 'reasoning', turnId: 'turn-1' }),
      expect.objectContaining({ id: 'answer-1', role: 'assistant', turnId: 'turn-1' }),
    ])
    expect(result.activityTurns).toEqual([
      expect.objectContaining({
        id: 'turn-1',
        status: 'completed',
        durationMs: 2_000,
        items: [
          expect.objectContaining({ id: 'reasoning-1', kind: 'reasoning' }),
          expect.objectContaining({ id: 'command-1', kind: 'command' }),
          expect.objectContaining({ id: 'steer-1', kind: 'steering', content: 'Focus on chat only' }),
        ],
      }),
    ])
  })

  it('reconciles an optimistic turn with the app-server turn id', () => {
    const current = thread()
    const next = reconcileCodexTurnStarted(current, 'turn-1', 1_050)

    expect(next.activityTurns).toEqual([
      expect.objectContaining({ id: 'turn-1', startedAt: 1_050, status: 'running' }),
    ])
    expect(next.messages[0]).toMatchObject({ turnId: 'turn-1' })
  })

  it('upserts item completion without duplicating the started row', () => {
    let current = reconcileCodexTurnStarted(thread(), 'turn-1', 1_050)
    current = applyCodexItemLifecycle(current, 'turn-1', {
      id: 'command-1',
      type: 'commandExecution',
      command: 'npm test',
      status: 'inProgress',
    }, 'started', 1_100)
    current = applyCodexItemLifecycle(current, 'turn-1', {
      id: 'command-1',
      type: 'commandExecution',
      command: 'npm test',
      status: 'completed',
      exitCode: 0,
      durationMs: 50,
    }, 'completed', 1_150)

    expect(current.activityTurns![0].items).toEqual([
      expect.objectContaining({
        id: 'command-1',
        status: 'completed',
        startedAt: 1_100,
        completedAt: 1_150,
        durationMs: 50,
      }),
    ])
  })

  it('records steering inside the active turn and completes with server timing', () => {
    let current = reconcileCodexTurnStarted(thread(), 'turn-1', 1_050)
    current = appendCodexSteeringItem(current, 'Focus on chat only', 1_200, 'steer-1')
    current = completeCodexActivityTurn(current, 'turn-1', 'completed', 2_050, 1_000)

    expect(current.activityTurns![0]).toMatchObject({
      id: 'turn-1',
      status: 'completed',
      completedAt: 2_050,
      durationMs: 1_000,
      items: [expect.objectContaining({ id: 'steer-1', kind: 'steering', content: 'Focus on chat only' })],
    })
  })

  it('reconciles a completion when the start notification was missed', () => {
    const current = completeCodexActivityTurn(thread(), 'turn-1', 'completed', 2_000, 1_000)

    expect(current.activityTurns![0]).toMatchObject({
      id: 'turn-1',
      status: 'completed',
      startedAt: 1_000,
      completedAt: 2_000,
      durationMs: 1_000,
    })
    expect(current.messages[0]).toMatchObject({ turnId: 'turn-1' })
  })

  it('keeps a terminal failure inside the owning turn', () => {
    let current = reconcileCodexTurnStarted(thread(), 'turn-1', 1_050)
    current = appendCodexTurnError(current, 'turn-1', 'model unavailable', 1_500)

    expect(current.activityTurns![0].items).toContainEqual(expect.objectContaining({
      id: 'turn-error:turn-1',
      kind: 'other',
      status: 'failed',
      title: 'Turn failed',
      detail: 'model unavailable',
    }))
  })
})
