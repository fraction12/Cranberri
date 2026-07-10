import { describe, expect, it } from 'vitest'
import {
  createApprovalCompletedEvent,
  createToolEventFromApproval,
  createToolEventFromItem,
  normalizeToolRegistrySnapshot,
} from './tools'

describe('tool event normalization', () => {
  it('normalizes MCP item lifecycle records', () => {
    const started = createToolEventFromItem('thread-1', {
      type: 'mcpToolCall',
      id: 'item-1',
      server: 'github',
      tool: 'list_pull_requests',
      status: 'inProgress',
      arguments: { owner: 'fraction12', repo: 'Cranberri' },
      appContext: { connectorId: 'github' },
    }, 'started')

    expect(started).toMatchObject({
      threadId: 'thread-1',
      toolCallId: 'item-1',
      catalogId: 'mcp:github:list_pull_requests',
      name: 'list_pull_requests',
      kind: 'mcp',
      status: 'running',
      connectorId: 'github',
    })
    expect(started).not.toHaveProperty('argumentsPreview')
  })

  it('marks failed command executions from non-zero exit codes', () => {
    const event = createToolEventFromItem('thread-1', {
      type: 'commandExecution',
      id: 'cmd-1',
      command: 'npm test',
      status: 'completed',
      exitCode: 1,
      durationMs: 1400,
    }, 'completed')

    expect(event).toMatchObject({
      catalogId: 'codex:exec_command',
      name: 'exec_command',
      kind: 'command',
      status: 'failed',
      durationMs: 1400,
    })
    expect(JSON.stringify(event)).not.toContain('npm test')
  })

  it('normalizes tool approval request and completion records', () => {
    const approval = createToolEventFromApproval('thread-1', {
      id: 'approval-1',
      reviewId: 'review-1',
      description: 'Tool call: search',
      targetItemId: 'item-1',
      review: {},
      action: {
        type: 'mcpToolCall',
        server: 'google-drive',
        toolName: 'search',
        connectorId: 'drive',
        connectorName: 'Google Drive',
        toolTitle: 'Search files',
      },
    })
    const completed = createApprovalCompletedEvent('thread-1', 'review-1', 'approved')

    expect(approval).toMatchObject({
      catalogId: 'mcp:google-drive:search',
      name: 'search',
      title: 'Search files',
      kind: 'mcp',
      status: 'approval_requested',
      connectorName: 'Google Drive',
    })
    expect(approval).not.toHaveProperty('argumentsPreview')
    expect(completed).toMatchObject({
      name: 'Approval approved',
      kind: 'approval',
      status: 'approved',
      reviewId: 'review-1',
    })
  })

  it('normalizes app and MCP registry snapshots', () => {
    const snapshot = normalizeToolRegistrySnapshot({
      appListAvailable: true,
      mcpServerStatusAvailable: true,
      appsResult: {
        data: [{
          id: 'github',
          name: 'GitHub',
          description: 'Repositories and pull requests',
          logoUrlDark: 'https://example.com/github-dark.png',
          isEnabled: true,
          isAccessible: true,
          distributionChannel: 'marketplace',
          pluginDisplayNames: ['GitHub'],
        }],
      },
      mcpResult: {
        data: [{
          name: 'github',
          authStatus: 'oAuth',
          tools: {
            search_issues: { name: 'search_issues', title: 'Search issues', description: 'Search issues' },
          },
          resources: [{ uri: 'repo://one' }],
          resourceTemplates: [],
        }],
      },
    })

    expect(snapshot.apps).toEqual([
      expect.objectContaining({
        id: 'github',
        name: 'GitHub',
        enabled: true,
        accessible: true,
      }),
    ])
    expect(snapshot.mcpServers).toEqual([
      expect.objectContaining({
        name: 'github',
        authStatus: 'oAuth',
        toolCount: 1,
        resourceCount: 1,
        tools: [expect.objectContaining({ name: 'search_issues', title: 'Search issues' })],
      }),
    ])
  })

  it('normalizes fake Codex registry payloads used by packaged smoke', () => {
    const snapshot = normalizeToolRegistrySnapshot({
      appListAvailable: true,
      mcpServerStatusAvailable: true,
      appsResult: {
        data: [{
          id: 'fake-smoke-app',
          name: 'Fake Smoke App',
          description: 'Deterministic app registry entry for packaged smoke coverage',
          isEnabled: true,
          isAccessible: true,
          distributionChannel: 'fake',
          pluginDisplayNames: ['Fake Smoke Plugin'],
        }],
      },
      mcpResult: {
        data: [{
          name: 'fake-smoke-mcp',
          authStatus: 'available',
          tools: {
            inspect_fixture: {
              name: 'inspect_fixture',
              title: 'Inspect fake smoke fixture',
              description: 'Reads deterministic smoke fixture metadata',
            },
          },
          resources: [],
          resourceTemplates: [],
        }],
      },
    })

    expect(snapshot.apps[0]).toMatchObject({
      id: 'fake-smoke-app',
      name: 'Fake Smoke App',
      pluginDisplayNames: ['Fake Smoke Plugin'],
    })
    expect(snapshot.mcpServers[0]?.tools[0]).toMatchObject({
      name: 'inspect_fixture',
      title: 'Inspect fake smoke fixture',
    })
  })
})
