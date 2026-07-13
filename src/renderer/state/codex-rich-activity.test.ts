import { describe, expect, it } from 'vitest'
import type { CodexActivityItem, CodexActivityTurn, CodexItemProgress } from '../../shared/codex'
import {
  mergeCodexActivityItemProgress,
  mergeCodexActivityProgress,
  mergeCodexTurnDiff,
} from './codex-rich-activity'

function runningItem(overrides: Partial<CodexActivityItem> = {}): CodexActivityItem {
  return {
    id: 'item-1',
    kind: 'command',
    status: 'running',
    title: 'Running command',
    activityDetail: { type: 'commandExecution', command: 'npm test' },
    ...overrides,
  }
}

function turn(id: string, items: CodexActivityItem[]): CodexActivityTurn {
  return { id, status: 'running', startedAt: 1_000, items }
}

describe('mergeCodexActivityItemProgress', () => {
  it('aggregates command output in order without dropping identical chunks', () => {
    const original = runningItem()
    const first = mergeCodexActivityItemProgress(original, { type: 'command_output', delta: 'one\n' })
    const second = mergeCodexActivityItemProgress(first, { type: 'command_output', delta: 'two\n' })
    const repeated = mergeCodexActivityItemProgress(second, { type: 'command_output', delta: 'two\n' })

    expect(first.activityDetail).toMatchObject({ aggregatedOutput: 'one\n' })
    expect(second.activityDetail).toMatchObject({ aggregatedOutput: 'one\ntwo\n' })
    expect(repeated.activityDetail).toMatchObject({ aggregatedOutput: 'one\ntwo\ntwo\n' })
    expect(original.activityDetail).toEqual({ type: 'commandExecution', command: 'npm test' })
  })

  it('retains complete large command output at the state layer', () => {
    const firstChunk = 'a'.repeat(150_000)
    const secondChunk = 'b'.repeat(150_000)
    const first = mergeCodexActivityItemProgress(runningItem(), { type: 'command_output', delta: firstChunk })
    const second = mergeCodexActivityItemProgress(first, { type: 'command_output', delta: secondChunk })

    expect(second.activityDetail).toMatchObject({ aggregatedOutput: firstChunk + secondChunk })
  })

  it('aggregates legacy file output without replacing structured file detail', () => {
    const original = runningItem({
      kind: 'file_change',
      title: 'Editing file.ts',
      activityDetail: {
        type: 'fileChange',
        changes: [{ path: 'file.ts', kind: 'update', diff: 'old patch' }],
      },
    })
    const first = mergeCodexActivityItemProgress(original, { type: 'file_output', delta: 'legacy ' })
    const second = mergeCodexActivityItemProgress(first, { type: 'file_output', delta: 'output' })
    const repeated = mergeCodexActivityItemProgress(second, { type: 'file_output', delta: 'output' })

    expect(second.content).toBe('legacy output')
    expect(second.activityDetail).toBe(original.activityDetail)
    expect(repeated.content).toBe('legacy outputoutput')
    expect(original.content).toBeUndefined()
  })

  it('replaces live file patches authoritatively and idempotently', () => {
    const original = runningItem({
      kind: 'file_change',
      title: 'Editing file.ts',
      activityDetail: {
        type: 'fileChange',
        changes: [{ path: 'file.ts', kind: 'update', diff: 'old patch' }],
      },
    })
    const progress: CodexItemProgress = {
      type: 'file_patch',
      changes: [
        { path: 'file.ts', kind: 'update', diff: 'new patch' },
        { path: 'new.ts', kind: 'create', diff: 'created patch' },
      ],
    }
    const replaced = mergeCodexActivityItemProgress(original, progress)
    const duplicate = mergeCodexActivityItemProgress(replaced, progress)

    expect(replaced.activityDetail).toEqual({ type: 'fileChange', changes: progress.changes })
    expect(replaced.activityDetail).not.toBe(original.activityDetail)
    expect(duplicate).toBe(replaced)
    expect(original.activityDetail).toEqual({
      type: 'fileChange',
      changes: [{ path: 'file.ts', kind: 'update', diff: 'old patch' }],
    })
  })

  it('keeps only the latest MCP progress message', () => {
    const original = runningItem({
      kind: 'mcp_tool',
      title: 'Calling records.read',
      detail: '{"limit":10}',
      activityDetail: {
        type: 'mcpToolCall',
        server: 'records',
        tool: 'read',
        arguments: { limit: 10 },
      },
    })
    const reading = mergeCodexActivityItemProgress(original, { type: 'mcp_progress', message: 'Reading' })
    const parsed = mergeCodexActivityItemProgress(reading, { type: 'mcp_progress', message: 'Parsing' })

    expect(parsed.content).toBe('Parsing')
    expect(parsed.detail).toBe('{"limit":10}')
    expect(parsed.activityDetail).toBe(original.activityDetail)
    expect(mergeCodexActivityItemProgress(parsed, { type: 'mcp_progress', message: 'Parsing' })).toBe(parsed)
  })

  it.each(['completed', 'failed', 'declined'] as const)(
    'keeps %s detail and lifecycle authoritative when progress arrives late',
    (status) => {
      const completed = runningItem({
        status,
        completedAt: 2_000,
        activityDetail: {
          type: 'commandExecution',
          command: 'npm test',
          aggregatedOutput: 'authoritative output',
          exitCode: status === 'completed' ? 0 : 1,
        },
      })

      expect(mergeCodexActivityItemProgress(completed, {
        type: 'command_output',
        delta: 'late output',
      })).toBe(completed)
      expect(completed.status).toBe(status)
    },
  )

  it('preserves unknown and mismatched item shapes without throwing', () => {
    const unknown = runningItem({ kind: 'other', activityDetail: undefined })
    const mismatched = runningItem({ kind: 'command', activityDetail: { type: 'fileChange' } })

    expect(mergeCodexActivityItemProgress(unknown, { type: 'command_output', delta: 'ignored' })).toBe(unknown)
    expect(mergeCodexActivityItemProgress(mismatched, { type: 'command_output', delta: 'ignored' })).toBe(mismatched)
  })
})

