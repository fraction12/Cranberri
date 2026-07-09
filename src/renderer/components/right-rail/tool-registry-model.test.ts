import { describe, expect, it } from 'vitest'
import { toolRegistryCapabilityMessages, toolRegistryVisibleErrors } from './tool-registry-model'
import type { ToolRegistrySnapshot } from '@/shared/tools'

function registry(overrides: Partial<ToolRegistrySnapshot> = {}): ToolRegistrySnapshot {
  return {
    generatedAt: '2026-07-08T10:00:00.000Z',
    apps: [],
    mcpServers: [],
    capabilities: {
      appList: true,
      mcpServerStatus: true,
      errors: [],
    },
    ...overrides,
  }
}

describe('tool registry model', () => {
  it('does not show capability messages before registry data loads', () => {
    expect(toolRegistryCapabilityMessages()).toEqual([])
  })

  it('builds clear messages for unavailable registry capabilities', () => {
    const messages = toolRegistryCapabilityMessages(registry({
      capabilities: {
        appList: false,
        mcpServerStatus: false,
        errors: [],
      },
    }))

    expect(messages).toEqual([
      expect.objectContaining({
        id: 'apps-unavailable',
        title: 'Codex app registry unavailable',
      }),
      expect.objectContaining({
        id: 'mcp-unavailable',
        title: 'MCP server status unavailable',
      }),
    ])
  })

  it('stays quiet when all capabilities are available', () => {
    expect(toolRegistryCapabilityMessages(registry())).toEqual([])
  })

  it('hides stale thread lookup errors from the visible registry panel', () => {
    const visibleErrors = toolRegistryVisibleErrors(registry({
      capabilities: {
        appList: false,
        mcpServerStatus: false,
        errors: [
          'thread not found: 019f3f07-43b1-78d0-804e-c59ecf8dfc1e',
          'thread not found: 019f3f07-43b1-78d0-804e-c59ecf8dfc1e',
        ],
      },
    }))

    expect(visibleErrors).toEqual([])
  })

  it('deduplicates non-thread registry errors', () => {
    const visibleErrors = toolRegistryVisibleErrors(registry({
      capabilities: {
        appList: false,
        mcpServerStatus: true,
        errors: ['Registry request failed', 'Registry request failed', '  '],
      },
    }))

    expect(visibleErrors).toEqual(['Registry request failed'])
  })
})
