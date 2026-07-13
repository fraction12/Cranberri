import { describe, expect, it } from 'vitest'
import type { CodexSdkThreadItem } from './codex'
import { normalizeCodexActivityItem } from './codex-turn-activity'

describe('normalizeCodexActivityItem', () => {
  it('keeps parsed command intent and lifecycle timing', () => {
    const started = normalizeCodexActivityItem({
      id: 'command-1',
      type: 'commandExecution',
      command: 'rg "turn/steer" src',
      cwd: '/repo',
      processId: 'pty-1',
      source: 'agent',
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
      activityDetail: {
        type: 'commandExecution',
        command: 'rg "turn/steer" src',
        cwd: '/repo',
        processId: 'pty-1',
        source: 'agent',
        commandActions: [{ type: 'search', command: 'rg', query: 'turn/steer', path: 'src' }],
      },
      startedAt: 1_000,
    })
    expect(completed).toMatchObject({
      id: 'command-1',
      kind: 'command',
      status: 'completed',
      title: 'Searched for turn/steer',
      completedAt: 1_042,
      durationMs: 42,
      activityDetail: {
        type: 'commandExecution',
        command: 'rg "turn/steer" src',
        commandActions: [{ type: 'search', command: 'rg', query: 'turn/steer', path: 'src' }],
        aggregatedOutput: 'src/main/codex/client.ts',
        exitCode: 0,
        durationMs: 42,
      },
    })
  })

  it('preserves command cwd and failed execution detail without changing legacy fields', () => {
    const item = normalizeCodexActivityItem({
      id: 'command-failed',
      type: 'commandExecution',
      command: 'npm test',
      cwd: { path: '/repo', source: 'turn' },
      commandActions: [{ type: 'unknown', command: 'npm test', path: { path: 'package.json' } }],
      aggregatedOutput: { stdout: '', stderr: 'failed' },
      exitCode: 1,
      durationMs: 250,
      status: 'failed',
    } as CodexSdkThreadItem, 'completed', 1_250)

    expect(item).toMatchObject({
      kind: 'command',
      status: 'failed',
      title: 'Ran a command',
      detail: 'npm test',
      activityDetail: {
        type: 'commandExecution',
        command: 'npm test',
        cwd: { path: '/repo', source: 'turn' },
        commandActions: [{ type: 'unknown', command: 'npm test', path: { path: 'package.json' } }],
        aggregatedOutput: { stdout: '', stderr: 'failed' },
        exitCode: 1,
        durationMs: 250,
      },
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
      activityDetail: {
        type: 'fileChange',
        changes: [
          { path: 'src/a.ts', kind: { type: 'update' }, diff: '+a' },
          { path: 'src/b.ts', kind: { type: 'add' }, diff: '+b' },
        ],
        applyStatus: 'completed',
      },
    })
  })

  it('preserves failed file-change apply detail and structured errors', () => {
    const item = normalizeCodexActivityItem({
      id: 'patch-failed',
      type: 'fileChange',
      changes: [{ path: 'src/a.ts', kind: { type: 'update' }, diff: '@@ -1 +1 @@' }],
      status: { type: 'failed', stage: 'apply' },
      error: { code: 'context_mismatch', retryable: true },
    }, 'completed', 2_500)

    expect(item).toMatchObject({
      kind: 'file_change',
      status: 'failed',
      title: 'Edited src/a.ts',
      activityDetail: {
        type: 'fileChange',
        changes: [{ path: 'src/a.ts', kind: { type: 'update' }, diff: '@@ -1 +1 @@' }],
        applyStatus: { type: 'failed', stage: 'apply' },
        error: { code: 'context_mismatch', retryable: true },
      },
    })
  })

  it('preserves MCP identity, app context, arguments, results, and errors as structured values', () => {
    const completed = normalizeCodexActivityItem({
      id: 'mcp-1',
      type: 'mcpToolCall',
      server: 'github',
      tool: 'search_issues',
      appContext: {
        connectorId: 'github',
        linkId: 'fraction12',
        resourceUri: 'github://fraction12/Cranberri',
        appName: 'GitHub',
        templateId: null,
        actionName: 'search_issues',
      },
      mcpAppResourceUri: 'github://legacy/fraction12/Cranberri',
      pluginId: 'github-plugin',
      arguments: { query: { labels: ['bug', 'chat'] } },
      result: { content: [{ type: 'text', text: 'Issue 42' }], meta: { count: 1 } },
      durationMs: 80,
      status: 'completed',
    }, 'completed', 3_000)
    const failed = normalizeCodexActivityItem({
      id: 'mcp-2',
      type: 'mcpToolCall',
      server: 'github',
      tool: 'search_issues',
      arguments: { query: 'broken' },
      error: { code: -32_603, data: { reason: 'upstream unavailable' } },
      status: 'failed',
    }, 'completed', 3_100)

    expect(completed).toMatchObject({
      kind: 'mcp_tool',
      title: 'Called github.search_issues',
      detail: '{"query":{"labels":["bug","chat"]}}',
      activityDetail: {
        type: 'mcpToolCall',
        server: 'github',
        tool: 'search_issues',
        appContext: {
          connectorId: 'github',
          linkId: 'fraction12',
          resourceUri: 'github://fraction12/Cranberri',
          appName: 'GitHub',
          templateId: null,
          actionName: 'search_issues',
        },
        mcpAppResourceUri: 'github://legacy/fraction12/Cranberri',
        pluginId: 'github-plugin',
        arguments: { query: { labels: ['bug', 'chat'] } },
        result: { content: [{ type: 'text', text: 'Issue 42' }], meta: { count: 1 } },
        durationMs: 80,
      },
    })
    expect(failed).toMatchObject({
      status: 'failed',
      activityDetail: {
        type: 'mcpToolCall',
        server: 'github',
        tool: 'search_issues',
        arguments: { query: 'broken' },
        error: { code: -32_603, data: { reason: 'upstream unavailable' } },
      },
    })
  })

  it('preserves dynamic-tool namespace, arguments, results, and errors as structured values', () => {
    const item = normalizeCodexActivityItem({
      id: 'dynamic-1',
      type: 'dynamicToolCall',
      namespace: 'workspace',
      tool: 'inspect',
      arguments: { paths: ['src/a.ts'], options: { symbols: true } },
      contentItems: [
        { type: 'inputText', text: 'Found run' },
        { type: 'inputImage', imageUrl: 'data:image/png;base64,abc' },
      ],
      success: true,
      result: { files: [{ path: 'src/a.ts', symbols: ['run'] }] },
      error: null,
      durationMs: 18,
      status: 'completed',
    }, 'completed', 3_200)

    expect(item).toMatchObject({
      kind: 'dynamic_tool',
      title: 'Called workspace.inspect',
      detail: '{"paths":["src/a.ts"],"options":{"symbols":true}}',
      activityDetail: {
        type: 'dynamicToolCall',
        namespace: 'workspace',
        tool: 'inspect',
        arguments: { paths: ['src/a.ts'], options: { symbols: true } },
        contentItems: [
          { type: 'inputText', text: 'Found run' },
          { type: 'inputImage', imageUrl: 'data:image/png;base64,abc' },
        ],
        success: true,
        result: { files: [{ path: 'src/a.ts', symbols: ['run'] }] },
        error: null,
        durationMs: 18,
      },
    })
  })

  it('keeps partial legacy items and malformed structured collections quiet', () => {
    const legacy = normalizeCodexActivityItem({
      id: 'legacy-command',
      type: 'commandExecution',
      command: 'pwd',
    }, 'completed', 3_300)
    const malformedCommand = normalizeCodexActivityItem({
      id: 'malformed-command',
      type: 'commandExecution',
      commandActions: { type: 'search', query: 'not-an-array' },
    } as unknown as CodexSdkThreadItem, 'completed', 3_400)
    const malformedFileChange = normalizeCodexActivityItem({
      id: 'malformed-change',
      type: 'fileChange',
      changes: [{ path: 12 }, null, 'bad-change'],
    } as unknown as CodexSdkThreadItem, 'completed', 3_500)

    expect(legacy).toMatchObject({
      title: 'Ran a command',
      detail: 'pwd',
      activityDetail: { type: 'commandExecution', command: 'pwd' },
    })
    expect(malformedCommand).toMatchObject({
      title: 'Ran a command',
      activityDetail: { type: 'commandExecution' },
    })
    expect(malformedFileChange).toMatchObject({
      title: 'Edited multiple files',
      activityDetail: { type: 'fileChange' },
    })
  })

  it('keeps unknown future items visible through the quiet legacy fallback', () => {
    expect(normalizeCodexActivityItem({
      id: 'future-1',
      type: 'futureProtocolItem',
      content: [{ type: 'text', text: 'opaque' }],
    }, 'completed', 3_600)).toEqual({
      id: 'future-1',
      kind: 'other',
      status: 'completed',
      title: 'Completed future protocol item',
      completedAt: 3_600,
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
      action: { type: 'search', query: 'Codex app turn trail', queries: ['Codex app', 'turn trail'] },
    }, 'completed', 3_000)).toMatchObject({
      kind: 'web_search',
      title: 'Searched the web',
      detail: 'Codex app turn trail',
      activityDetail: {
        type: 'webSearch',
        query: 'Codex app turn trail',
        action: { type: 'search', query: 'Codex app turn trail', queries: ['Codex app', 'turn trail'] },
      },
    })

    expect(normalizeCodexActivityItem({
      id: 'agent-1',
      type: 'collabAgentToolCall',
      tool: 'spawnAgent',
      status: 'completed',
      senderThreadId: 'parent-1',
      receiverThreadIds: ['worker-1'],
      prompt: 'Inspect the state reducer',
      model: 'gpt-5.6-sol',
      reasoningEffort: 'high',
      agentsStates: { 'worker-1': { status: 'completed', message: 'Done' } },
    }, 'completed', 3_000)).toMatchObject({
      kind: 'collaboration',
      title: 'Started an agent',
      detail: 'Inspect the state reducer',
      activityDetail: {
        type: 'collabAgentToolCall',
        tool: 'spawnAgent',
        senderThreadId: 'parent-1',
        receiverThreadIds: ['worker-1'],
        prompt: 'Inspect the state reducer',
        model: 'gpt-5.6-sol',
        reasoningEffort: 'high',
        agentsStates: { 'worker-1': { status: 'completed', message: 'Done' } },
      },
    })
  })

  it('only treats commentary agent messages as activity', () => {
    expect(normalizeCodexActivityItem({
      id: 'commentary-1',
      type: 'agentMessage',
      phase: 'commentary',
      text: 'I am checking the protocol.',
      memoryCitation: {
        entries: [{ path: 'MEMORY.md', lineStart: 10, lineEnd: 12, note: 'Prior parity work' }],
        threadIds: ['thread-previous'],
      },
    }, 'completed', 4_000)).toMatchObject({
      kind: 'commentary',
      content: 'I am checking the protocol.',
      activityDetail: {
        type: 'agentMessage',
        phase: 'commentary',
        memoryCitation: {
          entries: [{ path: 'MEMORY.md', lineStart: 10, lineEnd: 12, note: 'Prior parity work' }],
          threadIds: ['thread-previous'],
        },
      },
    })
    expect(normalizeCodexActivityItem({
      id: 'answer-1',
      type: 'agentMessage',
      phase: 'final_answer',
      text: 'Done.',
    }, 'completed', 4_000)).toBeNull()
    const userMessage = {
      id: 'user-1',
      type: 'userMessage',
      clientId: 'composer-send-1',
      content: [{ type: 'text', text: 'Please inspect this.' }],
    } satisfies CodexSdkThreadItem
    expect(normalizeCodexActivityItem(userMessage, 'completed', 4_000)).toBeNull()
  })

  it('preserves hook fragments and all remaining pinned activity families', () => {
    expect(normalizeCodexActivityItem({
      id: 'hook-1',
      type: 'hookPrompt',
      fragments: [
        { text: 'Repository rules', hookRunId: 'hook-run-1' },
        { text: 'Task context', hookRunId: 'hook-run-2' },
      ],
    }, 'completed', 5_000)).toMatchObject({
      kind: 'other',
      content: 'Repository rules\nTask context',
      activityDetail: {
        type: 'hookPrompt',
        fragments: [
          { text: 'Repository rules', hookRunId: 'hook-run-1' },
          { text: 'Task context', hookRunId: 'hook-run-2' },
        ],
      },
    })

    expect(normalizeCodexActivityItem({
      id: 'plan-1',
      type: 'plan',
      text: '1. Inspect\n2. Fix',
    }, 'completed', 5_010)).toMatchObject({
      kind: 'plan',
      content: '1. Inspect\n2. Fix',
    })

    expect(normalizeCodexActivityItem({
      id: 'subagent-1',
      type: 'subAgentActivity',
      kind: 'interacted',
      agentThreadId: 'worker-1',
      agentPath: 'Curie',
    }, 'completed', 5_020)).toMatchObject({
      kind: 'subagent',
      activityDetail: {
        type: 'subAgentActivity',
        kind: 'interacted',
        agentThreadId: 'worker-1',
        agentPath: 'Curie',
      },
    })

    expect(normalizeCodexActivityItem({
      id: 'image-view-1',
      type: 'imageView',
      path: '/tmp/reference.png',
    }, 'completed', 5_030)).toMatchObject({
      kind: 'image',
      detail: '/tmp/reference.png',
      activityDetail: { type: 'imageView', path: '/tmp/reference.png' },
    })

    expect(normalizeCodexActivityItem({
      id: 'sleep-1',
      type: 'sleep',
      durationMs: 2_500,
    }, 'completed', 5_040)).toMatchObject({
      kind: 'sleep',
      detail: '3s',
      activityDetail: { type: 'sleep', durationMs: 2_500 },
    })

    expect(normalizeCodexActivityItem({
      id: 'image-generation-1',
      type: 'imageGeneration',
      status: 'completed',
      revisedPrompt: 'A sharper product screenshot',
      result: 'data:image/png;base64,abc',
      savedPath: '/tmp/generated.png',
    }, 'completed', 5_050)).toMatchObject({
      kind: 'image',
      activityDetail: {
        type: 'imageGeneration',
        generationStatus: 'completed',
        revisedPrompt: 'A sharper product screenshot',
        result: 'data:image/png;base64,abc',
        savedPath: '/tmp/generated.png',
      },
    })

    expect(normalizeCodexActivityItem({
      id: 'review-entered-1',
      type: 'enteredReviewMode',
      review: 'Review the current diff',
    }, 'completed', 5_060)).toMatchObject({
      kind: 'review',
      activityDetail: { type: 'enteredReviewMode', review: 'Review the current diff' },
    })
    expect(normalizeCodexActivityItem({
      id: 'review-exited-1',
      type: 'exitedReviewMode',
      review: 'Review complete',
    }, 'completed', 5_070)).toMatchObject({
      kind: 'review',
      activityDetail: { type: 'exitedReviewMode', review: 'Review complete' },
    })
    expect(normalizeCodexActivityItem({
      id: 'compaction-1',
      type: 'contextCompaction',
    }, 'completed', 5_080)).toMatchObject({
      kind: 'compaction',
      activityDetail: { type: 'contextCompaction' },
    })
  })

  it('keeps legacy aliases while dropping malformed pinned detail fields', () => {
    expect(normalizeCodexActivityItem({
      id: 'legacy-agent-1',
      type: 'collabAgentToolCall',
      tool: 'spawn_agent',
      newThreadId: 'worker-legacy',
      agentStatus: { status: 'completed', message: 'Legacy done' },
      prompt: 'Legacy request',
    }, 'completed', 6_000)).toMatchObject({
      title: 'Started an agent',
      activityDetail: {
        type: 'collabAgentToolCall',
        tool: 'spawn_agent',
        receiverThreadIds: ['worker-legacy'],
        agentsStates: { 'worker-legacy': { status: 'completed', message: 'Legacy done' } },
      },
    })
    expect(normalizeCodexActivityItem({
      id: 'legacy-compaction-1',
      type: 'compaction',
    }, 'completed', 6_010)).toMatchObject({
      kind: 'compaction',
      activityDetail: { type: 'contextCompaction' },
    })

    expect(normalizeCodexActivityItem({
      id: 'malformed-rich-1',
      type: 'dynamicToolCall',
      contentItems: [{ type: 'inputText', text: 42 }],
    } as unknown as CodexSdkThreadItem, 'completed', 6_020)).toMatchObject({
      activityDetail: { type: 'dynamicToolCall' },
    })
    expect(normalizeCodexActivityItem({
      id: 'malformed-hook-1',
      type: 'hookPrompt',
      fragments: [{ text: 'missing run id' }],
    } as unknown as CodexSdkThreadItem, 'completed', 6_030)).toMatchObject({
      activityDetail: { type: 'hookPrompt' },
    })
  })
})
