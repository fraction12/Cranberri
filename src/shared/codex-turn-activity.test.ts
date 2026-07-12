import { describe, expect, it } from 'vitest'
import { normalizeCodexActivityItem } from './codex-turn-activity'

describe('normalizeCodexActivityItem', () => {
  it('keeps parsed command intent and lifecycle timing', () => {
    const started = normalizeCodexActivityItem({
      id: 'command-1',
      type: 'commandExecution',
      command: 'rg "turn/steer" src',
      commandActions: [{ type: 'search', command: 'rg', query: 'turn/steer', path: 'src' }],
      status: 'inProgress',
    }, 'started', 1_000)
    const completed = normalizeCodexActivityItem({
      id: 'command-1',
      type: 'commandExecution',
      command: 'rg "turn/steer" src',
      commandActions: [{ type: 'search', command: 'rg', query: 'turn/steer', path: 'src' }],
      aggregatedOutput: 'src/main/codex/client.ts',
      exitCode: 0,
      durationMs: 42,
      status: 'completed',
    }, 'completed', 1_042)

    expect(started).toMatchObject({
      id: 'command-1',
      kind: 'command',
      status: 'running',
      title: 'Searching for turn/steer',
      detail: 'rg "turn/steer" src',
      startedAt: 1_000,
    })
    expect(completed).toMatchObject({
      id: 'command-1',
      kind: 'command',
      status: 'completed',
      title: 'Searched for turn/steer',
      completedAt: 1_042,
      durationMs: 42,
    })
  })

  it('summarizes patches without discarding their paths and diffs', () => {
    const item = normalizeCodexActivityItem({
      id: 'patch-1',
      type: 'fileChange',
      status: 'completed',
      changes: [
        { path: 'src/a.ts', kind: { type: 'update' }, diff: '+a' },
        { path: 'src/b.ts', kind: { type: 'add' }, diff: '+b' },
      ],
    }, 'completed', 2_000)

    expect(item).toMatchObject({
      kind: 'file_change',
      status: 'completed',
      title: 'Edited 2 files',
      detail: 'src/a.ts\nsrc/b.ts',
    })
  })

  it('normalizes reasoning, web search, and collaboration as first-class activity', () => {
    expect(normalizeCodexActivityItem({
      id: 'reasoning-1',
      type: 'reasoning',
      summary: ['Inspecting the renderer'],
      content: ['Checking turn state'],
    }, 'completed', 3_000)).toMatchObject({
      kind: 'reasoning',
      title: 'Thought',
      content: 'Inspecting the renderer\nChecking turn state',
    })

    expect(normalizeCodexActivityItem({
      id: 'search-1',
      type: 'webSearch',
      query: 'Codex app turn trail',
    }, 'completed', 3_000)).toMatchObject({
      kind: 'web_search',
      title: 'Searched the web',
      detail: 'Codex app turn trail',
    })

    expect(normalizeCodexActivityItem({
      id: 'agent-1',
      type: 'collabAgentToolCall',
      tool: 'spawnAgent',
      status: 'completed',
      receiverThreadIds: ['worker-1'],
      prompt: 'Inspect the state reducer',
    }, 'completed', 3_000)).toMatchObject({
      kind: 'collaboration',
      title: 'Started an agent',
      detail: 'Inspect the state reducer',
    })
  })

  it('only treats commentary agent messages as activity', () => {
    expect(normalizeCodexActivityItem({
      id: 'commentary-1',
      type: 'agentMessage',
      phase: 'commentary',
      text: 'I am checking the protocol.',
    }, 'completed', 4_000)).toMatchObject({
      kind: 'commentary',
      content: 'I am checking the protocol.',
    })
    expect(normalizeCodexActivityItem({
      id: 'answer-1',
      type: 'agentMessage',
      phase: 'final_answer',
      text: 'Done.',
    }, 'completed', 4_000)).toBeNull()
    expect(normalizeCodexActivityItem({
      id: 'user-1',
      type: 'userMessage',
      content: [{ type: 'text', text: 'Please inspect this.' }],
    }, 'completed', 4_000)).toBeNull()
  })
})
