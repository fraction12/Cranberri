import type { ToolRegistrySnapshot } from '@/shared/tools'

export interface ToolRegistryCapabilityMessage {
  id: 'apps-unavailable' | 'mcp-unavailable'
  title: string
  description: string
}

export function toolRegistryCapabilityMessages(registry?: ToolRegistrySnapshot | null): ToolRegistryCapabilityMessage[] {
  if (!registry) return []

  const messages: ToolRegistryCapabilityMessage[] = []
  if (!registry.capabilities.appList) {
    messages.push({
      id: 'apps-unavailable',
      title: 'Codex app registry unavailable',
      description: 'Plugins and apps can still run through Codex, but Cranberri cannot list them in this runtime.',
    })
  }
  if (!registry.capabilities.mcpServerStatus) {
    messages.push({
      id: 'mcp-unavailable',
      title: 'MCP server status unavailable',
      description: 'Tool events are still observed when Codex emits them, but server and tool discovery is disabled.',
    })
  }
  return messages
}
