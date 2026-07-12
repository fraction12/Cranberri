import { codexItemText, codexStatusName, normalizeCodexActivityItem, type CodexItemLifecycle } from '../../shared/codex-turn-activity'
import { codexWorkerControlDisplayText } from '../../shared/codex-worker-control'
import type {
  CodexActivityItem,
  CodexActivityTurn,
  CodexActivityTurnStatus,
  CodexMessage,
  CodexSessionThread,
  CodexSdkThreadItem,
  CodexThread,
} from '../../shared/codex'

function normalizeTurnStatus(status: unknown): CodexActivityTurnStatus {
  const value = codexStatusName(status)
  if (value === 'failed' || value === 'systemError' || value === 'errored') return 'failed'
  if (value === 'interrupted') return 'interrupted'
  if (value === 'inProgress' || value === 'running' || value === 'active') return 'running'
  return 'completed'
}

function millis(seconds: number | null | undefined, fallback: number): number {
  if (typeof seconds !== 'number') return fallback
  return seconds > 10_000_000_000 ? seconds : seconds * 1000
}

function messageId(item: CodexSdkThreadItem, turnId: string, index: number): string {
  return item.id ?? `${turnId}-item-${index}`
}

function reasoningContent(item: CodexSdkThreadItem): string {
  return [item.summary?.join('\n'), codexItemText(item)].filter(Boolean).join('\n')
}

function compactionMessage(
  item: CodexSdkThreadItem,
  turn: CodexSessionThread['turns'][number],
  thread: CodexSessionThread,
  index: number,
): CodexMessage {
  const completed = normalizeTurnStatus(turn.status) !== 'running'
  return {
    id: messageId(item, turn.id, index),
    role: 'compact',
    content: completed ? 'Context compacted' : 'Compacting context',
    timestamp: millis(completed ? turn.completedAt : turn.startedAt, millis(thread.updatedAt, Date.now())),
    pending: !completed,
    turnId: turn.id,
  }
}

export function hydrateCodexTranscript(thread: CodexSessionThread): {
  messages: CodexMessage[]
  activityTurns: CodexActivityTurn[]
} {
  const messages: CodexMessage[] = []
  const activityTurns: CodexActivityTurn[] = []
  const threadTimestamp = millis(thread.updatedAt, Date.now())

  for (const turn of thread.turns) {
    const startedAt = millis(turn.startedAt, threadTimestamp)
    const completedAt = turn.completedAt == null ? undefined : millis(turn.completedAt, threadTimestamp)
    const status = normalizeTurnStatus(turn.status)
    const items: CodexActivityItem[] = []
    let hasPrimaryUserMessage = false

    for (const [index, item] of (turn.items ?? []).entries()) {
      const id = messageId(item, turn.id, index)
      if (item.type === 'userMessage') {
        const content = codexWorkerControlDisplayText(codexItemText(item))
        if (!content) continue
        if (!hasPrimaryUserMessage) {
          messages.push({ id, role: 'user', content, timestamp: startedAt, turnId: turn.id })
          hasPrimaryUserMessage = true
        } else {
          items.push({
            id,
            kind: 'steering',
            status: 'completed',
            title: 'Direction sent',
            content,
            startedAt,
            completedAt: completedAt ?? startedAt,
          })
        }
        continue
      }

      if (item.type === 'agentMessage' && item.text) {
        const role = item.phase === 'commentary' || item.phase === 'reasoning' ? 'reasoning' : 'assistant'
        messages.push({ id, role, content: item.text, timestamp: completedAt ?? startedAt, turnId: turn.id })
      } else if (item.type === 'reasoning') {
        const content = reasoningContent(item)
        if (content) messages.push({ id, role: 'reasoning', content, timestamp: completedAt ?? startedAt, turnId: turn.id })
      } else if (item.type === 'contextCompaction' || item.type === 'compaction') {
        messages.push(compactionMessage(item, turn, thread, index))
      }

      const activity = normalizeCodexActivityItem(
        { ...item, id },
        status === 'running' && index === (turn.items?.length ?? 0) - 1 ? 'started' : 'completed',
        completedAt ?? startedAt,
      )
      if (activity) {
        items.push({
          ...activity,
          startedAt,
          ...(activity.status === 'running' ? {} : { completedAt: activity.completedAt ?? completedAt ?? startedAt }),
        })
      }
    }

    activityTurns.push({
      id: turn.id,
      status,
      startedAt,
      ...(completedAt === undefined ? {} : { completedAt }),
      ...(typeof turn.durationMs === 'number' ? { durationMs: turn.durationMs } : {}),
      items,
    })
  }

  return { messages, activityTurns }
}

export function createOptimisticCodexTurn(messageId: string, startedAt: number): CodexActivityTurn {
  return {
    id: `local:${messageId}`,
    status: 'running',
    startedAt,
    items: [],
  }
}

