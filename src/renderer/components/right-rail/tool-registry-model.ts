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

export function toolRegistryVisibleErrors(registry?: ToolRegistrySnapshot | null): string[] {
  if (!registry) return []

  const seen = new Set<string>()
  return registry.capabilities.errors.flatMap((error) => {
    const message = error.trim()
    if (!message || /thread not found/i.test(message)) return []
    if (seen.has(message)) return []
    seen.add(message)
    return [message]
  })
}
