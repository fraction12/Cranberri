import type { CodexPluginInfo, CodexSkillInfo, CodexUserInput } from '@/shared/codex'
import type { ToolRegistryApp, ToolRegistryMcpServer, ToolRegistryMcpTool, ToolRegistrySnapshot } from '@/shared/tools'

export type CodexResourceContextKind = 'skill' | 'app' | 'mcp-server' | 'mcp-tool' | 'tool-registry'

export interface LatestCodexResourceContext {
  kind: CodexResourceContextKind
  label: string
  text: string
  inputParts?: CodexUserInput[]
}

export interface CodexResourceSummary {
  plugins: number
  installedPlugins: number
  availablePlugins: number
  enabledPlugins: number
  skills: number
  pluginSkills: number
  apps: number
  accessibleApps: number
  mcpServers: number
  mcpTools: number
  registryErrors: number
}

export function summarizeCodexResources({
  plugins,
  skills,
  registry,
}: {
  plugins: CodexPluginInfo[]
  skills: CodexSkillInfo[]
  registry: ToolRegistrySnapshot | null
}): CodexResourceSummary {
  const apps = registry?.apps ?? []
  const mcpServers = registry?.mcpServers ?? []
  return {
    plugins: plugins.length,
    installedPlugins: plugins.filter((plugin) => plugin.installed ?? plugin.enabled).length,
    availablePlugins: plugins.filter((plugin) => !(plugin.installed ?? plugin.enabled)).length,
    enabledPlugins: plugins.filter((plugin) => plugin.enabled).length,
    skills: skills.length,
    pluginSkills: skills.filter((skill) => skill.source === 'plugin').length,
    apps: apps.length,
    accessibleApps: apps.filter((app) => app.accessible).length,
    mcpServers: mcpServers.length,
    mcpTools: mcpServers.reduce((sum, server) => sum + server.toolCount, 0),
    registryErrors: registry?.capabilities.errors.length ?? 0,
  }
}

export function skillSourceLabel(skill: CodexSkillInfo): string {
  if (skill.pluginName) return skill.pluginName
  if (skill.source === 'personal') return 'Personal'
  if (skill.source === 'system') return 'System'
  return 'Plugin'
}

export function skillChatContext(skill: CodexSkillInfo): string {
  return [
    'Use this Codex skill:',
    `Skill: ${skill.displayName}`,
    `Name: ${skill.name}`,
    `Source: ${skillSourceLabel(skill)}`,
    skill.description ? `Description: ${skill.description}` : null,
  ].filter((line): line is string => Boolean(line)).join('\n')
}

export function appChatContext(app: ToolRegistryApp): string {
  return [
    'Connected app context:',
    `App: ${app.name}`,
    `ID: ${app.id}`,
    `Status: ${app.accessible ? 'accessible' : app.enabled ? 'needs access' : 'disabled'}`,
    app.distributionChannel ? `Distribution: ${app.distributionChannel}` : null,
    app.pluginDisplayNames.length ? `Plugins: ${app.pluginDisplayNames.join(', ')}` : null,
    app.description ? `Description: ${app.description}` : null,
  ].filter((line): line is string => Boolean(line)).join('\n')
}

export function mcpServerChatContext(server: ToolRegistryMcpServer): string {
  return [
    'MCP server context:',
    `Server: ${server.name}`,
    `Auth: ${server.authStatus}`,
    `Tools: ${server.toolCount}`,
    `Resources: ${server.resourceCount}`,
    `Resource templates: ${server.resourceTemplateCount}`,
    server.tools.length ? `Known tools: ${server.tools.slice(0, 12).map((tool) => tool.title ?? tool.name).join(', ')}` : null,
  ].filter((line): line is string => Boolean(line)).join('\n')
}

export function mcpToolChatContext(server: Pick<ToolRegistryMcpServer, 'name' | 'authStatus'>, tool: ToolRegistryMcpTool): string {
  return [
    'MCP tool context:',
    `Server: ${server.name}`,
    `Auth: ${server.authStatus}`,
    `Tool: ${tool.title ?? tool.name}`,
    `Name: ${tool.name}`,
    tool.description ? `Description: ${tool.description}` : null,
  ].filter((line): line is string => Boolean(line)).join('\n')
}


export function filterCodexPlugins(plugins: CodexPluginInfo[], query: string): CodexPluginInfo[] {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return plugins
  return plugins.filter((plugin) => {
    const haystack = [plugin.id, plugin.displayName, plugin.description, plugin.marketplaceName, plugin.version].filter(Boolean).join(' ').toLowerCase()
    return haystack.includes(normalized)
  })
}
