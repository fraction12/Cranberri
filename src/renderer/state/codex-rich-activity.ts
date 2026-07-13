import type {
  CodexActivityItem,
  CodexActivityTurn,
  CodexCommandActivityDetail,
  CodexFileChangeActivityDetail,
  CodexItemProgress,
  CodexSdkFileChange,
} from '../../shared/codex'

function appendOutputChunk(current: unknown, delta: string): string | undefined {
  const output = typeof current === 'string' ? current : ''
  if (!delta) return undefined
  return output + delta
}

function sameFileChanges(
  current: CodexSdkFileChange[] | undefined,
  incoming: CodexSdkFileChange[],
): boolean {
  return current?.length === incoming.length && current.every((change, index) => {
    const next = incoming[index]
    return change.path === next.path
      && change.diff === next.diff
      && Object.is(change.kind, next.kind)
  })
}

function mergeCommandOutput(
  item: CodexActivityItem,
  delta: string,
): CodexActivityItem {
  if (item.kind !== 'command') return item
  if (item.activityDetail && item.activityDetail.type !== 'commandExecution') return item

  const current: CodexCommandActivityDetail = item.activityDetail ?? { type: 'commandExecution' }
  const aggregatedOutput = appendOutputChunk(current.aggregatedOutput, delta)
  if (aggregatedOutput === undefined) return item

  return {
    ...item,
    activityDetail: { ...current, aggregatedOutput },
  }
}

function mergeLegacyFileOutput(
  item: CodexActivityItem,
  delta: string,
): CodexActivityItem {
  if (item.kind !== 'file_change') return item
  const content = appendOutputChunk(item.content, delta)
  return content === undefined ? item : { ...item, content }
}

function mergeFilePatch(
  item: CodexActivityItem,
  changes: CodexSdkFileChange[],
): CodexActivityItem {
  if (item.kind !== 'file_change') return item
  if (item.activityDetail && item.activityDetail.type !== 'fileChange') return item

  const current: CodexFileChangeActivityDetail = item.activityDetail ?? { type: 'fileChange' }
  if (sameFileChanges(current.changes, changes)) return item

  return {
    ...item,
    activityDetail: { ...current, changes },
  }
}

function mergeMcpProgress(
  item: CodexActivityItem,
  message: string,
): CodexActivityItem {
  if (item.kind !== 'mcp_tool' || item.content === message) return item
  return { ...item, content: message }
}

export function mergeCodexActivityItemProgress(
  item: CodexActivityItem,
  progress: CodexItemProgress,
): CodexActivityItem {
  if (item.status !== 'running') return item

  switch (progress.type) {
    case 'command_output':
      return mergeCommandOutput(item, progress.delta)
    case 'file_output':
      return mergeLegacyFileOutput(item, progress.delta)
    case 'file_patch':
      return mergeFilePatch(item, progress.changes)
    case 'mcp_progress':
      return mergeMcpProgress(item, progress.message)
  }
}

export function mergeCodexActivityProgress(
  turns: CodexActivityTurn[],
  turnId: string,
  itemId: string,
  progress: CodexItemProgress,
): CodexActivityTurn[] {
  const turnIndex = turns.findIndex((turn) => turn.id === turnId)
  if (turnIndex === -1) return turns

  const turn = turns[turnIndex]
  const itemIndex = turn.items.findIndex((item) => item.id === itemId)
  if (itemIndex === -1) return turns

  const item = mergeCodexActivityItemProgress(turn.items[itemIndex], progress)
  if (item === turn.items[itemIndex]) return turns

  const items = [...turn.items]
  items[itemIndex] = item
  const next = [...turns]
  next[turnIndex] = { ...turn, items }
  return next
}

export function mergeCodexTurnDiff(
  state: ReadonlyMap<string, string>,
  turnId: string,
  diff: string,
): ReadonlyMap<string, string> {
  if (state.get(turnId) === diff && state.has(turnId)) return state
  const next = new Map(state)
  next.set(turnId, diff)
  return next
}
