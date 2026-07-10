import { describe, expect, it } from 'vitest'
import type { CodexPluginInfo, CodexSkillInfo } from '@/shared/codex'
import type { ToolRegistrySnapshot } from '@/shared/tools'
import { appChatContext, filterCodexPlugins, mcpServerChatContext, mcpToolChatContext, skillChatContext, skillSourceLabel, summarizeCodexResources } from './codex-resources'

describe('codex resource helpers', () => {
  it('summarizes plugins, skills, app registry, and MCP tools', () => {
    const plugins: CodexPluginInfo[] = [
      { id: 'github@openai-curated', name: 'github', displayName: 'GitHub', description: '', prompt: '', enabled: true, installed: true, toolCount: 3 },
      { id: 'gmail@openai-curated', name: 'gmail', displayName: 'Gmail', description: '', prompt: '', enabled: false, installed: false, toolCount: 0 },
    ]
    const skills: CodexSkillInfo[] = [
      { id: 'system/a', name: 'a', displayName: 'A', description: '', path: '/a', source: 'system' },
      { id: 'github/b', name: 'b', displayName: 'B', description: '', path: '/b', source: 'plugin', pluginName: 'GitHub' },
    ]
    const registry: ToolRegistrySnapshot = {
      generatedAt: '2026-07-08T00:00:00.000Z',
      apps: [
        { id: 'github', name: 'GitHub', description: null, logoUrl: null, enabled: true, accessible: true, distributionChannel: 'plugin', pluginDisplayNames: ['GitHub'] },
        { id: 'linear', name: 'Linear', description: null, logoUrl: null, enabled: true, accessible: false, distributionChannel: 'plugin', pluginDisplayNames: ['Linear'] },
      ],
      mcpServers: [
        { name: 'github', authStatus: 'authenticated', toolCount: 12, resourceCount: 0, resourceTemplateCount: 0, tools: [] },
        { name: 'browser', authStatus: 'available', toolCount: 4, resourceCount: 0, resourceTemplateCount: 0, tools: [] },
      ],
      capabilities: { appList: true, mcpServerStatus: true, errors: ['one issue'] },
    }

    expect(summarizeCodexResources({ plugins, skills, registry })).toEqual({
      plugins: 2,
      installedPlugins: 1,
      availablePlugins: 1,
      enabledPlugins: 1,
      skills: 2,
      pluginSkills: 1,
      apps: 2,
      accessibleApps: 1,
      mcpServers: 2,
      mcpTools: 16,
      registryErrors: 1,
    })
  })

  it('labels skill sources using plugin names when present', () => {
    expect(skillSourceLabel({ id: 'x', name: 'x', displayName: 'X', description: '', path: '/x', source: 'plugin', pluginName: 'GitHub' })).toBe('GitHub')
    expect(skillSourceLabel({ id: 'y', name: 'y', displayName: 'Y', description: '', path: '/y', source: 'personal' })).toBe('Personal')
  })

  it('formats skill context for chat insertion', () => {
    const context = skillChatContext({
      id: 'plugin/ce-work',
      name: 'ce-work',
      displayName: 'ce-work',
      description: 'Execute implementation work',
      path: '/skills/ce-work',
      source: 'plugin',
      pluginName: 'Compound Engineering',
    })

    expect(context).toContain('Use this Codex skill:')
    expect(context).toContain('Skill: ce-work')
    expect(context).toContain('Name: ce-work')
    expect(context).toContain('Source: Compound Engineering')
    expect(context).toContain('Description: Execute implementation work')
  })

  it('formats connected app and MCP context for chat insertion', () => {
    const appContext = appChatContext({
      id: 'github',
      name: 'GitHub',
      description: 'Repository automation',
      logoUrl: null,
      enabled: true,
      accessible: false,
      distributionChannel: 'plugin',
      pluginDisplayNames: ['GitHub'],
    })
    const server = {
      name: 'github',
      authStatus: 'authenticated',
      toolCount: 2,
      resourceCount: 1,
      resourceTemplateCount: 1,
      tools: [
        { name: 'create_issue', title: 'Create issue', description: 'Open a GitHub issue' },
        { name: 'list_prs', title: null, description: null },
      ],
    }

    expect(appContext).toContain('Connected app context:')
    expect(appContext).toContain('Status: needs access')
    expect(appContext).toContain('Plugins: GitHub')
    expect(mcpServerChatContext(server)).toContain('Known tools: Create issue, list_prs')
    expect(mcpToolChatContext(server, server.tools[0])).toContain('Tool: Create issue')
    expect(mcpToolChatContext(server, server.tools[0])).toContain('Description: Open a GitHub issue')
  })

  it('filters plugins by name, id, marketplace, description, and version', () => {
    const plugins: CodexPluginInfo[] = [
      { id: 'github@openai-curated', name: 'github', displayName: 'GitHub', description: 'Repository tools', prompt: '', enabled: true, installed: true, marketplaceName: 'openai-curated', version: '1.0.0', toolCount: 3 },
      { id: 'latex@openai-bundled', name: 'latex', displayName: 'LaTeX', description: 'Document rendering', prompt: '', enabled: false, installed: false, marketplaceName: 'openai-bundled', version: '0.2.4', toolCount: 0 },
    ]

    expect(filterCodexPlugins(plugins, 'bundled').map((plugin) => plugin.id)).toEqual(['latex@openai-bundled'])
    expect(filterCodexPlugins(plugins, 'repository').map((plugin) => plugin.id)).toEqual(['github@openai-curated'])
    expect(filterCodexPlugins(plugins, '').length).toBe(2)
  })
})