function runningTurn(turns: CodexActivityTurn[]): CodexActivityTurn | undefined {
  return [...turns].reverse().find((turn) => turn.status === 'running')
}

export function reconcileCodexTurnStarted(thread: CodexThread, turnId: string, startedAt: number): CodexThread {
  const turns = thread.activityTurns ?? []
  const existing = turns.find((turn) => turn.id === turnId)
  if (existing) {
    return {
      ...thread,
      activityTurns: turns.map((turn) => turn.id === turnId
        ? { ...turn, status: 'running' as const, startedAt: startedAt || turn.startedAt }
        : turn),
    }
  }

  const optimistic = [...turns].reverse().find((turn) => turn.status === 'running' && turn.id.startsWith('local:'))
  if (!optimistic) {
    return {
      ...thread,
      activityTurns: [...turns, { id: turnId, status: 'running', startedAt, items: [] }],
    }
  }

  return {
    ...thread,
    messages: thread.messages.map((message) => message.turnId === optimistic.id ? { ...message, turnId } : message),
    activityTurns: turns.map((turn) => turn.id === optimistic.id
      ? { ...turn, id: turnId, status: 'running', startedAt }
      : turn),
  }
}

export function applyCodexItemLifecycle(
  thread: CodexThread,
  turnId: string,
  sdkItem: CodexSdkThreadItem,
  lifecycle: CodexItemLifecycle,
  at: number,
): CodexThread {
  const normalized = normalizeCodexActivityItem(sdkItem, lifecycle, at)
  if (!normalized) return thread
  let reconciled = reconcileCodexTurnStarted(thread, turnId, thread.runStartedAt ?? at)
  const turns = reconciled.activityTurns ?? []
  reconciled = {
    ...reconciled,
    activityTurns: turns.map((turn) => {
      if (turn.id !== turnId) return turn
      const index = turn.items.findIndex((item) => item.id === normalized.id)
      if (index === -1) return { ...turn, items: [...turn.items, normalized] }
      const current = turn.items[index]
      const items = [...turn.items]
      items[index] = {
        ...current,
        ...normalized,
        startedAt: current.startedAt ?? normalized.startedAt ?? at,
      }
      return { ...turn, items }
    }),
  }
  return reconciled
}

export function completeCodexActivityTurn(
  thread: CodexThread,
  turnId: string | undefined,
  status: CodexActivityTurnStatus,
  completedAt: number,
  durationMs?: number,
): CodexThread {
  const initialTurns = thread.activityTurns ?? []
  const needsReconciliation = Boolean(turnId && !initialTurns.some((turn) => turn.id === turnId))
  const inferredStartedAt = durationMs === undefined
    ? runningTurn(initialTurns)?.startedAt ?? thread.runStartedAt ?? completedAt
    : completedAt - durationMs
  const reconciled = needsReconciliation && turnId
    ? reconcileCodexTurnStarted(thread, turnId, inferredStartedAt)
    : thread
  const turns = reconciled.activityTurns ?? []
  const targetId = turnId ?? runningTurn(turns)?.id
  if (!targetId) return thread
  return {
    ...reconciled,
    activityTurns: turns.map((turn) => turn.id === targetId
      ? {
          ...turn,
          status,
          completedAt,
          durationMs: durationMs ?? Math.max(0, completedAt - turn.startedAt),
        }
      : turn),
  }
}

export function appendCodexSteeringItem(
  thread: CodexThread,
  content: string,
  timestamp: number,
  itemId: string,
): CodexThread {
  const turns = thread.activityTurns ?? []
  const active = runningTurn(turns)
  if (!active) return thread
  const item: CodexActivityItem = {
    id: itemId,
    kind: 'steering',
    status: 'completed',
    title: 'Direction sent',
    content,
    startedAt: timestamp,
    completedAt: timestamp,
  }
  return {
    ...thread,
    activityTurns: turns.map((turn) => turn.id === active.id
      ? { ...turn, items: [...turn.items, item] }
      : turn),
  }
}

export function appendCodexTurnError(
  thread: CodexThread,
  turnId: string | undefined,
  message: string,
  timestamp: number,
): CodexThread {
  const turns = thread.activityTurns ?? []
  const targetId = turnId ?? runningTurn(turns)?.id ?? turns.at(-1)?.id
  if (!targetId) return thread
  const item: CodexActivityItem = {
    id: `turn-error:${targetId}`,
    kind: 'other',
    status: 'failed',
    title: 'Turn failed',
    detail: message,
    completedAt: timestamp,
  }
  return {
    ...thread,
    activityTurns: turns.map((turn) => {
      if (turn.id !== targetId) return turn
      const existing = turn.items.findIndex((candidate) => candidate.id === item.id)
      if (existing === -1) return { ...turn, items: [...turn.items, item] }
      const items = [...turn.items]
      items[existing] = item
      return { ...turn, items }
    }),
  }
}
