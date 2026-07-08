import { describe, expect, it } from 'vitest'
import { toolRegistryCapabilityMessages } from './tool-registry-model'
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
})
