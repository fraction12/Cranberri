import { describe, expect, it, vi } from 'vitest'
import type { ToolRegistrySnapshot } from '@/shared/tools'
import { actionMatchesQuery, buildActiveThreadMessageActions, buildAppActions, buildFileSearchActions, buildGitHubItemActions, filterAppActions } from './actions'

describe('app actions', () => {
  it('matches action queries across labels, descriptions, and keywords', () => {
    const action = {
      label: 'New browser',
      description: 'Open a shared browser surface',
      keywords: ['web', 'preview', 'dev server'],
    }

    expect(actionMatchesQuery(action, 'browser shared')).toBe(true)
    expect(actionMatchesQuery(action, 'dev preview')).toBe(true)
    expect(actionMatchesQuery(action, 'terminal')).toBe(false)
  })

  it('filters actions by all query terms', () => {
    const actions = [
      { id: 'a', group: 'workspace' as const, icon: 'chat' as const, label: 'New chat', keywords: ['codex'], run: vi.fn() },
      { id: 'b', group: 'workspace' as const, icon: 'browser' as const, label: 'New browser', keywords: ['preview'], run: vi.fn() },
    ]

    expect(filterAppActions(actions, 'new preview').map((action) => action.id)).toEqual(['b'])
    expect(filterAppActions(actions, '').map((action) => action.id)).toEqual(['a', 'b'])
  })

  it('builds workspace, window, and repo actions with disabled no-repo workspace actions', () => {
    const archiveSession = vi.fn()
    const unarchiveSession = vi.fn()
    const renameSession = vi.fn()
    const deleteSession = vi.fn()
    const toggleSessionPinned = vi.fn()
    const actions = buildAppActions({
      repos: [{ id: 'repo-1', name: 'Cranberri', path: '/repo/cranberri' }],
      activeRepoId: null,
      windows: [{ id: 'win-1', type: 'terminal', title: 'Terminal 1' }],
      activeWindowId: 'win-1',
      sessions: [{
        repoPath: '/repo/cranberri',
        session: {
          id: 'thread-1',
          title: 'Fix browser polish',
          preview: 'Shared browser work',
          cwd: '/repo/cranberri',
          createdAt: 1,
          updatedAt: 2,
          archived: false,
          turnCount: 3,
        },
      }, {
        repoPath: '/repo/cranberri',
        archived: true,
        session: {
          id: 'thread-2',
          title: 'Old issue sweep',
          preview: 'Archived work',
          cwd: '/repo/cranberri',
          createdAt: 1,
          updatedAt: 2,
          archived: true,
          turnCount: 1,
        },
      }],
      activeSessionIds: ['thread-1'],
      pinnedSessionIds: ['thread-2'],
      openChat: vi.fn(),
      openTerminal: vi.fn(),
      openBrowser: vi.fn(),
      openSettings: vi.fn(),
      openSession: vi.fn(),
      archiveSession,
      unarchiveSession,
      renameSession,
      deleteSession,
      toggleSessionPinned,
      setActiveRepo: vi.fn(),
      setActiveWindow: vi.fn(),
    })

    expect(actions.find((action) => action.id === 'workspace:new-chat')?.disabledReason).toBe('Select a repo first')
    expect(actions.find((action) => action.id === 'window:win-1')?.label).toBe('Switch to Terminal 1')
    expect(actions.find((action) => action.id === 'session:thread-1')?.label).toBe('Switch to Fix browser polish')
    expect(actions.find((action) => action.id === 'session:archived:thread-2')).toMatchObject({
      label: 'Open Old issue sweep (archived)',
      description: 'Archived - Archived work',
    })
    expect(actions.find((action) => action.id === 'session:thread-1:archive')).toMatchObject({
      label: 'Archive session: Fix browser polish',
      group: 'sessions',
    })
    expect(actions.find((action) => action.id === 'session:archived:thread-2:unarchive')).toMatchObject({
      label: 'Unarchive session: Old issue sweep',
      group: 'sessions',
    })
    expect(actions.find((action) => action.id === 'session:thread-1:rename')).toMatchObject({
      label: 'Rename session: Fix browser polish',
      group: 'sessions',
    })
    expect(actions.find((action) => action.id === 'session:thread-1:pin')).toMatchObject({
      label: 'Pin session: Fix browser polish',
      group: 'sessions',
    })
    expect(actions.find((action) => action.id === 'session:archived:thread-2:pin')).toMatchObject({
      label: 'Unpin session: Old issue sweep',
      group: 'sessions',
    })
    expect(actions.find((action) => action.id === 'session:archived:thread-2:delete')).toMatchObject({
      label: 'Delete session: Old issue sweep',
      group: 'sessions',
    })
    expect(actions.find((action) => action.id === 'repo:repo-1')?.label).toBe('Switch to Cranberri')

    actions.find((action) => action.id === 'session:thread-1:archive')?.run()
    actions.find((action) => action.id === 'session:archived:thread-2:unarchive')?.run()
    actions.find((action) => action.id === 'session:thread-1:rename')?.run()
    actions.find((action) => action.id === 'session:thread-1:pin')?.run()
    actions.find((action) => action.id === 'session:archived:thread-2:pin')?.run()
    actions.find((action) => action.id === 'session:archived:thread-2:delete')?.run()

    expect(archiveSession).toHaveBeenCalledWith('thread-1')
    expect(unarchiveSession).toHaveBeenCalledWith('thread-2')
    expect(renameSession).toHaveBeenCalledWith('thread-1', 'Fix browser polish')
    expect(toggleSessionPinned).toHaveBeenCalledWith(expect.objectContaining({
      id: 'thread-1',
      title: 'Fix browser polish',
      archived: false,
    }))
    expect(toggleSessionPinned).toHaveBeenCalledWith(expect.objectContaining({
      id: 'thread-2',
      title: 'Old issue sweep',
      archived: true,
    }))
    expect(deleteSession).toHaveBeenCalledWith('thread-2', 'Old issue sweep')
    expect(filterAppActions(actions, 'favorite fix browser').map((action) => action.id)).toContain('session:thread-1:pin')
    expect(filterAppActions(actions, 'star old issue').map((action) => action.id)).toContain('session:archived:thread-2:pin')
  })

  it('builds direct settings tab actions', () => {
    const openSettings = vi.fn()
    const sendActiveChatContext = vi.fn()
    const copyActiveChatContext = vi.fn()
    const sendDiagnosticsContext = vi.fn()
    const copyDiagnosticsContext = vi.fn()
    const clearDiagnosticsTelemetry = vi.fn((): false => false)
    const copyDiagnosticsPath = vi.fn()
    const openDiagnosticsPath = vi.fn()
    const revealDiagnosticsPath = vi.fn()
    const openNativeHelperSettings = vi.fn()
    const sendUsageContext = vi.fn()
    const copyUsageContext = vi.fn()
    const attachFilesToActiveChat = vi.fn()
    const upgradePluginMarketplaces = vi.fn()
    const actions = buildAppActions({
      repos: [],
      activeRepoId: null,
      windows: [],
      activeWindowId: null,
      sessions: [],
      openChat: vi.fn(),
      openTerminal: vi.fn(),
      openBrowser: vi.fn(),
      openSettings,
      openSession: vi.fn(),
      sendActiveChatContext,
      copyActiveChatContext,
      sendDiagnosticsContext,
      copyDiagnosticsContext,
      clearDiagnosticsTelemetry,
      copyDiagnosticsPath,
      openDiagnosticsPath,
      revealDiagnosticsPath,
      openNativeHelperSettings,
      sendUsageContext,
      copyUsageContext,
      attachFilesToActiveChat,
      upgradePluginMarketplaces,
      setActiveRepo: vi.fn(),
      setActiveWindow: vi.fn(),
    })

    actions.find((action) => action.id === 'system:diagnostics')?.run()
    actions.find((action) => action.id === 'system:apps')?.run()
    actions.find((action) => action.id === 'context:active-chat')?.run()
    actions.find((action) => action.id === 'context:active-chat:copy')?.run()
    actions.find((action) => action.id === 'context:active-chat:attach-files')?.run()
    actions.find((action) => action.id === 'context:diagnostics')?.run()
    actions.find((action) => action.id === 'context:diagnostics:copy')?.run()
    const clearTelemetryResult = actions.find((action) => action.id === 'diagnostics:telemetry:clear')?.run()
    actions.find((action) => action.id === 'diagnostics:path:userData:copy')?.run()
    actions.find((action) => action.id === 'diagnostics:path:debugTelemetry:open')?.run()
    actions.find((action) => action.id === 'diagnostics:path:sqlite:reveal')?.run()
    actions.find((action) => action.id === 'native-helper:macos-accessibility:settings')?.run()
    actions.find((action) => action.id === 'context:usage')?.run()
    actions.find((action) => action.id === 'context:usage:copy')?.run()
    actions.find((action) => action.id === 'system:plugins:marketplaces:upgrade')?.run()

    expect(openSettings).toHaveBeenCalledWith('diagnostics')
    expect(openSettings).toHaveBeenCalledWith('apps')
    expect(actions.find((action) => action.id === 'system:plugins:marketplaces:upgrade')).toMatchObject({
      label: 'Refresh Codex plugin marketplaces',
      group: 'system',
      icon: 'tools',
    })
    expect(actions.find((action) => action.id === 'context:diagnostics')).toMatchObject({
      label: 'Send diagnostics context',
      group: 'system',
      icon: 'chat',
    })
    expect(actions.find((action) => action.id === 'context:diagnostics:copy')).toMatchObject({
      label: 'Copy diagnostics context',
      group: 'system',
      icon: 'chat',
    })
    expect(actions.find((action) => action.id === 'diagnostics:telemetry:clear')).toMatchObject({
      label: 'Clear diagnostics telemetry',
      group: 'system',
      icon: 'activity',
    })
    expect(actions.find((action) => action.id === 'diagnostics:path:userData:copy')).toMatchObject({
      label: 'Copy diagnostics User data path',
      group: 'system',
      icon: 'file',
    })
    expect(actions.find((action) => action.id === 'diagnostics:path:debugTelemetry:open')).toMatchObject({
      label: 'Open diagnostics Telemetry JSONL path',
      group: 'system',
      icon: 'file',
    })
    expect(actions.find((action) => action.id === 'diagnostics:path:sqlite:reveal')).toMatchObject({
      label: 'Reveal diagnostics SQLite path',
      group: 'system',
      icon: 'file',
    })
    expect(actions.find((action) => action.id === 'native-helper:macos-accessibility:settings')).toMatchObject({
      label: 'Open macOS Accessibility settings',
      group: 'system',
      icon: 'settings',
    })
    expect(actions.find((action) => action.id === 'native-helper:macos-apple-events:settings')).toMatchObject({
      label: 'Open Apple Events automation settings',
      group: 'system',
      icon: 'settings',
    })
    expect(actions.find((action) => action.id === 'context:usage')).toMatchObject({
      label: 'Send Codex usage context',
      group: 'system',
      icon: 'chat',
    })
    expect(actions.find((action) => action.id === 'context:usage:copy')).toMatchObject({
      label: 'Copy Codex usage context',
      group: 'system',
      icon: 'chat',
    })
    expect(actions.find((action) => action.id === 'context:active-chat')).toMatchObject({
      label: 'Send active chat context',
      group: 'system',
      icon: 'chat',
      disabledReason: 'Open a chat first',
    })
    expect(actions.find((action) => action.id === 'context:active-chat:copy')).toMatchObject({
      label: 'Copy active chat context',
      group: 'system',
      icon: 'chat',
      disabledReason: 'Open a chat first',
    })
    expect(actions.find((action) => action.id === 'context:active-chat:attach-files')).toMatchObject({
      label: 'Attach files to active chat',
      group: 'files',
      icon: 'file',
      disabledReason: 'Open a chat first',
    })
    expect(filterAppActions(actions, 'rate limit credits context').map((action) => action.id)).toContain('context:usage')
    expect(filterAppActions(actions, 'copy rate limit credits context').map((action) => action.id)).toContain('context:usage:copy')
    expect(filterAppActions(actions, 'daily usage history').map((action) => action.id)).toContain('context:usage')
    expect(filterAppActions(actions, 'active chat messages context').map((action) => action.id)).toContain('context:active-chat')
    expect(filterAppActions(actions, 'copy active chat messages context').map((action) => action.id)).toContain('context:active-chat:copy')
    expect(filterAppActions(actions, 'plugin marketplace refresh').map((action) => action.id)).toContain('system:plugins:marketplaces:upgrade')
    expect(filterAppActions(actions, 'clear telemetry debug logs').map((action) => action.id)).toContain('diagnostics:telemetry:clear')
    expect(filterAppActions(actions, 'copy diagnostics user data path').map((action) => action.id)).toContain('diagnostics:path:userData:copy')
    expect(filterAppActions(actions, 'open telemetry jsonl native').map((action) => action.id)).toContain('diagnostics:path:debugTelemetry:open')
    expect(filterAppActions(actions, 'finder sqlite database').map((action) => action.id)).toContain('diagnostics:path:sqlite:reveal')
    expect(filterAppActions(actions, 'macos accessibility permission').map((action) => action.id)).toContain('native-helper:macos-accessibility:settings')
    expect(filterAppActions(actions, 'automation apple events privacy').map((action) => action.id)).toContain('native-helper:macos-apple-events:settings')
    expect(sendDiagnosticsContext).toHaveBeenCalled()
    expect(copyDiagnosticsContext).toHaveBeenCalled()
    expect(clearDiagnosticsTelemetry).toHaveBeenCalled()
    expect(clearTelemetryResult).toBe(false)
    expect(copyDiagnosticsPath).toHaveBeenCalledWith('userData')
    expect(openDiagnosticsPath).toHaveBeenCalledWith('debugTelemetry')
    expect(revealDiagnosticsPath).toHaveBeenCalledWith('sqlite')
    expect(openNativeHelperSettings).toHaveBeenCalledWith('macos-accessibility')
    expect(sendUsageContext).toHaveBeenCalled()
    expect(copyUsageContext).toHaveBeenCalled()
    expect(upgradePluginMarketplaces).toHaveBeenCalled()
    expect(sendActiveChatContext).not.toHaveBeenCalled()
    expect(copyActiveChatContext).not.toHaveBeenCalled()
    expect(attachFilesToActiveChat).not.toHaveBeenCalled()
  })

  it('builds install actions for available Codex plugins only', () => {
    const installPlugin = vi.fn()
    const actions = buildAppActions({
      repos: [],
      activeRepoId: 'repo-1',
      windows: [],
      activeWindowId: null,
      sessions: [],
      plugins: [
        { id: 'github@openai-curated', name: 'github', displayName: 'GitHub', description: 'Repository tools', prompt: '', enabled: true, installed: true, marketplaceName: 'openai-curated', version: '1.0.0', toolCount: 3 },
        { id: 'notion@openai-curated', name: 'notion', displayName: 'Notion', description: 'Workspace docs', prompt: '', enabled: false, installed: false, marketplaceName: 'openai-curated', version: '0.3.0', toolCount: 0 },
      ],
      openChat: vi.fn(),
      openTerminal: vi.fn(),
      openBrowser: vi.fn(),
      openSettings: vi.fn(),
      openSession: vi.fn(),
      installPlugin,
      setActiveRepo: vi.fn(),
      setActiveWindow: vi.fn(),
    })

    expect(actions.find((action) => action.id === 'plugin:github@openai-curated:install')).toBeUndefined()
    expect(actions.find((action) => action.id === 'plugin:notion@openai-curated:install')).toMatchObject({
      label: 'Install plugin: Notion',
      description: 'Workspace docs',
      group: 'system',
      icon: 'tools',
    })
    expect(filterAppActions(actions, 'install notion workspace').map((action) => action.id)).toContain('plugin:notion@openai-curated:install')

    actions.find((action) => action.id === 'plugin:notion@openai-curated:install')?.run()

    expect(installPlugin).toHaveBeenCalledWith({
      id: 'notion@openai-curated',
      name: 'notion',
      displayName: 'Notion',
      description: 'Workspace docs',
      prompt: '',
      enabled: false,
      installed: false,
      marketplaceName: 'openai-curated',
      version: '0.3.0',
      toolCount: 0,
    })
  })

  it('builds skill, app, and MCP context actions', () => {
    const sendSkillContext = vi.fn()
    const copySkillContext = vi.fn()
    const legacyRegistryActions = {
      sendToolRegistryContext: vi.fn(),
      copyToolRegistryContext: vi.fn(),
    } as unknown as Partial<Parameters<typeof buildAppActions>[0]>
    const sendAppContext = vi.fn()
    const copyAppContext = vi.fn()
    const sendMcpServerContext = vi.fn()
    const copyMcpServerContext = vi.fn()
    const sendMcpToolContext = vi.fn()
    const copyMcpToolContext = vi.fn()
    const registry: ToolRegistrySnapshot = {
      generatedAt: '2026-07-08T00:00:00.000Z',
      apps: [{
        id: 'github',
        name: 'GitHub',
        description: 'Repository automation',
        logoUrl: null,
        enabled: true,
        accessible: true,
        distributionChannel: 'plugin',
        pluginDisplayNames: ['GitHub'],
      }],
      mcpServers: [{
        name: 'github',
        authStatus: 'authenticated',
        toolCount: 1,
        resourceCount: 0,
        resourceTemplateCount: 0,
        tools: [{ name: 'list_pull_requests', title: 'List pull requests', description: 'Read PRs' }],
      }],
      capabilities: { appList: true, mcpServerStatus: true, errors: [] },
    }
    const skill = {
      id: 'plugin/ce-work',
      name: 'ce-work',
      displayName: 'ce-work',
      description: 'Execute implementation work',
      path: '/skills/ce-work',
      source: 'plugin' as const,
      pluginName: 'Compound Engineering',
    }

    const actions = buildAppActions({
      repos: [],
      activeRepoId: 'repo-1',
      windows: [],
      activeWindowId: null,
      sessions: [],
      skills: [skill],
      registry,
      openChat: vi.fn(),
      openTerminal: vi.fn(),
      openBrowser: vi.fn(),
      openSettings: vi.fn(),
      openSession: vi.fn(),
      sendSkillContext,
      copySkillContext,
      ...legacyRegistryActions,
      sendAppContext,
      copyAppContext,
      sendMcpServerContext,
      copyMcpServerContext,
      sendMcpToolContext,
      copyMcpToolContext,
      setActiveRepo: vi.fn(),
      setActiveWindow: vi.fn(),
    })

    expect(actions.find((action) => action.id === 'skill:plugin/ce-work:context')).toMatchObject({
      label: 'Send skill context: ce-work',
      group: 'system',
      icon: 'chat',
    })
    expect(actions.find((action) => action.id === 'skill:plugin/ce-work:copy-context')).toMatchObject({
      label: 'Copy skill context: ce-work',
      group: 'system',
      icon: 'tools',
    })
    expect(actions.find((action) => action.id === 'context:tool-registry')).toBeUndefined()
    expect(actions.find((action) => action.id === 'context:tool-registry:copy')).toBeUndefined()
    expect(actions.find((action) => action.id === 'app:github:context')).toMatchObject({
      label: 'Send app context: GitHub',
      description: 'Repository automation',
    })
    expect(actions.find((action) => action.id === 'app:github:copy-context')).toMatchObject({
      label: 'Copy app context: GitHub',
      description: 'Repository automation',
    })
    expect(actions.find((action) => action.id === 'mcp:github:context')).toMatchObject({
      label: 'Send MCP server context: github',
      description: 'authenticated - 1 tools',
    })
    expect(actions.find((action) => action.id === 'mcp:github:copy-context')).toMatchObject({
      label: 'Copy MCP server context: github',
      description: 'authenticated - 1 tools',
    })
    expect(actions.find((action) => action.id === 'mcp:github:tool:list_pull_requests:context')).toMatchObject({
      label: 'Send MCP tool context: List pull requests',
      description: 'github - Read PRs',
    })
    expect(actions.find((action) => action.id === 'mcp:github:tool:list_pull_requests:copy-context')).toMatchObject({
      label: 'Copy MCP tool context: List pull requests',
      description: 'github - Read PRs',
    })
    expect(filterAppActions(actions, 'compound skill context').map((action) => action.id)).toContain('skill:plugin/ce-work:context')
    expect(filterAppActions(actions, 'copy compound skill context').map((action) => action.id)).toContain('skill:plugin/ce-work:copy-context')
    expect(filterAppActions(actions, 'tool registry capabilities').map((action) => action.id)).not.toContain('context:tool-registry')
    expect(filterAppActions(actions, 'copy tool registry capabilities').map((action) => action.id)).not.toContain('context:tool-registry:copy')
    expect(filterAppActions(actions, 'mcp pull requests').map((action) => action.id)).toContain('mcp:github:tool:list_pull_requests:context')
    expect(filterAppActions(actions, 'copy mcp pull requests').map((action) => action.id)).toContain('mcp:github:tool:list_pull_requests:copy-context')

    actions.find((action) => action.id === 'skill:plugin/ce-work:context')?.run()
    actions.find((action) => action.id === 'skill:plugin/ce-work:copy-context')?.run()
    actions.find((action) => action.id === 'app:github:context')?.run()
    actions.find((action) => action.id === 'app:github:copy-context')?.run()
    actions.find((action) => action.id === 'mcp:github:context')?.run()
    actions.find((action) => action.id === 'mcp:github:copy-context')?.run()
    actions.find((action) => action.id === 'mcp:github:tool:list_pull_requests:context')?.run()
    actions.find((action) => action.id === 'mcp:github:tool:list_pull_requests:copy-context')?.run()

    expect(sendSkillContext).toHaveBeenCalledWith(skill)
    expect(copySkillContext).toHaveBeenCalledWith(skill)
    expect(sendAppContext).toHaveBeenCalledWith(registry.apps[0])
    expect(copyAppContext).toHaveBeenCalledWith(registry.apps[0])
    expect(sendMcpServerContext).toHaveBeenCalledWith(registry.mcpServers[0])
    expect(copyMcpServerContext).toHaveBeenCalledWith(registry.mcpServers[0])
    expect(sendMcpToolContext).toHaveBeenCalledWith(registry.mcpServers[0], registry.mcpServers[0].tools[0])
    expect(copyMcpToolContext).toHaveBeenCalledWith(registry.mcpServers[0], registry.mcpServers[0].tools[0])
  })

  it('builds latest Codex resource context reuse actions', () => {
    const sendLatestCodexResourceContextToChat = vi.fn()
    const copyLatestCodexResourceContext = vi.fn()
    const latestCodexResourceContext = {
      kind: 'mcp-tool' as const,
      label: 'List pull requests',
      text: 'MCP tool context:\nServer: github\nTool: List pull requests\nName: list_pull_requests',
    }
    const actions = buildAppActions({
      repos: [],
      activeRepoId: 'repo-1',
      windows: [{ id: 'chat-1', type: 'chat', title: 'Chat' }],
      activeWindowId: 'chat-1',
      activeThread: {
        id: 'thread-1',
        title: 'Smoke thread',
        repoId: 'repo-1',
        messages: [],
        pendingApprovals: [],
        isRunning: false,
      },
      sessions: [],
      latestCodexResourceContext,
      openChat: vi.fn(),
      openTerminal: vi.fn(),
      openBrowser: vi.fn(),
      openSettings: vi.fn(),
      openSession: vi.fn(),
      sendLatestCodexResourceContextToChat,
      copyLatestCodexResourceContext,
      setActiveRepo: vi.fn(),
      setActiveWindow: vi.fn(),
    })

    expect(actions.find((action) => action.id === 'context:codex-resource:latest')).toMatchObject({
      label: 'Send latest Codex resource context to chat',
      description: 'Send saved List pull requests context',
      disabledReason: undefined,
    })
    expect(actions.find((action) => action.id === 'codex-resource:latest:copy')).toMatchObject({
      label: 'Copy latest Codex resource context',
      disabledReason: undefined,
    })
    expect(filterAppActions(actions, 'send latest codex resource pull requests').map((action) => action.id)).toContain('context:codex-resource:latest')
    expect(filterAppActions(actions, 'copy latest mcp list pull').map((action) => action.id)).toContain('codex-resource:latest:copy')

    actions.find((action) => action.id === 'context:codex-resource:latest')?.run()
    actions.find((action) => action.id === 'codex-resource:latest:copy')?.run()

    expect(sendLatestCodexResourceContextToChat).toHaveBeenCalledWith(latestCodexResourceContext)
    expect(copyLatestCodexResourceContext).toHaveBeenCalledWith(latestCodexResourceContext)
  })

  it('disables latest Codex resource context reuse actions until resource context is sent', () => {
    const actions = buildAppActions({
      repos: [],
      activeRepoId: 'repo-1',
      windows: [{ id: 'chat-1', type: 'chat', title: 'Chat' }],
      activeWindowId: 'chat-1',
      activeThread: {
        id: 'thread-1',
        title: 'Smoke thread',
        repoId: 'repo-1',
        messages: [],
        pendingApprovals: [],
        isRunning: false,
      },
      sessions: [],
      openChat: vi.fn(),
      openTerminal: vi.fn(),
      openBrowser: vi.fn(),
      openSettings: vi.fn(),
      openSession: vi.fn(),
      sendLatestCodexResourceContextToChat: vi.fn(),
      copyLatestCodexResourceContext: vi.fn(),
      setActiveRepo: vi.fn(),
      setActiveWindow: vi.fn(),
    })

    expect(actions.find((action) => action.id === 'context:codex-resource:latest')?.disabledReason).toBe('Send a Codex resource context first')
    expect(actions.find((action) => action.id === 'codex-resource:latest:copy')?.disabledReason).toBe('Send a Codex resource context first')
  })

  it('disables sending latest Codex resource context when no chat is active', () => {
    const actions = buildAppActions({
      repos: [],
      activeRepoId: 'repo-1',
      windows: [],
      activeWindowId: null,
      sessions: [],
      latestCodexResourceContext: {
        kind: 'tool-registry',
        label: 'Codex tool registry',
        text: 'Codex tool registry context:\nApps: 1 total',
      },
      openChat: vi.fn(),
      openTerminal: vi.fn(),
      openBrowser: vi.fn(),
      openSettings: vi.fn(),
      openSession: vi.fn(),
      sendLatestCodexResourceContextToChat: vi.fn(),
      setActiveRepo: vi.fn(),
      setActiveWindow: vi.fn(),
    })

    expect(actions.find((action) => action.id === 'context:codex-resource:latest')?.disabledReason).toBe('Open a chat first')
  })

  it('builds recent tool event context actions', () => {
    const sendToolEventContext = vi.fn()
    const copyToolEventContext = vi.fn()
    const actions = buildAppActions({
      repos: [],
      activeRepoId: 'repo-1',
      windows: [],
      activeWindowId: null,
      sessions: [],
      toolEvents: [{
        eventId: 'event-1',
        threadId: 'thread-1',
        toolCallId: 'call-1',
        name: 'shell.exec',
        title: 'Run tests',
        kind: 'command',
        status: 'completed',
        timestamp: '2026-07-08T00:00:00.000Z',
        argumentsPreview: 'npm test',
        resultPreview: '184 tests passed',
        durationMs: 1212,
      }, {
        eventId: 'event-2',
        threadId: 'thread-1',
        name: 'github.create_issue',
        kind: 'mcp',
        status: 'failed',
        timestamp: '2026-07-08T00:00:01.000Z',
        server: 'github',
        connectorName: 'GitHub',
        error: 'Missing repository permission',
      }],
      openChat: vi.fn(),
      openTerminal: vi.fn(),
      openBrowser: vi.fn(),
      openSettings: vi.fn(),
      openSession: vi.fn(),
      sendToolEventContext,
      copyToolEventContext,
      setActiveRepo: vi.fn(),
      setActiveWindow: vi.fn(),
    })

    expect(actions.filter((action) => action.id.startsWith('tool-event:')).map((action) => action.id)).toEqual([
      'tool-event:event-2:context',
      'tool-event:event-2:copy-context',
      'tool-event:event-1:context',
      'tool-event:event-1:copy-context',
    ])
    expect(actions.find((action) => action.id === 'tool-event:event-2:context')).toMatchObject({
      label: 'Send tool event context: github.create_issue',
      description: 'failed - mcp - github - Missing repository permission',
      icon: 'tools',
      group: 'system',
    })
    expect(actions.find((action) => action.id === 'tool-event:event-2:copy-context')).toMatchObject({
      label: 'Copy tool event context: github.create_issue',
      description: 'failed - mcp - github - Missing repository permission',
      icon: 'tools',
      group: 'system',
    })
    expect(filterAppActions(actions, 'tool event github permission').map((action) => action.id)).toContain('tool-event:event-2:context')
    expect(filterAppActions(actions, 'copy tool event github permission').map((action) => action.id)).toContain('tool-event:event-2:copy-context')
    expect(filterAppActions(actions, 'run tests 184 passed').map((action) => action.id)).toContain('tool-event:event-1:context')

    actions.find((action) => action.id === 'tool-event:event-2:context')?.run()
    actions.find((action) => action.id === 'tool-event:event-2:copy-context')?.run()

    expect(sendToolEventContext).toHaveBeenCalledWith(expect.objectContaining({
      eventId: 'event-2',
      name: 'github.create_issue',
    }))
    expect(copyToolEventContext).toHaveBeenCalledWith(expect.objectContaining({
      eventId: 'event-2',
      name: 'github.create_issue',
    }))
  })

  it('builds session context actions for transcript search hits', () => {
    const openSession = vi.fn()
    const sendSessionContext = vi.fn()
    const copySessionContext = vi.fn()
    const archiveSession = vi.fn()
    const renameSession = vi.fn()
    const deleteSession = vi.fn()
    const result = {
      repoPath: '/repo/cranberri',
      archived: false,
      session: {
        id: 'thread-1',
        title: 'Transcript search work',
        preview: 'Session preview',
        cwd: '/repo/cranberri',
        createdAt: 1,
        updatedAt: 2,
        archived: false,
        turnCount: 3,
      },
      transcriptMatches: [{
        turnId: 'turn-2',
        itemId: 'agent-1',
        role: 'assistant',
        text: 'Found palette transcript context',
        preview: 'Found palette transcript context',
      }],
    }
    const actions = buildAppActions({
      repos: [],
      activeRepoId: 'repo-1',
      windows: [],
      activeWindowId: null,
      sessions: [result],
      openChat: vi.fn(),
      openTerminal: vi.fn(),
      openBrowser: vi.fn(),
      openSettings: vi.fn(),
      openSession,
      sendSessionContext,
      copySessionContext,
      archiveSession,
      renameSession,
      deleteSession,
      setActiveRepo: vi.fn(),
      setActiveWindow: vi.fn(),
    })

    expect(actions.find((action) => action.id === 'session:thread-1')).toMatchObject({
      label: 'Open Transcript search work',
      description: '1 transcript match - Session preview',
    })
    expect(actions.find((action) => action.id === 'session:thread-1:context')).toMatchObject({
      icon: 'chat',
      label: 'Send session match: Transcript search work',
      description: 'Found palette transcript context',
    })
    expect(actions.find((action) => action.id === 'session:thread-1:copy-context')).toMatchObject({
      icon: 'session',
      label: 'Copy session match: Transcript search work',
      description: 'Found palette transcript context',
    })
    expect(actions.find((action) => action.id === 'session:thread-1:archive')).toMatchObject({
      label: 'Archive session: Transcript search work',
    })
    expect(filterAppActions(actions, 'rename transcript search').map((action) => action.id)).toContain('session:thread-1:rename')
    expect(filterAppActions(actions, 'delete transcript search').map((action) => action.id)).toContain('session:thread-1:delete')

    actions.find((action) => action.id === 'session:thread-1')?.run()
    actions.find((action) => action.id === 'session:thread-1:context')?.run()
    actions.find((action) => action.id === 'session:thread-1:copy-context')?.run()
    actions.find((action) => action.id === 'session:thread-1:archive')?.run()
    actions.find((action) => action.id === 'session:thread-1:rename')?.run()
    actions.find((action) => action.id === 'session:thread-1:delete')?.run()

    expect(openSession).toHaveBeenCalledWith(result.session, '/repo/cranberri', false)
    expect(sendSessionContext).toHaveBeenCalledWith(result)
    expect(copySessionContext).toHaveBeenCalledWith(result)
    expect(archiveSession).toHaveBeenCalledWith('thread-1')
    expect(renameSession).toHaveBeenCalledWith('thread-1', 'Transcript search work')
    expect(deleteSession).toHaveBeenCalledWith('thread-1', 'Transcript search work')
  })

  it('builds right rail navigation actions', () => {
    const openRightRail = vi.fn()
    const actions = buildAppActions({
      repos: [],
      activeRepoId: 'repo-1',
      windows: [],
      activeWindowId: null,
      sessions: [],
      changedFileCount: 2,
      openChat: vi.fn(),
      openTerminal: vi.fn(),
      openBrowser: vi.fn(),
      openSettings: vi.fn(),
      openSession: vi.fn(),
      openRightRail,
      setActiveRepo: vi.fn(),
      setActiveWindow: vi.fn(),
    })

    expect(actions.filter((action) => action.group === 'rail').map((action) => action.id)).toEqual([
      'rail:files:changes',
      'rail:files:all',
      'rail:diff',
      'rail:commit',
      'rail:commit:draft',
      'rail:processes',
      'rail:tools',
      'rail:github',
      'rail:issue',
      'rail:close-bottom',
      'rail:file:search',
      'rail:file:go-to-line',
      'rail:file:send-context',
      'rail:file:copy-path',
      'rail:file:copy-content',
    ])
    expect(filterAppActions(actions, 'right rail processes').map((action) => action.id)).toContain('rail:processes')
    expect(filterAppActions(actions, 'git commit changes').map((action) => action.id)).toContain('rail:commit')
    expect(filterAppActions(actions, 'draft commit message').map((action) => action.id)).toContain('rail:commit:draft')
    expect(actions.find((action) => action.id === 'rail:commit')).toMatchObject({
      label: 'Open commit dialog',
      description: 'Open the right rail commit dialog for 2 changed files',
      disabledReason: undefined,
    })
    expect(actions.find((action) => action.id === 'rail:commit:draft')).toMatchObject({
      label: 'Draft commit message',
      description: 'Ask Codex to draft a commit title and summary for 2 changed files',
      disabledReason: undefined,
    })

    actions.find((action) => action.id === 'rail:files:all')?.run()
    actions.find((action) => action.id === 'rail:commit')?.run()
    actions.find((action) => action.id === 'rail:commit:draft')?.run()
    actions.find((action) => action.id === 'rail:processes')?.run()
    actions.find((action) => action.id === 'rail:close-bottom')?.run()

    expect(openRightRail).toHaveBeenCalledWith({ tab: 'files', filesMode: 'all' })
    expect(openRightRail).toHaveBeenCalledWith({ action: 'open-commit' })
    expect(openRightRail).toHaveBeenCalledWith({ action: 'open-commit-draft' })
    expect(openRightRail).toHaveBeenCalledWith({ bottomPanel: 'processes' })
    expect(openRightRail).toHaveBeenCalledWith({ bottomPanel: null })
  })

  it('disables the right rail commit action when there are no changes', () => {
    const actions = buildAppActions({
      repos: [],
      activeRepoId: 'repo-1',
      windows: [],
      activeWindowId: null,
      sessions: [],
      changedFileCount: 0,
      openChat: vi.fn(),
      openTerminal: vi.fn(),
      openBrowser: vi.fn(),
      openSettings: vi.fn(),
      openSession: vi.fn(),
      openRightRail: vi.fn(),
      setActiveRepo: vi.fn(),
      setActiveWindow: vi.fn(),
    })

    expect(actions.find((action) => action.id === 'rail:commit')).toMatchObject({
      label: 'Open commit dialog',
      disabledReason: 'No changed files to commit',
    })
    expect(actions.find((action) => action.id === 'rail:commit:draft')).toMatchObject({
      label: 'Draft commit message',
      disabledReason: 'No changed files to commit',
    })
  })

  it('builds selected right rail file actions', () => {
    const openRightRail = vi.fn()
    const attachRepoFileToActiveChat = vi.fn()
    const openSelectedFileExternal = vi.fn()
    const revealSelectedFileInFolder = vi.fn()
    const copySelectedFileAbsolutePath = vi.fn()
    const actions = buildAppActions({
      repos: [],
      activeRepoId: 'repo-1',
      windows: [],
      activeWindowId: null,
      activeThread: {
        id: 'thread-1',
        title: 'Smoke thread',
        repoId: 'repo-1',
        messages: [],
        pendingApprovals: [],
        isRunning: false,
      },
      sessions: [],
      selectedRightRailFile: { path: 'src/App.tsx', status: 'tracked' },
      openChat: vi.fn(),
      openTerminal: vi.fn(),
      openBrowser: vi.fn(),
      openSettings: vi.fn(),
      openSession: vi.fn(),
      openRightRail,
      attachRepoFileToActiveChat,
      openSelectedFileExternal,
      revealSelectedFileInFolder,
      copySelectedFileAbsolutePath,
      setActiveRepo: vi.fn(),
      setActiveWindow: vi.fn(),
    })

    expect(actions.filter((action) => action.id.startsWith('rail:file:')).map((action) => action.id)).toEqual([
      'rail:file:search',
      'rail:file:go-to-line',
      'rail:file:send-context',
      'rail:file:attach',
      'rail:file:copy-path',
      'rail:file:copy-content',
      'rail:file:copy-absolute-path',
      'rail:file:open-external',
      'rail:file:reveal',
    ])
    expect(actions.find((action) => action.id === 'rail:file:attach')).toMatchObject({
      label: 'Attach selected file to active chat',
      description: 'Attach src/App.tsx as a local file path',
      disabledReason: undefined,
    })
    expect(filterAppActions(actions, 'attach selected file active chat').map((action) => action.id)).toContain('rail:file:attach')
    expect(filterAppActions(actions, 'go to line selected file').map((action) => action.id)).toContain('rail:file:go-to-line')
    expect(filterAppActions(actions, 'copy selected file absolute path').map((action) => action.id)).toContain('rail:file:copy-absolute-path')
    expect(filterAppActions(actions, 'open selected file default app').map((action) => action.id)).toContain('rail:file:open-external')
    expect(filterAppActions(actions, 'reveal selected file finder').map((action) => action.id)).toContain('rail:file:reveal')

    actions.find((action) => action.id === 'rail:file:search')?.run()
    actions.find((action) => action.id === 'rail:file:go-to-line')?.run()
    actions.find((action) => action.id === 'rail:file:send-context')?.run()
    actions.find((action) => action.id === 'rail:file:attach')?.run()
    actions.find((action) => action.id === 'rail:file:copy-path')?.run()
    actions.find((action) => action.id === 'rail:file:copy-content')?.run()
    actions.find((action) => action.id === 'rail:file:copy-absolute-path')?.run()
    actions.find((action) => action.id === 'rail:file:open-external')?.run()
    actions.find((action) => action.id === 'rail:file:reveal')?.run()

    expect(openRightRail).toHaveBeenCalledWith({ selectedFileCommand: 'search' })
    expect(openRightRail).toHaveBeenCalledWith({ selectedFileCommand: 'go-to-line' })
    expect(openRightRail).toHaveBeenCalledWith({ selectedFileCommand: 'send-context' })
    expect(openRightRail).toHaveBeenCalledWith({ selectedFileCommand: 'copy-path' })
    expect(openRightRail).toHaveBeenCalledWith({ selectedFileCommand: 'copy-content' })
    expect(attachRepoFileToActiveChat).toHaveBeenCalledWith('src/App.tsx')
    expect(copySelectedFileAbsolutePath).toHaveBeenCalledWith('src/App.tsx')
    expect(openSelectedFileExternal).toHaveBeenCalledWith('src/App.tsx')
    expect(revealSelectedFileInFolder).toHaveBeenCalledWith('src/App.tsx')
  })

  it('disables selected right rail file actions when no rail file is selected', () => {
    const actions = buildAppActions({
      repos: [],
      activeRepoId: 'repo-1',
      windows: [],
      activeWindowId: null,
      sessions: [],
      selectedRightRailFile: null,
      openChat: vi.fn(),
      openTerminal: vi.fn(),
      openBrowser: vi.fn(),
      openSettings: vi.fn(),
      openSession: vi.fn(),
      openRightRail: vi.fn(),
      attachRepoFileToActiveChat: vi.fn(),
      openSelectedFileExternal: vi.fn(),
      revealSelectedFileInFolder: vi.fn(),
      copySelectedFileAbsolutePath: vi.fn(),
      setActiveRepo: vi.fn(),
      setActiveWindow: vi.fn(),
    })

    expect(actions.find((action) => action.id === 'rail:file:search')?.disabledReason).toBe('Select a file in the right rail first')
    expect(actions.find((action) => action.id === 'rail:file:go-to-line')?.disabledReason).toBe('Select a file in the right rail first')
    expect(actions.find((action) => action.id === 'rail:file:send-context')?.disabledReason).toBe('Select a file in the right rail first')
    expect(actions.find((action) => action.id === 'rail:file:attach')?.disabledReason).toBe('Select a file in the right rail first')
    expect(actions.find((action) => action.id === 'rail:file:copy-path')?.disabledReason).toBe('Select a file in the right rail first')
    expect(actions.find((action) => action.id === 'rail:file:copy-content')?.disabledReason).toBe('Select a file in the right rail first')
    expect(actions.find((action) => action.id === 'rail:file:copy-absolute-path')?.disabledReason).toBe('Select a file in the right rail first')
    expect(actions.find((action) => action.id === 'rail:file:open-external')?.disabledReason).toBe('Select a file in the right rail first')
    expect(actions.find((action) => action.id === 'rail:file:reveal')?.disabledReason).toBe('Select a file in the right rail first')
  })

  it('disables selected file attachment when the active file is deleted', () => {
    const actions = buildAppActions({
      repos: [],
      activeRepoId: 'repo-1',
      windows: [],
      activeWindowId: null,
      activeThread: {
        id: 'thread-1',
        title: 'Smoke thread',
        repoId: 'repo-1',
        messages: [],
        pendingApprovals: [],
        isRunning: false,
      },
      sessions: [],
      selectedRightRailFile: { path: 'src/removed.ts', status: 'deleted' },
      openChat: vi.fn(),
      openTerminal: vi.fn(),
      openBrowser: vi.fn(),
      openSettings: vi.fn(),
      openSession: vi.fn(),
      openRightRail: vi.fn(),
      attachRepoFileToActiveChat: vi.fn(),
      openSelectedFileExternal: vi.fn(),
      revealSelectedFileInFolder: vi.fn(),
      copySelectedFileAbsolutePath: vi.fn(),
      setActiveRepo: vi.fn(),
      setActiveWindow: vi.fn(),
    })

    expect(actions.find((action) => action.id === 'rail:file:attach')?.disabledReason).toBe('Selected file no longer exists in the working tree')
    expect(actions.find((action) => action.id === 'rail:file:copy-absolute-path')?.disabledReason).toBe('Selected file no longer exists in the working tree')
    expect(actions.find((action) => action.id === 'rail:file:open-external')?.disabledReason).toBe('Selected file no longer exists in the working tree')
    expect(actions.find((action) => action.id === 'rail:file:reveal')?.disabledReason).toBe('Selected file no longer exists in the working tree')
  })

  it('builds active window context actions for focused terminal and browser windows', () => {
    const sendActiveWindowContext = vi.fn()
    const copyActiveWindowContext = vi.fn()
    const terminalActions = buildAppActions({
      repos: [],
      activeRepoId: 'repo-1',
      windows: [
        { id: 'chat-1', type: 'chat', title: 'Chat' },
        { id: 'term-1', type: 'terminal', title: 'Terminal' },
      ],
      activeWindowId: 'term-1',
      sessions: [],
      openChat: vi.fn(),
      openTerminal: vi.fn(),
      openBrowser: vi.fn(),
      openSettings: vi.fn(),
      openSession: vi.fn(),
      sendActiveWindowContext,
      copyActiveWindowContext,
      setActiveRepo: vi.fn(),
      setActiveWindow: vi.fn(),
    })

    expect(terminalActions.find((action) => action.id === 'context:active-terminal')).toMatchObject({
      disabledReason: undefined,
      description: 'Send Terminal buffer to chat',
    })
    expect(terminalActions.find((action) => action.id === 'context:active-terminal:copy')).toMatchObject({
      disabledReason: undefined,
      description: 'Copy Terminal formatted buffer context',
    })
    expect(terminalActions.find((action) => action.id === 'context:active-browser-page')?.disabledReason).toBe('Focus a browser window first')
    terminalActions.find((action) => action.id === 'context:active-terminal')?.run()
    terminalActions.find((action) => action.id === 'context:active-terminal:copy')?.run()
    expect(sendActiveWindowContext).toHaveBeenCalledWith('term-1', 'terminal-buffer')
    expect(copyActiveWindowContext).toHaveBeenCalledWith('term-1', 'terminal-buffer')

    const browserActions = buildAppActions({
      repos: [],
      activeRepoId: 'repo-1',
      windows: [{ id: 'browser-1', type: 'browser', title: 'Preview' }],
      activeWindowId: 'browser-1',
      sessions: [],
      openChat: vi.fn(),
      openTerminal: vi.fn(),
      openBrowser: vi.fn(),
      openSettings: vi.fn(),
      openSession: vi.fn(),
      sendActiveWindowContext,
      copyActiveWindowContext,
      setActiveRepo: vi.fn(),
      setActiveWindow: vi.fn(),
    })

    browserActions.find((action) => action.id === 'context:active-browser-page')?.run()
    browserActions.find((action) => action.id === 'context:active-browser-screenshot')?.run()
    browserActions.find((action) => action.id === 'context:active-browser-screenshot:copy')?.run()

    expect(sendActiveWindowContext).toHaveBeenCalledWith('browser-1', 'browser-page')
    expect(sendActiveWindowContext).toHaveBeenCalledWith('browser-1', 'browser-screenshot')
    expect(copyActiveWindowContext).toHaveBeenCalledWith('browser-1', 'browser-screenshot')
    expect(browserActions.find((action) => action.id === 'context:active-browser-inspection')).toMatchObject({
      description: 'Capture a visible element in Preview for chat',
      disabledReason: undefined,
    })
    expect(browserActions.find((action) => action.id === 'context:active-browser-inspection:copy')).toMatchObject({
      description: 'Capture a visible element in Preview and copy its context',
      disabledReason: undefined,
    })
    browserActions.find((action) => action.id === 'context:active-browser-inspection')?.run()
    browserActions.find((action) => action.id === 'context:active-browser-inspection:copy')?.run()
    expect(sendActiveWindowContext).toHaveBeenCalledWith('browser-1', 'browser-inspection')
    expect(copyActiveWindowContext).toHaveBeenCalledWith('browser-1', 'browser-inspection')
  })

  it('builds active browser inspected-element context action', () => {
    const sendActiveWindowContext = vi.fn()
    const copyActiveWindowContext = vi.fn()
    const actions = buildAppActions({
      repos: [],
      activeRepoId: 'repo-1',
      windows: [{ id: 'browser-1', type: 'browser', title: 'Preview' }],
      activeWindowId: 'browser-1',
      sessions: [],
      latestBrowserInspection: {
        windowId: 'browser-1',
        url: 'http://localhost:5173/',
        title: 'Preview',
        selector: 'main h1',
        tagName: 'h1',
        text: 'Smoke Browser Page',
        rect: { x: 0, y: 0, width: 320, height: 40 },
        styles: {
          display: 'block',
          fontFamily: 'Inter',
          fontSize: '24px',
          fontWeight: '700',
          color: 'rgb(255, 255, 255)',
          backgroundColor: 'rgba(0, 0, 0, 0)',
          margin: '0px',
          padding: '0px',
          borderRadius: '0px',
        },
        attributes: { id: 'hero' },
      },
      openChat: vi.fn(),
      openTerminal: vi.fn(),
      openBrowser: vi.fn(),
      openSettings: vi.fn(),
      openSession: vi.fn(),
      sendActiveWindowContext,
      copyActiveWindowContext,
      setActiveRepo: vi.fn(),
      setActiveWindow: vi.fn(),
    })

    expect(actions.find((action) => action.id === 'context:active-browser-inspection')).toMatchObject({
      label: 'Send active browser element context',
      description: 'Send inspected main h1 element to chat',
      disabledReason: undefined,
    })
    expect(actions.find((action) => action.id === 'context:active-browser-inspection:copy')).toMatchObject({
      label: 'Copy active browser element context',
      description: 'Copy inspected main h1 element context',
      disabledReason: undefined,
    })
    expect(filterAppActions(actions, 'browser element styles smoke').map((action) => action.id)).toContain('context:active-browser-inspection')
    expect(filterAppActions(actions, 'copy browser element styles smoke').map((action) => action.id)).toContain('context:active-browser-inspection:copy')

    actions.find((action) => action.id === 'context:active-browser-inspection')?.run()
    actions.find((action) => action.id === 'context:active-browser-inspection:copy')?.run()

    expect(sendActiveWindowContext).toHaveBeenCalledWith('browser-1', 'browser-inspection')
    expect(copyActiveWindowContext).toHaveBeenCalledWith('browser-1', 'browser-inspection')
  })

  it('builds latest terminal context reuse actions', () => {
    const sendLatestTerminalContextToChat = vi.fn()
    const copyLatestTerminalContext = vi.fn()
    const latestTerminalContext = {
      terminalId: 'terminal-term-1',
      repoPath: '/repo/project',
      text: 'npm test\ncranberri-terminal-context-ready',
    }
    const actions = buildAppActions({
      repos: [],
      activeRepoId: 'repo-1',
      windows: [{ id: 'chat-1', type: 'chat', title: 'Chat' }],
      activeWindowId: 'chat-1',
      activeThread: {
        id: 'thread-1',
        title: 'Smoke thread',
        repoId: 'repo-1',
        messages: [],
        pendingApprovals: [],
        isRunning: false,
      },
      sessions: [],
      latestTerminalContext,
      openChat: vi.fn(),
      openTerminal: vi.fn(),
      openBrowser: vi.fn(),
      openSettings: vi.fn(),
      openSession: vi.fn(),
      sendLatestTerminalContextToChat,
      copyLatestTerminalContext,
      setActiveRepo: vi.fn(),
      setActiveWindow: vi.fn(),
    })

    expect(actions.find((action) => action.id === 'context:terminal:latest')).toMatchObject({
      label: 'Send latest terminal context to chat',
      description: 'Send saved terminal buffer from terminal-term-1',
      disabledReason: undefined,
    })
    expect(actions.find((action) => action.id === 'terminal:latest:copy')).toMatchObject({
      label: 'Copy latest terminal context',
      disabledReason: undefined,
    })
    expect(filterAppActions(actions, 'send latest terminal context').map((action) => action.id)).toContain('context:terminal:latest')
    expect(filterAppActions(actions, 'copy latest terminal buffer').map((action) => action.id)).toContain('terminal:latest:copy')

    actions.find((action) => action.id === 'context:terminal:latest')?.run()
    actions.find((action) => action.id === 'terminal:latest:copy')?.run()

    expect(sendLatestTerminalContextToChat).toHaveBeenCalledWith(latestTerminalContext)
    expect(copyLatestTerminalContext).toHaveBeenCalledWith(latestTerminalContext)
  })

  it('disables latest terminal context reuse actions until terminal context is captured', () => {
    const actions = buildAppActions({
      repos: [],
      activeRepoId: 'repo-1',
      windows: [{ id: 'chat-1', type: 'chat', title: 'Chat' }],
      activeWindowId: 'chat-1',
      activeThread: {
        id: 'thread-1',
        title: 'Smoke thread',
        repoId: 'repo-1',
        messages: [],
        pendingApprovals: [],
        isRunning: false,
      },
      sessions: [],
      openChat: vi.fn(),
      openTerminal: vi.fn(),
      openBrowser: vi.fn(),
      openSettings: vi.fn(),
      openSession: vi.fn(),
      sendLatestTerminalContextToChat: vi.fn(),
      copyLatestTerminalContext: vi.fn(),
      setActiveRepo: vi.fn(),
      setActiveWindow: vi.fn(),
    })

    expect(actions.find((action) => action.id === 'context:terminal:latest')?.disabledReason).toBe('Capture terminal context first')
    expect(actions.find((action) => action.id === 'terminal:latest:copy')?.disabledReason).toBe('Capture terminal context first')
  })

  it('disables sending latest terminal context when no chat is active', () => {
    const actions = buildAppActions({
      repos: [],
      activeRepoId: 'repo-1',
      windows: [{ id: 'term-1', type: 'terminal', title: 'Terminal' }],
      activeWindowId: 'term-1',
      sessions: [],
      latestTerminalContext: {
        terminalId: 'terminal-term-1',
        repoPath: '/repo/project',
        text: 'npm test',
      },
      openChat: vi.fn(),
      openTerminal: vi.fn(),
      openBrowser: vi.fn(),
      openSettings: vi.fn(),
      openSession: vi.fn(),
      sendLatestTerminalContextToChat: vi.fn(),
      setActiveRepo: vi.fn(),
      setActiveWindow: vi.fn(),
    })

    expect(actions.find((action) => action.id === 'context:terminal:latest')?.disabledReason).toBe('Open a chat first')
  })

  it('builds latest repo changes context reuse actions', () => {
    const sendLatestRepoChangesContextToChat = vi.fn()
    const copyLatestRepoChangesContext = vi.fn()
    const latestRepoChangesContext = {
      kind: 'diff' as const,
      repoPath: '/repo/project',
      status: [{ path: 'src/app.ts', status: 'modified' as const }],
      diff: {
        files: [{
          to: 'src/app.ts',
          additions: 2,
          deletions: 1,
          chunks: [{
            oldStart: 1,
            oldLines: 3,
            newStart: 1,
            newLines: 4,
            changes: [
              { type: 'normal' as const, line: ' const ready = false' },
              { type: 'del' as const, line: '-console.log(ready)' },
              { type: 'add' as const, line: '+console.log("cranberri-repo-context-ready")' },
            ],
          }],
        }],
      },
    }
    const actions = buildAppActions({
      repos: [],
      activeRepoId: 'repo-1',
      windows: [{ id: 'chat-1', type: 'chat', title: 'Chat' }],
      activeWindowId: 'chat-1',
      activeThread: {
        id: 'thread-1',
        title: 'Smoke thread',
        repoId: 'repo-1',
        messages: [],
        pendingApprovals: [],
        isRunning: false,
      },
      sessions: [],
      latestRepoChangesContext,
      openChat: vi.fn(),
      openTerminal: vi.fn(),
      openBrowser: vi.fn(),
      openSettings: vi.fn(),
      openSession: vi.fn(),
      sendLatestRepoChangesContextToChat,
      copyLatestRepoChangesContext,
      setActiveRepo: vi.fn(),
      setActiveWindow: vi.fn(),
    })

    expect(actions.find((action) => action.id === 'context:repo-changes:latest')).toMatchObject({
      label: 'Send latest repo changes context to chat',
      description: 'Send saved repo diff context from /repo/project',
      disabledReason: undefined,
    })
    expect(actions.find((action) => action.id === 'repo:changes:latest:copy')).toMatchObject({
      label: 'Copy latest repo changes context',
      disabledReason: undefined,
    })
    expect(filterAppActions(actions, 'send latest repo diff context').map((action) => action.id)).toContain('context:repo-changes:latest')
    expect(filterAppActions(actions, 'copy latest repo changes src app').map((action) => action.id)).toContain('repo:changes:latest:copy')

    actions.find((action) => action.id === 'context:repo-changes:latest')?.run()
    actions.find((action) => action.id === 'repo:changes:latest:copy')?.run()

    expect(sendLatestRepoChangesContextToChat).toHaveBeenCalledWith(latestRepoChangesContext)
    expect(copyLatestRepoChangesContext).toHaveBeenCalledWith(latestRepoChangesContext)
  })

  it('disables latest repo changes context reuse actions until repo context is sent', () => {
    const actions = buildAppActions({
      repos: [],
      activeRepoId: 'repo-1',
      windows: [{ id: 'chat-1', type: 'chat', title: 'Chat' }],
      activeWindowId: 'chat-1',
      activeThread: {
        id: 'thread-1',
        title: 'Smoke thread',
        repoId: 'repo-1',
        messages: [],
        pendingApprovals: [],
        isRunning: false,
      },
      sessions: [],
      openChat: vi.fn(),
      openTerminal: vi.fn(),
      openBrowser: vi.fn(),
      openSettings: vi.fn(),
      openSession: vi.fn(),
      sendLatestRepoChangesContextToChat: vi.fn(),
      copyLatestRepoChangesContext: vi.fn(),
      setActiveRepo: vi.fn(),
      setActiveWindow: vi.fn(),
    })

    expect(actions.find((action) => action.id === 'context:repo-changes:latest')?.disabledReason).toBe('Send repo status or diff context first')
    expect(actions.find((action) => action.id === 'repo:changes:latest:copy')?.disabledReason).toBe('Send repo status or diff context first')
  })

  it('disables sending latest repo changes context when no chat is active', () => {
    const actions = buildAppActions({
      repos: [],
      activeRepoId: 'repo-1',
      windows: [],
      activeWindowId: null,
      sessions: [],
      latestRepoChangesContext: {
        kind: 'status',
        repoPath: '/repo/project',
        status: [{ path: 'src/app.ts', status: 'modified' }],
        diff: null,
      },
      openChat: vi.fn(),
      openTerminal: vi.fn(),
      openBrowser: vi.fn(),
      openSettings: vi.fn(),
      openSession: vi.fn(),
      sendLatestRepoChangesContextToChat: vi.fn(),
      setActiveRepo: vi.fn(),
      setActiveWindow: vi.fn(),
    })

    expect(actions.find((action) => action.id === 'context:repo-changes:latest')?.disabledReason).toBe('Open a chat first')
  })

  it('builds latest repo file context reuse actions', () => {
    const sendLatestRepoFileContextToChat = vi.fn()
    const copyLatestRepoFileContext = vi.fn()
    const latestRepoFileContext = {
      repoPath: '/repo/project',
      file: { path: 'README.md', status: 'tracked' as const },
      workingContent: 'Search marker: cranberri-electron-smoke-search.',
    }
    const actions = buildAppActions({
      repos: [],
      activeRepoId: 'repo-1',
      windows: [{ id: 'chat-1', type: 'chat', title: 'Chat' }],
      activeWindowId: 'chat-1',
      activeThread: {
        id: 'thread-1',
        title: 'Smoke thread',
        repoId: 'repo-1',
        messages: [],
        pendingApprovals: [],
        isRunning: false,
      },
      sessions: [],
      latestRepoFileContext,
      openChat: vi.fn(),
      openTerminal: vi.fn(),
      openBrowser: vi.fn(),
      openSettings: vi.fn(),
      openSession: vi.fn(),
      sendLatestRepoFileContextToChat,
      copyLatestRepoFileContext,
      setActiveRepo: vi.fn(),
      setActiveWindow: vi.fn(),
    })

    expect(actions.find((action) => action.id === 'context:repo-file:latest')).toMatchObject({
      label: 'Send latest repo file context to chat',
      description: 'Send saved file context for README.md',
      disabledReason: undefined,
    })
    expect(actions.find((action) => action.id === 'repo:file:latest:copy')).toMatchObject({
      label: 'Copy latest repo file context',
      disabledReason: undefined,
    })
    expect(filterAppActions(actions, 'send latest repo file readme').map((action) => action.id)).toContain('context:repo-file:latest')
    expect(filterAppActions(actions, 'copy latest repo file smoke search').map((action) => action.id)).toContain('repo:file:latest:copy')

    actions.find((action) => action.id === 'context:repo-file:latest')?.run()
    actions.find((action) => action.id === 'repo:file:latest:copy')?.run()

    expect(sendLatestRepoFileContextToChat).toHaveBeenCalledWith(latestRepoFileContext)
    expect(copyLatestRepoFileContext).toHaveBeenCalledWith(latestRepoFileContext)
  })

  it('disables latest repo file context reuse actions until file context is sent', () => {
    const actions = buildAppActions({
      repos: [],
      activeRepoId: 'repo-1',
      windows: [{ id: 'chat-1', type: 'chat', title: 'Chat' }],
      activeWindowId: 'chat-1',
      activeThread: {
        id: 'thread-1',
        title: 'Smoke thread',
        repoId: 'repo-1',
        messages: [],
        pendingApprovals: [],
        isRunning: false,
      },
      sessions: [],
      openChat: vi.fn(),
      openTerminal: vi.fn(),
      openBrowser: vi.fn(),
      openSettings: vi.fn(),
      openSession: vi.fn(),
      sendLatestRepoFileContextToChat: vi.fn(),
      copyLatestRepoFileContext: vi.fn(),
      setActiveRepo: vi.fn(),
      setActiveWindow: vi.fn(),
    })

    expect(actions.find((action) => action.id === 'context:repo-file:latest')?.disabledReason).toBe('Send a repo file context first')
    expect(actions.find((action) => action.id === 'repo:file:latest:copy')?.disabledReason).toBe('Send a repo file context first')
  })

  it('disables sending latest repo file context when no chat is active', () => {
    const actions = buildAppActions({
      repos: [],
      activeRepoId: 'repo-1',
      windows: [],
      activeWindowId: null,
      sessions: [],
      latestRepoFileContext: {
        repoPath: '/repo/project',
        file: { path: 'README.md', status: 'tracked' },
        workingContent: 'readme',
      },
      openChat: vi.fn(),
      openTerminal: vi.fn(),
      openBrowser: vi.fn(),
      openSettings: vi.fn(),
      openSession: vi.fn(),
      sendLatestRepoFileContextToChat: vi.fn(),
      setActiveRepo: vi.fn(),
      setActiveWindow: vi.fn(),
    })

    expect(actions.find((action) => action.id === 'context:repo-file:latest')?.disabledReason).toBe('Open a chat first')
  })

  it('builds latest process context reuse actions', () => {
    const sendLatestProcessContextToChat = vi.fn()
    const copyLatestProcessContext = vi.fn()
    const latestProcessContext = {
      id: 'child:1234',
      pid: 1234,
      ppid: 99,
      command: 'npm run dev -- --host 0.0.0.0',
      repoPath: '/repo/cranberri',
      cwd: '/repo/cranberri',
      kind: 'dev-server' as const,
      status: 'running' as const,
      source: 'terminal' as const,
      terminalWindowId: 'terminal-win-1',
      startedAt: 1700000000000,
    }
    const actions = buildAppActions({
      repos: [],
      activeRepoId: 'repo-1',
      windows: [{ id: 'chat-1', type: 'chat', title: 'Chat' }],
      activeWindowId: 'chat-1',
      activeThread: {
        id: 'thread-1',
        title: 'Smoke thread',
        repoId: 'repo-1',
        messages: [],
        pendingApprovals: [],
        isRunning: false,
      },
      sessions: [],
      latestProcessContext,
      openChat: vi.fn(),
      openTerminal: vi.fn(),
      openBrowser: vi.fn(),
      openSettings: vi.fn(),
      openSession: vi.fn(),
      sendLatestProcessContextToChat,
      copyLatestProcessContext,
      setActiveRepo: vi.fn(),
      setActiveWindow: vi.fn(),
    })

    expect(actions.find((action) => action.id === 'context:process:latest')).toMatchObject({
      label: 'Send latest process context to chat',
      description: 'Send saved process context for npm run dev -- --host 0.0.0.0',
      disabledReason: undefined,
    })
    expect(actions.find((action) => action.id === 'process:latest:copy')).toMatchObject({
      label: 'Copy latest process context',
      disabledReason: undefined,
    })
    expect(filterAppActions(actions, 'send latest process dev server').map((action) => action.id)).toContain('context:process:latest')
    expect(filterAppActions(actions, 'copy latest process terminal').map((action) => action.id)).toContain('process:latest:copy')

    actions.find((action) => action.id === 'context:process:latest')?.run()
    actions.find((action) => action.id === 'process:latest:copy')?.run()

    expect(sendLatestProcessContextToChat).toHaveBeenCalledWith(latestProcessContext)
    expect(copyLatestProcessContext).toHaveBeenCalledWith(latestProcessContext)
  })

  it('disables latest process context reuse actions until process context is sent', () => {
    const actions = buildAppActions({
      repos: [],
      activeRepoId: 'repo-1',
      windows: [{ id: 'chat-1', type: 'chat', title: 'Chat' }],
      activeWindowId: 'chat-1',
      activeThread: {
        id: 'thread-1',
        title: 'Smoke thread',
        repoId: 'repo-1',
        messages: [],
        pendingApprovals: [],
        isRunning: false,
      },
      sessions: [],
      openChat: vi.fn(),
      openTerminal: vi.fn(),
      openBrowser: vi.fn(),
      openSettings: vi.fn(),
      openSession: vi.fn(),
      sendLatestProcessContextToChat: vi.fn(),
      copyLatestProcessContext: vi.fn(),
      setActiveRepo: vi.fn(),
      setActiveWindow: vi.fn(),
    })

    expect(actions.find((action) => action.id === 'context:process:latest')?.disabledReason).toBe('Send a process context first')
    expect(actions.find((action) => action.id === 'process:latest:copy')?.disabledReason).toBe('Send a process context first')
  })

  it('disables sending latest process context when no chat is active', () => {
    const actions = buildAppActions({
      repos: [],
      activeRepoId: 'repo-1',
      windows: [],
      activeWindowId: null,
      sessions: [],
      latestProcessContext: {
        id: 'child:1234',
        pid: 1234,
        command: 'npm run dev',
        repoPath: '/repo/cranberri',
        cwd: '/repo/cranberri',
        kind: 'dev-server',
        status: 'running',
        source: 'terminal',
        startedAt: 1700000000000,
      },
      openChat: vi.fn(),
      openTerminal: vi.fn(),
      openBrowser: vi.fn(),
      openSettings: vi.fn(),
      openSession: vi.fn(),
      sendLatestProcessContextToChat: vi.fn(),
      setActiveRepo: vi.fn(),
      setActiveWindow: vi.fn(),
    })

    expect(actions.find((action) => action.id === 'context:process:latest')?.disabledReason).toBe('Open a chat first')
  })

  it('builds latest tool event context reuse actions', () => {
    const sendLatestToolEventContextToChat = vi.fn()
    const copyLatestToolEventContext = vi.fn()
    const latestToolEventContext = {
      eventId: 'event-1',
      threadId: 'thread-1',
      toolCallId: 'call-1',
      name: 'shell.exec',
      title: 'Run tests',
      kind: 'command' as const,
      status: 'completed' as const,
      timestamp: '2026-07-08T00:00:00.000Z',
      argumentsPreview: 'npm test',
      resultPreview: '184 tests passed',
      durationMs: 1212,
    }
    const actions = buildAppActions({
      repos: [],
      activeRepoId: 'repo-1',
      windows: [{ id: 'chat-1', type: 'chat', title: 'Chat' }],
      activeWindowId: 'chat-1',
      activeThread: {
        id: 'thread-1',
        title: 'Smoke thread',
        repoId: 'repo-1',
        messages: [],
        pendingApprovals: [],
        isRunning: false,
      },
      sessions: [],
      latestToolEventContext,
      openChat: vi.fn(),
      openTerminal: vi.fn(),
      openBrowser: vi.fn(),
      openSettings: vi.fn(),
      openSession: vi.fn(),
      sendLatestToolEventContextToChat,
      copyLatestToolEventContext,
      setActiveRepo: vi.fn(),
      setActiveWindow: vi.fn(),
    })

    expect(actions.find((action) => action.id === 'context:tool-event:latest')).toMatchObject({
      label: 'Send latest tool event context to chat',
      description: 'Send saved tool event context for Run tests',
      disabledReason: undefined,
    })
    expect(actions.find((action) => action.id === 'tool-event:latest:copy')).toMatchObject({
      label: 'Copy latest tool event context',
      disabledReason: undefined,
    })
    expect(filterAppActions(actions, 'send latest tool event tests').map((action) => action.id)).toContain('context:tool-event:latest')
    expect(filterAppActions(actions, 'copy latest tool 184 passed').map((action) => action.id)).toContain('tool-event:latest:copy')

    actions.find((action) => action.id === 'context:tool-event:latest')?.run()
    actions.find((action) => action.id === 'tool-event:latest:copy')?.run()

    expect(sendLatestToolEventContextToChat).toHaveBeenCalledWith(latestToolEventContext)
    expect(copyLatestToolEventContext).toHaveBeenCalledWith(latestToolEventContext)
  })

  it('disables latest tool event context reuse actions until tool event context is sent', () => {
    const actions = buildAppActions({
      repos: [],
      activeRepoId: 'repo-1',
      windows: [{ id: 'chat-1', type: 'chat', title: 'Chat' }],
      activeWindowId: 'chat-1',
      activeThread: {
        id: 'thread-1',
        title: 'Smoke thread',
        repoId: 'repo-1',
        messages: [],
        pendingApprovals: [],
        isRunning: false,
      },
      sessions: [],
      openChat: vi.fn(),
      openTerminal: vi.fn(),
      openBrowser: vi.fn(),
      openSettings: vi.fn(),
      openSession: vi.fn(),
      sendLatestToolEventContextToChat: vi.fn(),
      copyLatestToolEventContext: vi.fn(),
      setActiveRepo: vi.fn(),
      setActiveWindow: vi.fn(),
    })

    expect(actions.find((action) => action.id === 'context:tool-event:latest')?.disabledReason).toBe('Send a tool event context first')
    expect(actions.find((action) => action.id === 'tool-event:latest:copy')?.disabledReason).toBe('Send a tool event context first')
  })

  it('disables sending latest tool event context when no chat is active', () => {
    const actions = buildAppActions({
      repos: [],
      activeRepoId: 'repo-1',
      windows: [],
      activeWindowId: null,
      sessions: [],
      latestToolEventContext: {
        eventId: 'event-1',
        threadId: 'thread-1',
        name: 'shell.exec',
        kind: 'command',
        status: 'completed',
        timestamp: '2026-07-08T00:00:00.000Z',
      },
      openChat: vi.fn(),
      openTerminal: vi.fn(),
      openBrowser: vi.fn(),
      openSettings: vi.fn(),
      openSession: vi.fn(),
      sendLatestToolEventContextToChat: vi.fn(),
      setActiveRepo: vi.fn(),
      setActiveWindow: vi.fn(),
    })

    expect(actions.find((action) => action.id === 'context:tool-event:latest')?.disabledReason).toBe('Open a chat first')
  })

  it('builds latest session context reuse actions', () => {
    const sendLatestSessionContextToChat = vi.fn()
    const copyLatestSessionContext = vi.fn()
    const latestSessionContext = {
      result: {
        repoPath: '/repo/cranberri',
        archived: false,
        session: {
          id: 'thread-1',
          title: 'Smoke Codex Thread',
          preview: 'Session preview',
          cwd: '/repo/cranberri',
          createdAt: 1,
          updatedAt: 2,
          archived: false,
          turnCount: 2,
        },
        transcriptMatches: [{
          turnId: 'turn-1',
          itemId: 'agent-1',
          role: 'assistant',
          text: 'Found cranberri fake codex smoke',
          preview: 'Found cranberri fake codex smoke',
        }],
      },
      thread: {
        id: 'thread-1',
        title: 'Smoke Codex Thread',
        preview: 'Session preview',
        cwd: '/repo/cranberri',
        createdAt: 1,
        updatedAt: 2,
        archived: false,
        turnCount: 2,
        turns: [],
      },
    }
    const actions = buildAppActions({
      repos: [],
      activeRepoId: 'repo-1',
      windows: [{ id: 'chat-1', type: 'chat', title: 'Chat' }],
      activeWindowId: 'chat-1',
      activeThread: {
        id: 'thread-1',
        title: 'Smoke thread',
        repoId: 'repo-1',
        messages: [],
        pendingApprovals: [],
        isRunning: false,
      },
      sessions: [],
      latestSessionContext,
      openChat: vi.fn(),
      openTerminal: vi.fn(),
      openBrowser: vi.fn(),
      openSettings: vi.fn(),
      openSession: vi.fn(),
      sendLatestSessionContextToChat,
      copyLatestSessionContext,
      setActiveRepo: vi.fn(),
      setActiveWindow: vi.fn(),
    })

    expect(actions.find((action) => action.id === 'context:session:latest')).toMatchObject({
      label: 'Send latest session context to chat',
      description: 'Send saved session context from Smoke Codex Thread',
      disabledReason: undefined,
    })
    expect(actions.find((action) => action.id === 'session:latest:copy')).toMatchObject({
      label: 'Copy latest session context',
      disabledReason: undefined,
    })
    expect(filterAppActions(actions, 'send latest session smoke').map((action) => action.id)).toContain('context:session:latest')
    expect(filterAppActions(actions, 'copy latest session fake codex').map((action) => action.id)).toContain('session:latest:copy')

    actions.find((action) => action.id === 'context:session:latest')?.run()
    actions.find((action) => action.id === 'session:latest:copy')?.run()

    expect(sendLatestSessionContextToChat).toHaveBeenCalledWith(latestSessionContext)
    expect(copyLatestSessionContext).toHaveBeenCalledWith(latestSessionContext)
  })

  it('disables latest session context reuse actions until session context is sent', () => {
    const actions = buildAppActions({
      repos: [],
      activeRepoId: 'repo-1',
      windows: [{ id: 'chat-1', type: 'chat', title: 'Chat' }],
      activeWindowId: 'chat-1',
      activeThread: {
        id: 'thread-1',
        title: 'Smoke thread',
        repoId: 'repo-1',
        messages: [],
        pendingApprovals: [],
        isRunning: false,
      },
      sessions: [],
      openChat: vi.fn(),
      openTerminal: vi.fn(),
      openBrowser: vi.fn(),
      openSettings: vi.fn(),
      openSession: vi.fn(),
      sendLatestSessionContextToChat: vi.fn(),
      copyLatestSessionContext: vi.fn(),
      setActiveRepo: vi.fn(),
      setActiveWindow: vi.fn(),
    })

    expect(actions.find((action) => action.id === 'context:session:latest')?.disabledReason).toBe('Send a session context first')
    expect(actions.find((action) => action.id === 'session:latest:copy')?.disabledReason).toBe('Send a session context first')
  })

  it('disables sending latest session context when no chat is active', () => {
    const actions = buildAppActions({
      repos: [],
      activeRepoId: 'repo-1',
      windows: [],
      activeWindowId: null,
      sessions: [],
      latestSessionContext: {
        result: {
          repoPath: '/repo/cranberri',
          session: {
            id: 'thread-1',
            title: 'Session context',
            preview: 'Session preview',
            cwd: '/repo/cranberri',
            createdAt: 1,
            updatedAt: 2,
            archived: false,
            turnCount: 1,
          },
        },
        thread: {
          id: 'thread-1',
          title: 'Session context',
          preview: 'Session preview',
          cwd: '/repo/cranberri',
          createdAt: 1,
          updatedAt: 2,
          archived: false,
          turnCount: 1,
          turns: [],
        },
      },
      openChat: vi.fn(),
      openTerminal: vi.fn(),
      openBrowser: vi.fn(),
      openSettings: vi.fn(),
      openSession: vi.fn(),
      sendLatestSessionContextToChat: vi.fn(),
      setActiveRepo: vi.fn(),
      setActiveWindow: vi.fn(),
    })

    expect(actions.find((action) => action.id === 'context:session:latest')?.disabledReason).toBe('Open a chat first')
  })

  it('builds latest browser page snapshot reuse actions', () => {
    const sendLatestBrowserSnapshotToChat = vi.fn()
    const copyLatestBrowserSnapshot = vi.fn()
    const latestBrowserSnapshot = {
      windowId: 'browser-1',
      url: 'http://localhost:5173/',
      title: 'Preview',
      viewport: { width: 1440, height: 900 },
      text: 'Smoke Browser Page\ncranberri-browser-smoke-ready',
    }
    const actions = buildAppActions({
      repos: [],
      activeRepoId: 'repo-1',
      windows: [{ id: 'chat-1', type: 'chat', title: 'Chat' }],
      activeWindowId: 'chat-1',
      activeThread: {
        id: 'thread-1',
        title: 'Smoke thread',
        repoId: 'repo-1',
        messages: [],
        pendingApprovals: [],
        isRunning: false,
      },
      sessions: [],
      latestBrowserSnapshot,
      openChat: vi.fn(),
      openTerminal: vi.fn(),
      openBrowser: vi.fn(),
      openSettings: vi.fn(),
      openSession: vi.fn(),
      sendLatestBrowserSnapshotToChat,
      copyLatestBrowserSnapshot,
      setActiveRepo: vi.fn(),
      setActiveWindow: vi.fn(),
    })

    expect(actions.find((action) => action.id === 'context:browser-page:latest')).toMatchObject({
      label: 'Send latest browser page context to chat',
      description: 'Send saved page context from Preview',
      disabledReason: undefined,
    })
    expect(actions.find((action) => action.id === 'browser:page:latest:copy')).toMatchObject({
      label: 'Copy latest browser page context',
      disabledReason: undefined,
    })
    expect(filterAppActions(actions, 'send latest browser page context').map((action) => action.id)).toContain('context:browser-page:latest')
    expect(filterAppActions(actions, 'copy latest browser visible text').map((action) => action.id)).toContain('browser:page:latest:copy')

    actions.find((action) => action.id === 'context:browser-page:latest')?.run()
    actions.find((action) => action.id === 'browser:page:latest:copy')?.run()

    expect(sendLatestBrowserSnapshotToChat).toHaveBeenCalledWith(latestBrowserSnapshot)
    expect(copyLatestBrowserSnapshot).toHaveBeenCalledWith(latestBrowserSnapshot)
  })

  it('disables latest browser page snapshot reuse actions until page context is captured', () => {
    const actions = buildAppActions({
      repos: [],
      activeRepoId: 'repo-1',
      windows: [{ id: 'chat-1', type: 'chat', title: 'Chat' }],
      activeWindowId: 'chat-1',
      activeThread: {
        id: 'thread-1',
        title: 'Smoke thread',
        repoId: 'repo-1',
        messages: [],
        pendingApprovals: [],
        isRunning: false,
      },
      sessions: [],
      openChat: vi.fn(),
      openTerminal: vi.fn(),
      openBrowser: vi.fn(),
      openSettings: vi.fn(),
      openSession: vi.fn(),
      sendLatestBrowserSnapshotToChat: vi.fn(),
      copyLatestBrowserSnapshot: vi.fn(),
      setActiveRepo: vi.fn(),
      setActiveWindow: vi.fn(),
    })

    expect(actions.find((action) => action.id === 'context:browser-page:latest')?.disabledReason).toBe('Capture browser page context first')
    expect(actions.find((action) => action.id === 'browser:page:latest:copy')?.disabledReason).toBe('Capture browser page context first')
  })

  it('disables sending the latest browser page snapshot when no chat is active', () => {
    const actions = buildAppActions({
      repos: [],
      activeRepoId: 'repo-1',
      windows: [{ id: 'browser-1', type: 'browser', title: 'Preview' }],
      activeWindowId: 'browser-1',
      sessions: [],
      latestBrowserSnapshot: {
        windowId: 'browser-1',
        url: 'http://localhost:5173/',
        title: 'Preview',
        viewport: { width: 1440, height: 900 },
        text: 'Smoke Browser Page',
      },
      openChat: vi.fn(),
      openTerminal: vi.fn(),
      openBrowser: vi.fn(),
      openSettings: vi.fn(),
      openSession: vi.fn(),
      sendLatestBrowserSnapshotToChat: vi.fn(),
      setActiveRepo: vi.fn(),
      setActiveWindow: vi.fn(),
    })

    expect(actions.find((action) => action.id === 'context:browser-page:latest')?.disabledReason).toBe('Open a chat first')
  })

  it('builds latest browser inspected-element reuse actions', () => {
    const sendLatestBrowserInspectionToChat = vi.fn()
    const copyLatestBrowserInspection = vi.fn()
    const latestBrowserInspection = {
      windowId: 'browser-1',
      url: 'http://localhost:5173/',
      title: 'Preview',
      selector: 'main h1',
      tagName: 'h1',
      text: 'Smoke Browser Page',
      rect: { x: 0, y: 0, width: 320, height: 40 },
      styles: {
        display: 'block',
        fontFamily: 'Inter',
        fontSize: '24px',
        fontWeight: '700',
        color: 'rgb(255, 255, 255)',
        backgroundColor: 'rgba(0, 0, 0, 0)',
        margin: '0px',
        padding: '0px',
        borderRadius: '0px',
      },
      attributes: { id: 'hero' },
    }
    const actions = buildAppActions({
      repos: [],
      activeRepoId: 'repo-1',
      windows: [{ id: 'chat-1', type: 'chat', title: 'Chat' }],
      activeWindowId: 'chat-1',
      activeThread: {
        id: 'thread-1',
        title: 'Smoke thread',
        repoId: 'repo-1',
        messages: [],
        pendingApprovals: [],
        isRunning: false,
      },
      sessions: [],
      latestBrowserInspection,
      openChat: vi.fn(),
      openTerminal: vi.fn(),
      openBrowser: vi.fn(),
      openSettings: vi.fn(),
      openSession: vi.fn(),
      sendLatestBrowserInspectionToChat,
      copyLatestBrowserInspection,
      setActiveRepo: vi.fn(),
      setActiveWindow: vi.fn(),
    })

    expect(actions.find((action) => action.id === 'context:browser-inspection:latest')).toMatchObject({
      label: 'Send latest browser element context to chat',
      description: 'Send inspected main h1 element from Preview',
      disabledReason: undefined,
    })
    expect(actions.find((action) => action.id === 'browser:inspection:latest:copy')).toMatchObject({
      label: 'Copy latest browser element context',
      disabledReason: undefined,
    })
    expect(filterAppActions(actions, 'send latest browser element context').map((action) => action.id)).toContain('context:browser-inspection:latest')
    expect(filterAppActions(actions, 'copy inspected browser element styles').map((action) => action.id)).toContain('browser:inspection:latest:copy')

    actions.find((action) => action.id === 'context:browser-inspection:latest')?.run()
    actions.find((action) => action.id === 'browser:inspection:latest:copy')?.run()

    expect(sendLatestBrowserInspectionToChat).toHaveBeenCalledWith(latestBrowserInspection)
    expect(copyLatestBrowserInspection).toHaveBeenCalledWith(latestBrowserInspection)
  })

  it('disables latest browser inspected-element reuse actions until an element is inspected', () => {
    const actions = buildAppActions({
      repos: [],
      activeRepoId: 'repo-1',
      windows: [{ id: 'chat-1', type: 'chat', title: 'Chat' }],
      activeWindowId: 'chat-1',
      activeThread: {
        id: 'thread-1',
        title: 'Smoke thread',
        repoId: 'repo-1',
        messages: [],
        pendingApprovals: [],
        isRunning: false,
      },
      sessions: [],
      openChat: vi.fn(),
      openTerminal: vi.fn(),
      openBrowser: vi.fn(),
      openSettings: vi.fn(),
      openSession: vi.fn(),
      sendLatestBrowserInspectionToChat: vi.fn(),
      copyLatestBrowserInspection: vi.fn(),
      setActiveRepo: vi.fn(),
      setActiveWindow: vi.fn(),
    })

    expect(actions.find((action) => action.id === 'context:browser-inspection:latest')?.disabledReason).toBe('Inspect a browser element first')
    expect(actions.find((action) => action.id === 'browser:inspection:latest:copy')?.disabledReason).toBe('Inspect a browser element first')
  })

  it('disables sending the latest browser inspected element when no chat is active', () => {
    const actions = buildAppActions({
      repos: [],
      activeRepoId: 'repo-1',
      windows: [{ id: 'browser-1', type: 'browser', title: 'Preview' }],
      activeWindowId: 'browser-1',
      sessions: [],
      latestBrowserInspection: {
        windowId: 'browser-1',
        url: 'http://localhost:5173/',
        title: 'Preview',
        selector: 'main h1',
        tagName: 'h1',
        text: 'Smoke Browser Page',
        rect: { x: 0, y: 0, width: 320, height: 40 },
        styles: {
          display: 'block',
          fontFamily: 'Inter',
          fontSize: '24px',
          fontWeight: '700',
          color: 'rgb(255, 255, 255)',
          backgroundColor: 'rgba(0, 0, 0, 0)',
          margin: '0px',
          padding: '0px',
          borderRadius: '0px',
        },
        attributes: { id: 'hero' },
      },
      openChat: vi.fn(),
      openTerminal: vi.fn(),
      openBrowser: vi.fn(),
      openSettings: vi.fn(),
      openSession: vi.fn(),
      sendLatestBrowserInspectionToChat: vi.fn(),
      setActiveRepo: vi.fn(),
      setActiveWindow: vi.fn(),
    })

    expect(actions.find((action) => action.id === 'context:browser-inspection:latest')?.disabledReason).toBe('Open a chat first')
  })

  it('builds latest browser screenshot native handoff actions', () => {
    const openLatestBrowserScreenshot = vi.fn()
    const revealLatestBrowserScreenshot = vi.fn()
    const copyLatestBrowserScreenshotPath = vi.fn()
    const sendLatestBrowserScreenshotToChat = vi.fn()
    const screenshotPath = '/tmp/cranberri-browser-captures/browser-1.png'
    const latestBrowserScreenshot = {
      screenshot: {
        windowId: 'browser-1',
        dataUrl: 'data:image/png;base64,abc',
        width: 1440,
        height: 900,
        path: screenshotPath,
      },
      pageState: {
        title: 'Preview',
        url: 'http://localhost:5173/',
      },
    }
    const actions = buildAppActions({
      repos: [],
      activeRepoId: 'repo-1',
      windows: [{ id: 'browser-1', type: 'browser', title: 'Preview' }],
      activeWindowId: 'browser-1',
      activeThread: {
        id: 'thread-1',
        title: 'Smoke thread',
        repoId: 'repo-1',
        messages: [],
        pendingApprovals: [],
        isRunning: false,
      },
      sessions: [],
      latestBrowserScreenshot,
      openChat: vi.fn(),
      openTerminal: vi.fn(),
      openBrowser: vi.fn(),
      openSettings: vi.fn(),
      openSession: vi.fn(),
      openLatestBrowserScreenshot,
      revealLatestBrowserScreenshot,
      copyLatestBrowserScreenshotPath,
      sendLatestBrowserScreenshotToChat,
      setActiveRepo: vi.fn(),
      setActiveWindow: vi.fn(),
    })

    expect(actions.find((action) => action.id === 'context:browser-screenshot:latest')).toMatchObject({
      label: 'Send latest browser screenshot to chat',
      disabledReason: undefined,
    })
    expect(actions.find((action) => action.id === 'browser:screenshot:latest:open')).toMatchObject({
      label: 'Open latest browser screenshot',
      disabledReason: undefined,
    })
    expect(actions.find((action) => action.id === 'browser:screenshot:latest:reveal')).toMatchObject({
      label: 'Reveal latest browser screenshot in Finder',
      disabledReason: undefined,
    })
    expect(actions.find((action) => action.id === 'browser:screenshot:latest:copy-path')).toMatchObject({
      label: 'Copy latest browser screenshot path',
      disabledReason: undefined,
    })
    expect(filterAppActions(actions, 'send latest browser screenshot chat').map((action) => action.id)).toContain('context:browser-screenshot:latest')
    expect(filterAppActions(actions, 'copy browser screenshot path').map((action) => action.id)).toContain('browser:screenshot:latest:copy-path')

    actions.find((action) => action.id === 'context:browser-screenshot:latest')?.run()
    actions.find((action) => action.id === 'browser:screenshot:latest:open')?.run()
    actions.find((action) => action.id === 'browser:screenshot:latest:reveal')?.run()
    actions.find((action) => action.id === 'browser:screenshot:latest:copy-path')?.run()

    expect(sendLatestBrowserScreenshotToChat).toHaveBeenCalledWith(latestBrowserScreenshot)
    expect(openLatestBrowserScreenshot).toHaveBeenCalledWith(screenshotPath)
    expect(revealLatestBrowserScreenshot).toHaveBeenCalledWith(screenshotPath)
    expect(copyLatestBrowserScreenshotPath).toHaveBeenCalledWith(screenshotPath)
  })

  it('disables latest browser screenshot handoff actions before a screenshot is captured', () => {
    const actions = buildAppActions({
      repos: [],
      activeRepoId: 'repo-1',
      windows: [{ id: 'browser-1', type: 'browser', title: 'Preview' }],
      activeWindowId: 'browser-1',
      sessions: [],
      openChat: vi.fn(),
      openTerminal: vi.fn(),
      openBrowser: vi.fn(),
      openSettings: vi.fn(),
      openSession: vi.fn(),
      openLatestBrowserScreenshot: vi.fn(),
      revealLatestBrowserScreenshot: vi.fn(),
      copyLatestBrowserScreenshotPath: vi.fn(),
      sendLatestBrowserScreenshotToChat: vi.fn(),
      setActiveRepo: vi.fn(),
      setActiveWindow: vi.fn(),
    })

    expect(actions.find((action) => action.id === 'context:browser-screenshot:latest')?.disabledReason).toBe('Capture a browser screenshot first')
    expect(actions.find((action) => action.id === 'browser:screenshot:latest:open')?.disabledReason).toBe('Capture a browser screenshot first')
    expect(actions.find((action) => action.id === 'browser:screenshot:latest:reveal')?.disabledReason).toBe('Capture a browser screenshot first')
    expect(actions.find((action) => action.id === 'browser:screenshot:latest:copy-path')?.disabledReason).toBe('Capture a browser screenshot first')
  })

  it('disables sending the latest browser screenshot when no chat is active', () => {
    const actions = buildAppActions({
      repos: [],
      activeRepoId: 'repo-1',
      windows: [{ id: 'browser-1', type: 'browser', title: 'Preview' }],
      activeWindowId: 'browser-1',
      sessions: [],
      latestBrowserScreenshot: {
        screenshot: {
          windowId: 'browser-1',
          dataUrl: 'data:image/png;base64,abc',
          width: 1440,
          height: 900,
          path: '/tmp/cranberri-browser-captures/browser-1.png',
        },
        pageState: {
          title: 'Preview',
          url: 'http://localhost:5173/',
        },
      },
      openChat: vi.fn(),
      openTerminal: vi.fn(),
      openBrowser: vi.fn(),
      openSettings: vi.fn(),
      openSession: vi.fn(),
      sendLatestBrowserScreenshotToChat: vi.fn(),
      setActiveRepo: vi.fn(),
      setActiveWindow: vi.fn(),
    })

    expect(actions.find((action) => action.id === 'context:browser-screenshot:latest')?.disabledReason).toBe('Open a chat first')
  })

  it('builds active terminal control actions for the focused terminal window', () => {
    const controlActiveTerminal = vi.fn()
    const actions = buildAppActions({
      repos: [],
      activeRepoId: 'repo-1',
      windows: [
        { id: 'chat-1', type: 'chat', title: 'Chat' },
        { id: 'term-1', type: 'terminal', title: 'Terminal' },
      ],
      activeWindowId: 'term-1',
      sessions: [],
      openChat: vi.fn(),
      openTerminal: vi.fn(),
      openBrowser: vi.fn(),
      openSettings: vi.fn(),
      openSession: vi.fn(),
      controlActiveTerminal,
      setActiveRepo: vi.fn(),
      setActiveWindow: vi.fn(),
    })

    expect(actions.filter((action) => action.id.startsWith('terminal:active:')).map((action) => action.id)).toEqual([
      'terminal:active:search',
      'terminal:active:search-next',
      'terminal:active:search-previous',
      'terminal:active:search-close',
      'terminal:active:copy-buffer',
      'terminal:active:clear',
    ])
    expect(filterAppActions(actions, 'find next terminal').map((action) => action.id)).toContain('terminal:active:search-next')
    expect(filterAppActions(actions, 'find previous terminal').map((action) => action.id)).toContain('terminal:active:search-previous')
    expect(filterAppActions(actions, 'close terminal search').map((action) => action.id)).toContain('terminal:active:search-close')
    expect(filterAppActions(actions, 'copy terminal buffer').map((action) => action.id)).toContain('terminal:active:copy-buffer')
    expect(filterAppActions(actions, 'clear active terminal').map((action) => action.id)).toContain('terminal:active:clear')

    actions.find((action) => action.id === 'terminal:active:search')?.run()
    actions.find((action) => action.id === 'terminal:active:search-next')?.run()
    actions.find((action) => action.id === 'terminal:active:search-previous')?.run()
    actions.find((action) => action.id === 'terminal:active:search-close')?.run()
    actions.find((action) => action.id === 'terminal:active:copy-buffer')?.run()
    actions.find((action) => action.id === 'terminal:active:clear')?.run()

    expect(controlActiveTerminal).toHaveBeenCalledWith('term-1', 'search')
    expect(controlActiveTerminal).toHaveBeenCalledWith('term-1', 'search-next')
    expect(controlActiveTerminal).toHaveBeenCalledWith('term-1', 'search-previous')
    expect(controlActiveTerminal).toHaveBeenCalledWith('term-1', 'search-close')
    expect(controlActiveTerminal).toHaveBeenCalledWith('term-1', 'copy-buffer')
    expect(controlActiveTerminal).toHaveBeenCalledWith('term-1', 'clear')
  })

  it('disables active terminal controls when the active window is not a terminal', () => {
    const actions = buildAppActions({
      repos: [],
      activeRepoId: 'repo-1',
      windows: [{ id: 'browser-1', type: 'browser', title: 'Preview' }],
      activeWindowId: 'browser-1',
      sessions: [],
      openChat: vi.fn(),
      openTerminal: vi.fn(),
      openBrowser: vi.fn(),
      openSettings: vi.fn(),
      openSession: vi.fn(),
      controlActiveTerminal: vi.fn(),
      setActiveRepo: vi.fn(),
      setActiveWindow: vi.fn(),
    })

    expect(actions.find((action) => action.id === 'terminal:active:search')).toMatchObject({
      label: 'Search active terminal',
      disabledReason: 'Focus a terminal window first',
    })
  })

  it('builds workspace brief context action', () => {
    const sendWorkspaceBrief = vi.fn()
    const copyWorkspaceBrief = vi.fn()
    const actions = buildAppActions({
      repos: [],
      activeRepoId: 'repo-1',
      windows: [],
      activeWindowId: null,
      sessions: [],
      openChat: vi.fn(),
      openTerminal: vi.fn(),
      openBrowser: vi.fn(),
      openSettings: vi.fn(),
      openSession: vi.fn(),
      sendWorkspaceBrief,
      copyWorkspaceBrief,
      setActiveRepo: vi.fn(),
      setActiveWindow: vi.fn(),
    })

    expect(actions.find((action) => action.id === 'context:workspace-brief')).toMatchObject({
      group: 'workspace',
      icon: 'chat',
      label: 'Send workspace brief',
      disabledReason: undefined,
    })
    expect(actions.find((action) => action.id === 'context:workspace-brief:copy')).toMatchObject({
      group: 'workspace',
      icon: 'chat',
      label: 'Copy workspace brief',
      disabledReason: undefined,
    })
    expect(filterAppActions(actions, 'workspace github processes context').map((action) => action.id)).toContain('context:workspace-brief')
    expect(filterAppActions(actions, 'copy workspace github processes context').map((action) => action.id)).toContain('context:workspace-brief:copy')

    actions.find((action) => action.id === 'context:workspace-brief')?.run()
    actions.find((action) => action.id === 'context:workspace-brief:copy')?.run()

    expect(sendWorkspaceBrief).toHaveBeenCalled()
    expect(copyWorkspaceBrief).toHaveBeenCalled()
  })

  it('builds latest app context reuse actions', () => {
    const sendLatestAppContextToChat = vi.fn()
    const copyLatestAppContext = vi.fn()
    const latestAppContext = {
      kind: 'workspace-brief' as const,
      label: 'Cranberri',
      text: 'Workspace brief:\nGitHub: fraction12/Cranberri\nSelected right rail file: README.md (tracked)',
    }
    const actions = buildAppActions({
      repos: [],
      activeRepoId: 'repo-1',
      windows: [{ id: 'chat-1', type: 'chat', title: 'Chat' }],
      activeWindowId: 'chat-1',
      activeThread: {
        id: 'thread-1',
        title: 'Smoke thread',
        repoId: 'repo-1',
        messages: [],
        pendingApprovals: [],
        isRunning: false,
      },
      sessions: [],
      latestAppContext,
      openChat: vi.fn(),
      openTerminal: vi.fn(),
      openBrowser: vi.fn(),
      openSettings: vi.fn(),
      openSession: vi.fn(),
      sendLatestAppContextToChat,
      copyLatestAppContext,
      setActiveRepo: vi.fn(),
      setActiveWindow: vi.fn(),
    })

    expect(actions.find((action) => action.id === 'context:app:latest')).toMatchObject({
      label: 'Send latest app context to chat',
      description: 'Send saved Cranberri context',
      disabledReason: undefined,
    })
    expect(actions.find((action) => action.id === 'app:latest:copy')).toMatchObject({
      label: 'Copy latest app context',
      disabledReason: undefined,
    })
    expect(filterAppActions(actions, 'send latest workspace cranberri').map((action) => action.id)).toContain('context:app:latest')
    expect(filterAppActions(actions, 'copy latest selected right rail').map((action) => action.id)).toContain('app:latest:copy')

    actions.find((action) => action.id === 'context:app:latest')?.run()
    actions.find((action) => action.id === 'app:latest:copy')?.run()

    expect(sendLatestAppContextToChat).toHaveBeenCalledWith(latestAppContext)
    expect(copyLatestAppContext).toHaveBeenCalledWith(latestAppContext)
  })

  it('disables latest app context reuse actions until app context is sent', () => {
    const actions = buildAppActions({
      repos: [],
      activeRepoId: 'repo-1',
      windows: [{ id: 'chat-1', type: 'chat', title: 'Chat' }],
      activeWindowId: 'chat-1',
      activeThread: {
        id: 'thread-1',
        title: 'Smoke thread',
        repoId: 'repo-1',
        messages: [],
        pendingApprovals: [],
        isRunning: false,
      },
      sessions: [],
      openChat: vi.fn(),
      openTerminal: vi.fn(),
      openBrowser: vi.fn(),
      openSettings: vi.fn(),
      openSession: vi.fn(),
      sendLatestAppContextToChat: vi.fn(),
      copyLatestAppContext: vi.fn(),
      setActiveRepo: vi.fn(),
      setActiveWindow: vi.fn(),
    })

    expect(actions.find((action) => action.id === 'context:app:latest')?.disabledReason).toBe('Send an app context first')
    expect(actions.find((action) => action.id === 'app:latest:copy')?.disabledReason).toBe('Send an app context first')
  })

  it('disables sending latest app context when no chat is active', () => {
    const actions = buildAppActions({
      repos: [],
      activeRepoId: 'repo-1',
      windows: [],
      activeWindowId: null,
      sessions: [],
      latestAppContext: {
        kind: 'usage',
        label: 'Codex usage',
        text: 'Codex usage context:\nCurrent limit:',
      },
      openChat: vi.fn(),
      openTerminal: vi.fn(),
      openBrowser: vi.fn(),
      openSettings: vi.fn(),
      openSession: vi.fn(),
      sendLatestAppContextToChat: vi.fn(),
      setActiveRepo: vi.fn(),
      setActiveWindow: vi.fn(),
    })

    expect(actions.find((action) => action.id === 'context:app:latest')?.disabledReason).toBe('Open a chat first')
  })

  it('builds active browser control actions for the focused browser window', () => {
    const controlActiveBrowser = vi.fn()
    const actions = buildAppActions({
      repos: [],
      activeRepoId: 'repo-1',
      windows: [
        { id: 'term-1', type: 'terminal', title: 'Terminal' },
        { id: 'browser-1', type: 'browser', title: 'Preview' },
      ],
      activeWindowId: 'browser-1',
      sessions: [],
      openChat: vi.fn(),
      openTerminal: vi.fn(),
      openBrowser: vi.fn(),
      openSettings: vi.fn(),
      openSession: vi.fn(),
      controlActiveBrowser,
      setActiveRepo: vi.fn(),
      setActiveWindow: vi.fn(),
    })

    expect(actions.filter((action) => action.id.startsWith('browser:active:')).map((action) => action.id)).toEqual([
      'browser:active:reload',
      'browser:active:back',
      'browser:active:forward',
      'browser:active:stop',
      'browser:active:inspect-start',
      'browser:active:inspect-stop',
      'browser:active:open-external',
      'browser:active:copy-url',
      'browser:active:copy-page-context',
    ])
    expect(filterAppActions(actions, 'reload active browser').map((action) => action.id)).toContain('browser:active:reload')
    expect(filterAppActions(actions, 'inspect active browser element').map((action) => action.id)).toContain('browser:active:inspect-start')
    expect(filterAppActions(actions, 'stop browser inspection').map((action) => action.id)).toContain('browser:active:inspect-stop')
    expect(filterAppActions(actions, 'open active browser external').map((action) => action.id)).toContain('browser:active:open-external')
    expect(filterAppActions(actions, 'copy browser url').map((action) => action.id)).toContain('browser:active:copy-url')
    expect(filterAppActions(actions, 'copy browser page context').map((action) => action.id)).toContain('browser:active:copy-page-context')

    actions.find((action) => action.id === 'browser:active:reload')?.run()
    actions.find((action) => action.id === 'browser:active:back')?.run()
    actions.find((action) => action.id === 'browser:active:forward')?.run()
    actions.find((action) => action.id === 'browser:active:stop')?.run()
    actions.find((action) => action.id === 'browser:active:inspect-start')?.run()
    actions.find((action) => action.id === 'browser:active:inspect-stop')?.run()
    actions.find((action) => action.id === 'browser:active:open-external')?.run()
    actions.find((action) => action.id === 'browser:active:copy-url')?.run()
    actions.find((action) => action.id === 'browser:active:copy-page-context')?.run()

    expect(controlActiveBrowser).toHaveBeenCalledWith('browser-1', 'reload')
    expect(controlActiveBrowser).toHaveBeenCalledWith('browser-1', 'back')
    expect(controlActiveBrowser).toHaveBeenCalledWith('browser-1', 'forward')
    expect(controlActiveBrowser).toHaveBeenCalledWith('browser-1', 'stop')
    expect(controlActiveBrowser).toHaveBeenCalledWith('browser-1', 'inspect-start')
    expect(controlActiveBrowser).toHaveBeenCalledWith('browser-1', 'inspect-stop')
    expect(controlActiveBrowser).toHaveBeenCalledWith('browser-1', 'open-external')
    expect(controlActiveBrowser).toHaveBeenCalledWith('browser-1', 'copy-url')
    expect(controlActiveBrowser).toHaveBeenCalledWith('browser-1', 'copy-page-context')
  })

  it('builds active browser viewport actions for the focused browser window', () => {
    const setActiveBrowserViewport = vi.fn()
    const actions = buildAppActions({
      repos: [],
      activeRepoId: 'repo-1',
      windows: [
        { id: 'browser-1', type: 'browser', title: 'Preview', browser: { url: 'http://localhost:5173', profileId: 'repo-1', viewportMode: 'desktop' } },
      ],
      activeWindowId: 'browser-1',
      sessions: [],
      openChat: vi.fn(),
      openTerminal: vi.fn(),
      openBrowser: vi.fn(),
      openSettings: vi.fn(),
      openSession: vi.fn(),
      setActiveBrowserViewport,
      setActiveRepo: vi.fn(),
      setActiveWindow: vi.fn(),
    })

    expect(actions.filter((action) => action.id.startsWith('browser:active:viewport:')).map((action) => action.id)).toEqual([
      'browser:active:viewport:responsive',
      'browser:active:viewport:mobile',
      'browser:active:viewport:tablet',
      'browser:active:viewport:desktop',
    ])
    expect(actions.find((action) => action.id === 'browser:active:viewport:desktop')).toMatchObject({
      label: 'Desktop browser viewport',
      description: 'Keep Preview in desktop viewport',
      disabledReason: undefined,
    })
    expect(filterAppActions(actions, 'mobile phone viewport').map((action) => action.id)).toContain('browser:active:viewport:mobile')
    expect(filterAppActions(actions, 'responsive active browser').map((action) => action.id)).toContain('browser:active:viewport:responsive')

    actions.find((action) => action.id === 'browser:active:viewport:responsive')?.run()
    actions.find((action) => action.id === 'browser:active:viewport:mobile')?.run()
    actions.find((action) => action.id === 'browser:active:viewport:tablet')?.run()
    actions.find((action) => action.id === 'browser:active:viewport:desktop')?.run()

    expect(setActiveBrowserViewport).toHaveBeenCalledWith('browser-1', 'responsive')
    expect(setActiveBrowserViewport).toHaveBeenCalledWith('browser-1', 'mobile')
    expect(setActiveBrowserViewport).toHaveBeenCalledWith('browser-1', 'tablet')
    expect(setActiveBrowserViewport).toHaveBeenCalledWith('browser-1', 'desktop')
  })

  it('builds repo changes context actions', () => {
    const sendRepoChangesContext = vi.fn()
    const copyRepoChangesContext = vi.fn()
    const reviewRepoChangesContext = vi.fn()
    const explainRepoChangesContext = vi.fn()
    const testRepoChangesContext = vi.fn()
    const draftPullRequestContext = vi.fn()
    const actions = buildAppActions({
      repos: [],
      activeRepoId: 'repo-1',
      windows: [{ id: 'chat-1', type: 'chat', title: 'Chat' }],
      activeWindowId: 'chat-1',
      activeThread: {
        id: 'thread-1',
        title: 'Smoke thread',
        repoId: 'repo-1',
        messages: [],
        pendingApprovals: [],
        isRunning: false,
      },
      sessions: [],
      openChat: vi.fn(),
      openTerminal: vi.fn(),
      openBrowser: vi.fn(),
      openSettings: vi.fn(),
      openSession: vi.fn(),
      sendRepoChangesContext,
      copyRepoChangesContext,
      reviewRepoChangesContext,
      explainRepoChangesContext,
      testRepoChangesContext,
      draftPullRequestContext,
      setActiveRepo: vi.fn(),
      setActiveWindow: vi.fn(),
    })

    expect(actions.find((action) => action.id === 'context:repo-status')).toMatchObject({
      group: 'files',
      icon: 'chat',
      label: 'Send git status context',
      disabledReason: undefined,
    })
    expect(actions.find((action) => action.id === 'context:repo-status:copy')).toMatchObject({
      group: 'files',
      icon: 'file',
      label: 'Copy git status context',
      disabledReason: undefined,
    })
    expect(actions.find((action) => action.id === 'context:repo-diff')).toMatchObject({
      group: 'files',
      icon: 'diff',
      label: 'Send repo diff context',
      disabledReason: undefined,
    })
    expect(actions.find((action) => action.id === 'context:repo-diff:copy')).toMatchObject({
      group: 'files',
      icon: 'diff',
      label: 'Copy repo diff context',
      disabledReason: undefined,
    })
    expect(actions.find((action) => action.id === 'context:repo-diff:review')).toMatchObject({
      group: 'files',
      icon: 'chat',
      label: 'Review repo changes',
      disabledReason: undefined,
    })
    expect(actions.find((action) => action.id === 'context:repo-diff:explain')).toMatchObject({
      group: 'files',
      icon: 'chat',
      label: 'Explain repo changes',
      disabledReason: undefined,
    })
    expect(actions.find((action) => action.id === 'context:repo-diff:test')).toMatchObject({
      group: 'files',
      icon: 'chat',
      label: 'Write tests for repo changes',
      disabledReason: undefined,
    })
    expect(actions.find((action) => action.id === 'context:repo-diff:pr-description')).toMatchObject({
      group: 'files',
      icon: 'chat',
      label: 'Draft PR description from repo changes',
      disabledReason: undefined,
    })
    expect(filterAppActions(actions, 'repo diff context').map((action) => action.id)).toContain('context:repo-diff')
    expect(filterAppActions(actions, 'copy repo diff context').map((action) => action.id)).toContain('context:repo-diff:copy')
    expect(filterAppActions(actions, 'review repo changes').map((action) => action.id)).toContain('context:repo-diff:review')
    expect(filterAppActions(actions, 'explain repo changes').map((action) => action.id)).toContain('context:repo-diff:explain')
    expect(filterAppActions(actions, 'write tests for repo changes').map((action) => action.id)).toContain('context:repo-diff:test')
    expect(filterAppActions(actions, 'draft pr description').map((action) => action.id)).toContain('context:repo-diff:pr-description')

    actions.find((action) => action.id === 'context:repo-status')?.run()
    actions.find((action) => action.id === 'context:repo-status:copy')?.run()
    actions.find((action) => action.id === 'context:repo-diff')?.run()
    actions.find((action) => action.id === 'context:repo-diff:copy')?.run()
    actions.find((action) => action.id === 'context:repo-diff:review')?.run()
    actions.find((action) => action.id === 'context:repo-diff:explain')?.run()
    actions.find((action) => action.id === 'context:repo-diff:test')?.run()
    actions.find((action) => action.id === 'context:repo-diff:pr-description')?.run()

    expect(sendRepoChangesContext).toHaveBeenCalledWith('status')
    expect(sendRepoChangesContext).toHaveBeenCalledWith('diff')
    expect(copyRepoChangesContext).toHaveBeenCalledWith('status')
    expect(copyRepoChangesContext).toHaveBeenCalledWith('diff')
    expect(reviewRepoChangesContext).toHaveBeenCalled()
    expect(explainRepoChangesContext).toHaveBeenCalled()
    expect(testRepoChangesContext).toHaveBeenCalled()
    expect(draftPullRequestContext).toHaveBeenCalled()
  })

  it('disables repo changes agent prompts when no chat is active', () => {
    const actions = buildAppActions({
      repos: [],
      activeRepoId: 'repo-1',
      windows: [],
      activeWindowId: null,
      sessions: [],
      openChat: vi.fn(),
      openTerminal: vi.fn(),
      openBrowser: vi.fn(),
      openSettings: vi.fn(),
      openSession: vi.fn(),
      reviewRepoChangesContext: vi.fn(),
      explainRepoChangesContext: vi.fn(),
      testRepoChangesContext: vi.fn(),
      draftPullRequestContext: vi.fn(),
      setActiveRepo: vi.fn(),
      setActiveWindow: vi.fn(),
    })

    expect(actions.find((action) => action.id === 'context:repo-diff:review')).toMatchObject({
      disabledReason: 'Open a chat first',
    })
    expect(actions.find((action) => action.id === 'context:repo-diff:explain')).toMatchObject({
      disabledReason: 'Open a chat first',
    })
    expect(actions.find((action) => action.id === 'context:repo-diff:test')).toMatchObject({
      disabledReason: 'Open a chat first',
    })
    expect(actions.find((action) => action.id === 'context:repo-diff:pr-description')).toMatchObject({
      disabledReason: 'Open a chat first',
    })
  })

  it('builds GitHub context actions', () => {
    const sendGitHubContext = vi.fn()
    const copyGitHubContext = vi.fn()
    const actions = buildAppActions({
      repos: [],
      activeRepoId: 'repo-1',
      windows: [],
      activeWindowId: null,
      sessions: [],
      openChat: vi.fn(),
      openTerminal: vi.fn(),
      openBrowser: vi.fn(),
      openSettings: vi.fn(),
      openSession: vi.fn(),
      sendGitHubContext,
      copyGitHubContext,
      setActiveRepo: vi.fn(),
      setActiveWindow: vi.fn(),
    })

    expect(actions.filter((action) => action.id.startsWith('context:github:')).map((action) => action.id)).toEqual([
      'context:github:repo',
      'context:github:repo:copy',
      'context:github:pulls',
      'context:github:pulls:copy',
      'context:github:issues',
      'context:github:issues:copy',
      'context:github:actions',
      'context:github:actions:copy',
      'context:github:branches',
      'context:github:branches:copy',
      'context:github:commits',
      'context:github:commits:copy',
      'context:github:releases',
      'context:github:releases:copy',
    ])
    expect(actions.find((action) => action.id === 'context:github:branches:copy')).toMatchObject({
      group: 'rail',
      icon: 'github',
      label: 'Copy GitHub branch context',
      description: 'Copy repository branch context',
      disabledReason: undefined,
    })
    expect(filterAppActions(actions, 'github pr context').map((action) => action.id)).toContain('context:github:pulls')
    expect(filterAppActions(actions, 'copy github pr context').map((action) => action.id)).toContain('context:github:pulls:copy')
    expect(filterAppActions(actions, 'github branch context').map((action) => action.id)).toContain('context:github:branches')
    expect(filterAppActions(actions, 'copy github branch context').map((action) => action.id)).toContain('context:github:branches:copy')
    expect(filterAppActions(actions, 'github commit history').map((action) => action.id)).toContain('context:github:commits')
    expect(filterAppActions(actions, 'github release tag').map((action) => action.id)).toContain('context:github:releases')

    actions.find((action) => action.id === 'context:github:repo')?.run()
    actions.find((action) => action.id === 'context:github:repo:copy')?.run()
    actions.find((action) => action.id === 'context:github:actions')?.run()
    actions.find((action) => action.id === 'context:github:actions:copy')?.run()
    actions.find((action) => action.id === 'context:github:branches')?.run()
    actions.find((action) => action.id === 'context:github:branches:copy')?.run()
    actions.find((action) => action.id === 'context:github:commits')?.run()
    actions.find((action) => action.id === 'context:github:commits:copy')?.run()
    actions.find((action) => action.id === 'context:github:releases')?.run()
    actions.find((action) => action.id === 'context:github:releases:copy')?.run()

    expect(sendGitHubContext).toHaveBeenCalledWith('repo')
    expect(sendGitHubContext).toHaveBeenCalledWith('actions')
    expect(sendGitHubContext).toHaveBeenCalledWith('branches')
    expect(sendGitHubContext).toHaveBeenCalledWith('commits')
    expect(sendGitHubContext).toHaveBeenCalledWith('releases')
    expect(copyGitHubContext).toHaveBeenCalledWith('repo')
    expect(copyGitHubContext).toHaveBeenCalledWith('actions')
    expect(copyGitHubContext).toHaveBeenCalledWith('branches')
    expect(copyGitHubContext).toHaveBeenCalledWith('commits')
    expect(copyGitHubContext).toHaveBeenCalledWith('releases')
  })

  it('builds latest GitHub context reuse actions', () => {
    const sendLatestGitHubContextToChat = vi.fn()
    const copyLatestGitHubContext = vi.fn()
    const latestGitHubContext = {
      kind: 'item' as const,
      label: 'smoke/context',
      repoPath: '/repo/cranberri',
      text: 'GitHub item context:\nKind: branches\nTitle: smoke/context\nMetadata:\n- upstream: origin/smoke/context',
    }
    const actions = buildAppActions({
      repos: [],
      activeRepoId: 'repo-1',
      windows: [{ id: 'chat-1', type: 'chat', title: 'Chat' }],
      activeWindowId: 'chat-1',
      activeThread: {
        id: 'thread-1',
        title: 'Smoke thread',
        repoId: 'repo-1',
        messages: [],
        pendingApprovals: [],
        isRunning: false,
      },
      sessions: [],
      latestGitHubContext,
      openChat: vi.fn(),
      openTerminal: vi.fn(),
      openBrowser: vi.fn(),
      openSettings: vi.fn(),
      openSession: vi.fn(),
      sendLatestGitHubContextToChat,
      copyLatestGitHubContext,
      setActiveRepo: vi.fn(),
      setActiveWindow: vi.fn(),
    })

    expect(actions.find((action) => action.id === 'context:github:latest')).toMatchObject({
      label: 'Send latest GitHub context to chat',
      description: 'Send saved GitHub context for smoke/context',
      disabledReason: undefined,
    })
    expect(actions.find((action) => action.id === 'github:latest:copy')).toMatchObject({
      label: 'Copy latest GitHub context',
      disabledReason: undefined,
    })
    expect(filterAppActions(actions, 'send latest github branch smoke').map((action) => action.id)).toContain('context:github:latest')
    expect(filterAppActions(actions, 'copy latest github upstream').map((action) => action.id)).toContain('github:latest:copy')

    actions.find((action) => action.id === 'context:github:latest')?.run()
    actions.find((action) => action.id === 'github:latest:copy')?.run()

    expect(sendLatestGitHubContextToChat).toHaveBeenCalledWith(latestGitHubContext)
    expect(copyLatestGitHubContext).toHaveBeenCalledWith(latestGitHubContext)
  })

  it('disables latest GitHub context reuse actions until GitHub context is sent', () => {
    const actions = buildAppActions({
      repos: [],
      activeRepoId: 'repo-1',
      windows: [{ id: 'chat-1', type: 'chat', title: 'Chat' }],
      activeWindowId: 'chat-1',
      activeThread: {
        id: 'thread-1',
        title: 'Smoke thread',
        repoId: 'repo-1',
        messages: [],
        pendingApprovals: [],
        isRunning: false,
      },
      sessions: [],
      openChat: vi.fn(),
      openTerminal: vi.fn(),
      openBrowser: vi.fn(),
      openSettings: vi.fn(),
      openSession: vi.fn(),
      sendLatestGitHubContextToChat: vi.fn(),
      copyLatestGitHubContext: vi.fn(),
      setActiveRepo: vi.fn(),
      setActiveWindow: vi.fn(),
    })

    expect(actions.find((action) => action.id === 'context:github:latest')?.disabledReason).toBe('Send a GitHub context first')
    expect(actions.find((action) => action.id === 'github:latest:copy')?.disabledReason).toBe('Send a GitHub context first')
  })

  it('disables sending latest GitHub context when no chat is active', () => {
    const actions = buildAppActions({
      repos: [],
      activeRepoId: 'repo-1',
      windows: [],
      activeWindowId: null,
      sessions: [],
      latestGitHubContext: {
        kind: 'panel',
        label: 'branches',
        repoPath: '/repo/cranberri',
        text: 'GitHub context:\nPanel: branches',
      },
      openChat: vi.fn(),
      openTerminal: vi.fn(),
      openBrowser: vi.fn(),
      openSettings: vi.fn(),
      openSession: vi.fn(),
      sendLatestGitHubContextToChat: vi.fn(),
      setActiveRepo: vi.fn(),
      setActiveWindow: vi.fn(),
    })

    expect(actions.find((action) => action.id === 'context:github:latest')?.disabledReason).toBe('Open a chat first')
  })

  it('builds GitHub item context actions for refs, commits, and tags', () => {
    const sendGitHubItemContext = vi.fn()
    const copyGitHubItemContext = vi.fn()
    const actions = buildGitHubItemActions({
      panels: [{
        kind: 'branches',
        source: 'git',
        authenticated: false,
        fetchedAt: 1,
        items: [{
          id: 'local/context',
          title: 'local/context',
          subtitle: 'abc1234',
          state: 'local',
          meta: { upstream: 'origin/local/context' },
        }],
      }, {
        kind: 'commits',
        source: 'git',
        authenticated: false,
        fetchedAt: 1,
        items: [{
          id: 'abcdef123456',
          title: 'Wire GitHub branch context',
          subtitle: 'abcdef123456',
          author: 'Cranberri Test',
          createdAt: '2026-07-08T00:00:00.000Z',
        }],
      }, {
        kind: 'releases',
        source: 'git',
        authenticated: false,
        fetchedAt: 1,
        items: [{
          id: 'v0.1.0',
          title: 'v0.1.0',
          subtitle: 'v0.1.0',
          state: 'tag',
        }],
      }],
      sendGitHubItemContext,
      copyGitHubItemContext,
    })

    expect(actions.map((action) => action.id)).toEqual([
      'context:github:branches:item:local-context',
      'context:github:branches:item:local-context:copy',
      'context:github:commits:item:abcdef123456',
      'context:github:commits:item:abcdef123456:copy',
      'context:github:releases:item:v0.1.0',
      'context:github:releases:item:v0.1.0:copy',
    ])
    expect(actions[0]).toMatchObject({
      group: 'rail',
      icon: 'github',
      label: 'Send GitHub branch context: local/context',
      description: 'local - abc1234 - source: git',
    })
    expect(actions[1]).toMatchObject({
      group: 'rail',
      icon: 'github',
      label: 'Copy GitHub branch context: local/context',
      description: 'local - abc1234 - source: git',
    })
    expect(filterAppActions(actions, 'github branch local context upstream').map((action) => action.id)).toContain('context:github:branches:item:local-context')
    expect(filterAppActions(actions, 'copy github branch local context upstream').map((action) => action.id)).toContain('context:github:branches:item:local-context:copy')
    expect(filterAppActions(actions, 'github commit cranberri test').map((action) => action.id)).toContain('context:github:commits:item:abcdef123456')
    expect(filterAppActions(actions, 'github release tag v0.1.0').map((action) => action.id)).toContain('context:github:releases:item:v0.1.0')

    actions[0].run()
    actions[1].run()
    actions[2].run()
    actions[3].run()
    actions[4].run()
    actions[5].run()

    expect(sendGitHubItemContext).toHaveBeenCalledWith('branches', expect.objectContaining({ title: 'local/context' }))
    expect(sendGitHubItemContext).toHaveBeenCalledWith('commits', expect.objectContaining({ title: 'Wire GitHub branch context' }))
    expect(sendGitHubItemContext).toHaveBeenCalledWith('releases', expect.objectContaining({ title: 'v0.1.0' }))
    expect(copyGitHubItemContext).toHaveBeenCalledWith('branches', expect.objectContaining({ title: 'local/context' }))
    expect(copyGitHubItemContext).toHaveBeenCalledWith('commits', expect.objectContaining({ title: 'Wire GitHub branch context' }))
    expect(copyGitHubItemContext).toHaveBeenCalledWith('releases', expect.objectContaining({ title: 'v0.1.0' }))
  })

  it('builds active Codex thread control actions', () => {
    const compactActiveThread = vi.fn()
    const interruptActiveThread = vi.fn()
    const archiveActiveThread = vi.fn()
    const renameActiveThread = vi.fn()
    const deleteActiveThread = vi.fn()
    const toggleSessionPinned = vi.fn()
    const sendActiveChatContext = vi.fn()
    const exportActiveThreadMarkdown = vi.fn()
    const copyActiveThreadMarkdown = vi.fn()
    const sendLatestAssistantResponseToChat = vi.fn()
    const copyLatestAssistantResponse = vi.fn()
    const sendLatestUserPromptToChat = vi.fn()
    const copyLatestUserPrompt = vi.fn()
    const attachFilesToActiveChat = vi.fn()
    const actions = buildAppActions({
      repos: [],
      activeRepoId: 'repo-1',
      windows: [],
      activeWindowId: null,
      activeThread: {
        id: 'thread-1',
        title: 'Smoke thread',
        repoId: 'repo-1',
        messages: [
          { id: 'message-user-1', role: 'user', content: 'Can you inspect the diff?', timestamp: 1 },
          { id: 'message-assistant-1', role: 'assistant', content: 'Earlier answer', timestamp: 2 },
          { id: 'message-assistant-2', role: 'assistant', content: 'Latest useful answer', timestamp: 3 },
          { id: 'message-assistant-pending', role: 'assistant', content: 'Still streaming', timestamp: 4, pending: true },
        ],
        pendingApprovals: [],
        isRunning: true,
      },
      sessions: [],
      pinnedSessionIds: [],
      openChat: vi.fn(),
      openTerminal: vi.fn(),
      openBrowser: vi.fn(),
      openSettings: vi.fn(),
      openSession: vi.fn(),
      sendActiveChatContext,
      exportActiveThreadMarkdown,
      copyActiveThreadMarkdown,
      sendLatestAssistantResponseToChat,
      copyLatestAssistantResponse,
      sendLatestUserPromptToChat,
      copyLatestUserPrompt,
      attachFilesToActiveChat,
      compactActiveThread,
      archiveActiveThread,
      renameActiveThread,
      deleteActiveThread,
      toggleSessionPinned,
      interruptActiveThread,
      setActiveRepo: vi.fn(),
      setActiveWindow: vi.fn(),
    })

    expect(actions.find((action) => action.id === 'codex:active:compact')).toMatchObject({
      label: 'Compact active chat',
      description: 'Compact Smoke thread',
      disabledReason: undefined,
    })
    expect(actions.find((action) => action.id === 'codex:active:interrupt')).toMatchObject({
      label: 'Interrupt active Codex run',
      description: 'Stop Smoke thread',
      disabledReason: undefined,
    })
    expect(actions.find((action) => action.id === 'context:active-chat')).toMatchObject({
      label: 'Send active chat context',
      description: 'Send Smoke thread state, context usage, approvals, and recent messages to chat',
      disabledReason: undefined,
    })
    expect(actions.find((action) => action.id === 'export:active-chat:markdown')).toMatchObject({
      label: 'Export active chat transcript',
      description: 'Save Smoke thread transcript as Markdown',
      disabledReason: undefined,
    })
    expect(actions.find((action) => action.id === 'clipboard:active-chat:markdown')).toMatchObject({
      label: 'Copy active chat transcript',
      description: 'Copy Smoke thread transcript as Markdown',
      disabledReason: undefined,
    })
    expect(actions.find((action) => action.id === 'context:active-chat:attach-files')).toMatchObject({
      label: 'Attach files to active chat',
      description: 'Attach local files or folders to Smoke thread',
      disabledReason: undefined,
    })
    expect(actions.find((action) => action.id === 'context:active-chat:latest-assistant-response')).toMatchObject({
      label: 'Send latest response to chat',
      description: 'Reuse latest Smoke thread assistant response as chat context',
      disabledReason: undefined,
    })
    expect(actions.find((action) => action.id === 'clipboard:active-chat:latest-assistant-response')).toMatchObject({
      label: 'Copy latest response',
      description: 'Copy latest Smoke thread assistant response',
      disabledReason: undefined,
    })
    expect(actions.find((action) => action.id === 'context:active-chat:latest-user-prompt')).toMatchObject({
      label: 'Send latest prompt to chat',
      description: 'Reuse latest Smoke thread user prompt as chat context',
      disabledReason: undefined,
    })
    expect(actions.find((action) => action.id === 'clipboard:active-chat:latest-user-prompt')).toMatchObject({
      label: 'Copy latest prompt',
      description: 'Copy latest Smoke thread user prompt',
      disabledReason: undefined,
    })
    expect(actions.find((action) => action.id === 'codex:active:archive')).toMatchObject({
      label: 'Archive active chat',
      description: 'Archive Smoke thread',
      disabledReason: undefined,
    })
    expect(actions.find((action) => action.id === 'codex:active:rename')).toMatchObject({
      label: 'Rename active chat',
      description: 'Rename Smoke thread',
      disabledReason: undefined,
    })
    expect(actions.find((action) => action.id === 'codex:active:delete')).toMatchObject({
      label: 'Delete active chat',
      description: 'Delete Smoke thread',
      disabledReason: undefined,
    })
    expect(actions.find((action) => action.id === 'codex:active:pin')).toMatchObject({
      label: 'Pin active chat',
      description: 'Pin Smoke thread',
      disabledReason: undefined,
    })
    expect(filterAppActions(actions, 'rename active chat').map((action) => action.id)).toContain('codex:active:rename')
    expect(filterAppActions(actions, 'delete active chat').map((action) => action.id)).toContain('codex:active:delete')
    expect(filterAppActions(actions, 'favorite active chat').map((action) => action.id)).toContain('codex:active:pin')
    expect(filterAppActions(actions, 'export transcript markdown').map((action) => action.id)).toContain('export:active-chat:markdown')
    expect(filterAppActions(actions, 'copy transcript markdown').map((action) => action.id)).toContain('clipboard:active-chat:markdown')
    expect(filterAppActions(actions, 'attach folder active chat').map((action) => action.id)).toContain('context:active-chat:attach-files')
    expect(filterAppActions(actions, 'reuse latest useful answer').map((action) => action.id)).toContain('context:active-chat:latest-assistant-response')
    expect(filterAppActions(actions, 'copy latest response').map((action) => action.id)).toContain('clipboard:active-chat:latest-assistant-response')
    expect(filterAppActions(actions, 'reuse inspect diff prompt').map((action) => action.id)).toContain('context:active-chat:latest-user-prompt')
    expect(filterAppActions(actions, 'copy latest prompt').map((action) => action.id)).toContain('clipboard:active-chat:latest-user-prompt')

    actions.find((action) => action.id === 'codex:active:compact')?.run()
    actions.find((action) => action.id === 'codex:active:interrupt')?.run()
    actions.find((action) => action.id === 'context:active-chat')?.run()
    actions.find((action) => action.id === 'export:active-chat:markdown')?.run()
    actions.find((action) => action.id === 'clipboard:active-chat:markdown')?.run()
    actions.find((action) => action.id === 'context:active-chat:latest-assistant-response')?.run()
    actions.find((action) => action.id === 'clipboard:active-chat:latest-assistant-response')?.run()
    actions.find((action) => action.id === 'context:active-chat:latest-user-prompt')?.run()
    actions.find((action) => action.id === 'clipboard:active-chat:latest-user-prompt')?.run()
    actions.find((action) => action.id === 'context:active-chat:attach-files')?.run()
    actions.find((action) => action.id === 'codex:active:archive')?.run()
    actions.find((action) => action.id === 'codex:active:rename')?.run()
    actions.find((action) => action.id === 'codex:active:delete')?.run()
    actions.find((action) => action.id === 'codex:active:pin')?.run()

    expect(compactActiveThread).toHaveBeenCalled()
    expect(interruptActiveThread).toHaveBeenCalled()
    expect(sendActiveChatContext).toHaveBeenCalled()
    expect(exportActiveThreadMarkdown).toHaveBeenCalled()
    expect(copyActiveThreadMarkdown).toHaveBeenCalled()
    expect(sendLatestAssistantResponseToChat).toHaveBeenCalledWith(expect.objectContaining({ id: 'message-assistant-2' }))
    expect(copyLatestAssistantResponse).toHaveBeenCalledWith(expect.objectContaining({ id: 'message-assistant-2' }))
    expect(sendLatestUserPromptToChat).toHaveBeenCalledWith(expect.objectContaining({ id: 'message-user-1' }))
    expect(copyLatestUserPrompt).toHaveBeenCalledWith(expect.objectContaining({ id: 'message-user-1' }))
    expect(attachFilesToActiveChat).toHaveBeenCalled()
    expect(archiveActiveThread).toHaveBeenCalled()
    expect(renameActiveThread).toHaveBeenCalled()
    expect(deleteActiveThread).toHaveBeenCalled()
    expect(toggleSessionPinned).toHaveBeenCalledWith(expect.objectContaining({
      id: 'thread-1',
      title: 'Smoke thread',
      archived: false,
    }))
  })

  it('builds searchable active transcript message actions', () => {
    const sendMessageContext = vi.fn()
    const copyMessageText = vi.fn()
    const activeThread = {
      id: 'thread-1',
      title: 'Smoke thread',
      repoId: 'repo-1',
      messages: [
        { id: 'message-system', role: 'system' as const, content: 'Hidden setup note', timestamp: 1 },
        { id: 'message-user-1', role: 'user' as const, content: 'Please inspect the settings regression carefully.', timestamp: 2 },
        { id: 'message-assistant-1', role: 'assistant' as const, content: 'The settings regression points at the palette wiring.', timestamp: 3 },
        { id: 'message-tool', role: 'tool' as const, content: 'Tool output mentioning settings regression', timestamp: 4 },
        { id: 'message-user-pending', role: 'user' as const, content: 'Pending settings regression follow-up', timestamp: 5, pending: true },
      ],
      pendingApprovals: [],
      isRunning: false,
    }

    expect(buildActiveThreadMessageActions({
      activeThread,
      query: '',
      sendMessageContext,
      copyMessageText,
    })).toEqual([])

    const actions = buildActiveThreadMessageActions({
      activeThread,
      query: 'settings regression',
      sendMessageContext,
      copyMessageText,
    })

    expect(actions.map((action) => action.id)).toEqual([
      'context:active-chat:message:message-assistant-1',
      'clipboard:active-chat:message:message-assistant-1',
      'context:active-chat:message:message-user-1',
      'clipboard:active-chat:message:message-user-1',
    ])
    expect(actions[0]).toMatchObject({
      group: 'system',
      icon: 'chat',
      label: 'Send transcript message to chat: The settings regression points at the palette wiring.',
      description: 'Smoke thread - assistant response',
    })
    expect(actions[2]).toMatchObject({
      label: 'Send transcript message to chat: Please inspect the settings regression carefully.',
      description: 'Smoke thread - user prompt',
    })
    expect(filterAppActions(actions, 'copy transcript settings palette').map((action) => action.id)).toEqual([
      'clipboard:active-chat:message:message-assistant-1',
    ])

    actions[0].run()
    actions[3].run()

    expect(sendMessageContext).toHaveBeenCalledWith(expect.objectContaining({ id: 'message-assistant-1' }))
    expect(copyMessageText).toHaveBeenCalledWith(expect.objectContaining({ id: 'message-user-1' }))
  })

  it('disables latest-response actions until an assistant response exists', () => {
    const actions = buildAppActions({
      repos: [],
      activeRepoId: 'repo-1',
      windows: [],
      activeWindowId: null,
      activeThread: {
        id: 'thread-1',
        title: 'Empty thread',
        repoId: 'repo-1',
        messages: [
          { id: 'message-user-1', role: 'user', content: 'Question', timestamp: 1 },
          { id: 'message-assistant-pending', role: 'assistant', content: 'Streaming', timestamp: 2, pending: true },
        ],
        pendingApprovals: [],
        isRunning: true,
      },
      sessions: [],
      openChat: vi.fn(),
      openTerminal: vi.fn(),
      openBrowser: vi.fn(),
      openSettings: vi.fn(),
      openSession: vi.fn(),
      sendLatestAssistantResponseToChat: vi.fn(),
      copyLatestAssistantResponse: vi.fn(),
      sendLatestUserPromptToChat: vi.fn(),
      copyLatestUserPrompt: vi.fn(),
      setActiveRepo: vi.fn(),
      setActiveWindow: vi.fn(),
    })

    expect(actions.find((action) => action.id === 'context:active-chat:latest-assistant-response')).toMatchObject({
      label: 'Send latest response to chat',
      disabledReason: 'No completed assistant response yet',
    })
    expect(actions.find((action) => action.id === 'clipboard:active-chat:latest-assistant-response')).toMatchObject({
      label: 'Copy latest response',
      disabledReason: 'No completed assistant response yet',
    })
    expect(actions.find((action) => action.id === 'context:active-chat:latest-user-prompt')).toMatchObject({
      label: 'Send latest prompt to chat',
      disabledReason: undefined,
    })
    expect(actions.find((action) => action.id === 'clipboard:active-chat:latest-user-prompt')).toMatchObject({
      label: 'Copy latest prompt',
      disabledReason: undefined,
    })
  })

  it('builds active pending approval actions', () => {
    const resolveActiveApproval = vi.fn()
    const actions = buildAppActions({
      repos: [],
      activeRepoId: 'repo-1',
      windows: [],
      activeWindowId: null,
      activeThread: {
        id: 'thread-1',
        title: 'Approval thread',
        repoId: 'repo-1',
        messages: [],
        pendingApprovals: [{
          id: 'approval-1',
          reviewId: 'review-1',
          targetItemId: 'tool-call-1',
          action: { type: 'tool' },
          review: { status: 'pending' },
          description: 'Run npm install',
        }],
        isRunning: true,
      },
      sessions: [],
      openChat: vi.fn(),
      openTerminal: vi.fn(),
      openBrowser: vi.fn(),
      openSettings: vi.fn(),
      openSession: vi.fn(),
      resolveActiveApproval,
      setActiveRepo: vi.fn(),
      setActiveWindow: vi.fn(),
    })

    expect(actions.find((action) => action.id === 'codex:approval:approval-1:approve')).toMatchObject({
      label: 'Approve pending Codex action',
      group: 'sessions',
      icon: 'tools',
      description: 'Run npm install',
    })
    expect(actions.find((action) => action.id === 'codex:approval:approval-1:deny')).toMatchObject({
      label: 'Deny pending Codex action',
      description: 'Run npm install',
    })
    expect(filterAppActions(actions, 'approve npm install').map((action) => action.id)).toContain('codex:approval:approval-1:approve')

    actions.find((action) => action.id === 'codex:approval:approval-1:approve')?.run()
    actions.find((action) => action.id === 'codex:approval:approval-1:deny')?.run()

    expect(resolveActiveApproval).toHaveBeenCalledWith('approval-1', 'approve')
    expect(resolveActiveApproval).toHaveBeenCalledWith('approval-1', 'deny')
  })

  it('builds running process actions for terminal focus, browser preview, and chat context', () => {
    const openProcessTerminal = vi.fn()
    const openProcessBrowser = vi.fn()
    const sendProcessContext = vi.fn()
    const process = {
      id: 'child:1234',
      pid: 1234,
      ppid: 99,
      command: 'npm run dev -- --host 0.0.0.0',
      repoPath: '/repo/cranberri',
      cwd: '/repo/cranberri',
      kind: 'dev-server' as const,
      status: 'running' as const,
      source: 'terminal' as const,
      terminalWindowId: 'terminal-win-1',
      startedAt: 1700000000000,
    }

    const actions = buildAppActions({
      repos: [],
      activeRepoId: 'repo-1',
      windows: [],
      activeWindowId: null,
      sessions: [],
      processes: [process],
      openChat: vi.fn(),
      openTerminal: vi.fn(),
      openBrowser: vi.fn(),
      openSettings: vi.fn(),
      openSession: vi.fn(),
      openProcessTerminal,
      openProcessBrowser,
      sendProcessContext,
      setActiveRepo: vi.fn(),
      setActiveWindow: vi.fn(),
    })

    expect(actions.filter((action) => action.group === 'processes').map((action) => action.id)).toEqual([
      'process:child:1234:terminal',
      'process:child:1234:browser',
      'process:child:1234:context',
    ])
    expect(filterAppActions(actions, 'dev server browser').map((action) => action.id)).toContain('process:child:1234:browser')

    actions.find((action) => action.id === 'process:child:1234:terminal')?.run()
    actions.find((action) => action.id === 'process:child:1234:browser')?.run()
    actions.find((action) => action.id === 'process:child:1234:context')?.run()

    expect(openProcessTerminal).toHaveBeenCalledWith(process)
    expect(openProcessBrowser).toHaveBeenCalledWith(process)
    expect(sendProcessContext).toHaveBeenCalledWith(process)
  })

  it('does not offer terminal focus for processes without an owning terminal', () => {
    const actions = buildAppActions({
      repos: [],
      activeRepoId: 'repo-1',
      windows: [],
      activeWindowId: null,
      sessions: [],
      processes: [{
        id: 'manual:1234',
        pid: 1234,
        command: 'npm run dev',
        repoPath: '/repo/cranberri',
        cwd: '/repo/cranberri',
        kind: 'process',
        status: 'running',
        source: 'manual',
        startedAt: 1700000000000,
      }],
      openChat: vi.fn(),
      openTerminal: vi.fn(),
      openBrowser: vi.fn(),
      openSettings: vi.fn(),
      openSession: vi.fn(),
      openProcessTerminal: vi.fn(),
      sendProcessContext: vi.fn(),
      setActiveRepo: vi.fn(),
      setActiveWindow: vi.fn(),
    })

    expect(actions.find((action) => action.id === 'process:manual:1234:terminal')).toBeUndefined()
    expect(actions.find((action) => action.id === 'process:manual:1234:context')).toBeDefined()
  })

  it('builds runnable file search result actions', () => {
    const openFile = vi.fn()
    const sendFileContext = vi.fn()
    const copyFileContext = vi.fn()
    const attachFile = vi.fn()
    const actions = buildFileSearchActions({
      fileMatches: [
        { path: 'src/CommandPalette.tsx', basename: 'CommandPalette.tsx', directory: 'src', score: 0.04 },
      ],
      contentMatches: [
        { path: 'src/App.tsx', line: 12, column: 3, text: 'openBrowser()' },
        { path: 'src/main.ts', line: 4, column: 1, text: 'createRoot' },
      ],
      openFile,
      sendFileContext,
      copyFileContext,
      attachFile,
    })

    expect(actions.map((action) => action.group)).toEqual(['files', 'files', 'files', 'files', 'files', 'files', 'files', 'files', 'files', 'files', 'files', 'files'])
    expect(actions[0]).toMatchObject({
      icon: 'file',
      label: 'src/CommandPalette.tsx',
      description: 'Path match in src',
    })
    expect(actions[1]).toMatchObject({
      icon: 'chat',
      label: 'Send file context: src/CommandPalette.tsx',
      description: 'Send path match in src to chat',
    })
    expect(actions[2]).toMatchObject({
      icon: 'file',
      label: 'Copy file context: src/CommandPalette.tsx',
      description: 'Copy path match in src',
    })
    expect(actions[3]).toMatchObject({
      icon: 'file',
      label: 'Attach file to active chat: src/CommandPalette.tsx',
      description: 'Attach path match in src',
    })
    expect(actions[4]).toMatchObject({
      icon: 'file',
      label: 'src/App.tsx:12',
      description: 'openBrowser()',
    })
    expect(actions[5]).toMatchObject({
      icon: 'chat',
      label: 'Send file context: src/App.tsx:12',
      description: 'openBrowser()',
    })
    expect(actions[6]).toMatchObject({
      icon: 'file',
      label: 'Copy file context: src/App.tsx:12',
      description: 'openBrowser()',
    })
    expect(actions[7]).toMatchObject({
      icon: 'file',
      label: 'Attach file to active chat: src/App.tsx',
      description: 'openBrowser()',
    })
    actions[0].run()
    actions[1].run()
    actions[2].run()
    actions[3].run()
    actions[4].run()
    actions[5].run()
    actions[6].run()
    actions[7].run()
    expect(openFile).toHaveBeenCalledWith('src/CommandPalette.tsx')
    expect(openFile).toHaveBeenCalledWith('src/App.tsx', 12)
    expect(sendFileContext).toHaveBeenCalledWith('src/CommandPalette.tsx')
    expect(sendFileContext).toHaveBeenCalledWith('src/App.tsx', 12)
    expect(copyFileContext).toHaveBeenCalledWith('src/CommandPalette.tsx')
    expect(copyFileContext).toHaveBeenCalledWith('src/App.tsx', 12)
    expect(attachFile).toHaveBeenCalledWith('src/CommandPalette.tsx')
    expect(attachFile).toHaveBeenCalledWith('src/App.tsx')
  })
})