describe('mergeCodexActivityProgress', () => {
  it('routes progress by turn and item identity while preserving concurrent turns', () => {
    const firstItem = runningItem({ id: 'item-1' })
    const secondItem = runningItem({ id: 'item-2' })
    const firstTurn = turn('turn-1', [firstItem])
    const secondTurn = turn('turn-2', [secondItem])
    const turns = [firstTurn, secondTurn]

    const result = mergeCodexActivityProgress(
      turns,
      'turn-2',
      'item-2',
      { type: 'command_output', delta: 'second turn output' },
    )

    expect(result).not.toBe(turns)
    expect(result[0]).toBe(firstTurn)
    expect(result[1]).not.toBe(secondTurn)
    expect(result[1].items[0].activityDetail).toMatchObject({ aggregatedOutput: 'second turn output' })
    expect(firstItem.activityDetail).not.toHaveProperty('aggregatedOutput')
  })

  it('deliberately no-ops progress before start or for an unknown turn', () => {
    const turns = [turn('turn-1', [])]
    const progress: CodexItemProgress = { type: 'command_output', delta: 'early output' }

    expect(mergeCodexActivityProgress(turns, 'turn-1', 'missing-item', progress)).toBe(turns)
    expect(mergeCodexActivityProgress(turns, 'missing-turn', 'missing-item', progress)).toBe(turns)
  })
})

describe('mergeCodexTurnDiff', () => {
  it('stores independent authoritative diffs for concurrent turns immutably', () => {
    const empty: ReadonlyMap<string, string> = new Map()
    const first = mergeCodexTurnDiff(empty, 'turn-1', 'diff one')
    const second = mergeCodexTurnDiff(first, 'turn-2', 'diff two')
    const replaced = mergeCodexTurnDiff(second, 'turn-1', 'new diff one')

    expect([...empty]).toEqual([])
    expect([...second]).toEqual([['turn-1', 'diff one'], ['turn-2', 'diff two']])
    expect([...replaced]).toEqual([['turn-1', 'new diff one'], ['turn-2', 'diff two']])
    expect(mergeCodexTurnDiff(replaced, 'turn-1', 'new diff one')).toBe(replaced)
  })
})
