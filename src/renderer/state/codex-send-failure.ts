import type { CodexThread } from '@/shared/codex'

export function applyCodexSendFailure(
  thread: CodexThread,
  message: string,
  messageId: string,
  timestamp: number,
): CodexThread {
  return {
    ...thread,
    isRunning: false,
    currentActivity: undefined,
    messages: [...thread.messages, {
      id: messageId,
      role: 'system',
      content: `Error: ${message}`,
      timestamp,
    }],
  }
}
