import type { CodexThread } from '@/shared/codex'
import { appendCodexTurnError, completeCodexActivityTurn } from './codex-turn-activity'

export function applyCodexSendFailure(
  thread: CodexThread,
  message: string,
  messageId: string,
  timestamp: number,
): CodexThread {
  const activeTurn = [...(thread.activityTurns ?? [])].reverse().find((turn) => turn.status === 'running')
  const failedThread = activeTurn
    ? appendCodexTurnError(
        completeCodexActivityTurn(thread, activeTurn.id, 'failed', timestamp),
        activeTurn.id,
        message,
        timestamp,
      )
    : thread
  return {
    ...failedThread,
    isRunning: false,
    currentActivity: undefined,
    messages: activeTurn
      ? thread.messages
      : [...thread.messages, {
          id: messageId,
          role: 'system',
          content: `Error: ${message}`,
          timestamp,
        }],
  }
}
