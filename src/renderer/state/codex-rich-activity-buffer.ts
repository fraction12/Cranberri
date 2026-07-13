import type { CodexActivityTurn, CodexEvent, CodexThread } from '../../shared/codex'
import { mergeCodexActivityProgress } from './codex-rich-activity'

export type CodexRichActivityEvent = Extract<CodexEvent, {
  type: 'item_progress' | 'turn_diff_updated'
}>

type CodexActivityTurnWithLiveDiff = CodexActivityTurn & { liveDiff?: string }

export type CodexRichActivityBuffer = readonly CodexRichActivityEvent[]

export function codexActivityTurnDiff(turn: CodexActivityTurn): string | undefined {
  return (turn as CodexActivityTurnWithLiveDiff).liveDiff
}

export function queueCodexRichActivityEvent(
  buffer: readonly CodexRichActivityEvent[],
  event: CodexRichActivityEvent,
): CodexRichActivityBuffer {
  if (event.type === 'item_progress') return [...buffer, event]

  const existing = buffer.findIndex((candidate) => candidate.type === 'turn_diff_updated'
    && candidate.threadId === event.threadId
    && candidate.turnId === event.turnId)
  if (existing === -1) return [...buffer, event]
  if (buffer[existing].type === 'turn_diff_updated' && buffer[existing].diff === event.diff) return buffer

  const next = [...buffer]
  next[existing] = event
  return next
}

function applyTurnDiff(
  thread: CodexThread,
  turnId: string,
  diff: string,
): CodexThread {
  const turns = thread.activityTurns ?? []
  const turnIndex = turns.findIndex((turn) => turn.id === turnId)
  if (turnIndex === -1) return thread
  const turn = turns[turnIndex]
  if (codexActivityTurnDiff(turn) === diff) return thread

  const nextTurns = [...turns]
  nextTurns[turnIndex] = { ...turn, liveDiff: diff } as CodexActivityTurnWithLiveDiff
  return { ...thread, activityTurns: nextTurns }
}

export function flushCodexRichActivityEvents(
  threads: CodexThread[],
  buffer: readonly CodexRichActivityEvent[],
): { threads: CodexThread[]; pending: CodexRichActivityBuffer } {
  let nextThreads = threads
  const pending: CodexRichActivityEvent[] = []

  for (const event of buffer) {
    const threadIndex = nextThreads.findIndex((thread) => thread.id === event.threadId)
    if (threadIndex === -1) {
      pending.push(event)
      continue
    }

    const thread = nextThreads[threadIndex]
    if (event.type === 'item_progress') {
      const turns = thread.activityTurns ?? []
      const ownsItem = turns.some((turn) => turn.id === event.turnId
        && turn.items.some((item) => item.id === event.itemId))
      if (!ownsItem) {
        pending.push(event)
        continue
      }

      const activityTurns = mergeCodexActivityProgress(
        turns,
        event.turnId,
        event.itemId,
        event.progress,
      )
      if (activityTurns === turns) continue
      if (nextThreads === threads) nextThreads = [...threads]
      nextThreads[threadIndex] = { ...thread, activityTurns }
      continue
    }

    const ownsTurn = (thread.activityTurns ?? []).some((turn) => turn.id === event.turnId)
    if (!ownsTurn) {
      pending.push(event)
      continue
    }
    const updated = applyTurnDiff(thread, event.turnId, event.diff)
    if (updated === thread) continue
    if (nextThreads === threads) nextThreads = [...threads]
    nextThreads[threadIndex] = updated
  }

  return { threads: nextThreads, pending }
}

export function discardCodexRichActivityEvents(
  buffer: readonly CodexRichActivityEvent[],
  target: { threadId: string; turnId?: string; itemId?: string },
): CodexRichActivityBuffer {
  const next = buffer.filter((event) => {
    if (event.threadId !== target.threadId) return true
    if (target.turnId === undefined) return false
    if (event.turnId !== target.turnId) return true
    if (target.itemId === undefined) return false
    return event.type !== 'item_progress' || event.itemId !== target.itemId
  })
  return next.length === buffer.length ? buffer : next
}
