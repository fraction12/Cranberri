import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Boxes, CheckCircle2, Download, MessageSquare, PlugZap, RefreshCw, Search, Sparkles, Wrench } from 'lucide-react'
import type { CodexPluginInfo } from '@/shared/codex'
import type { ToolRegistrySnapshot } from '@/shared/tools'
import { createSendChatContextEvent } from './chat/chat-context-events'
import { appChatContext, filterCodexPlugins, mcpServerChatContext, mcpToolChatContext, skillChatContext, skillSourceLabel, summarizeCodexResources, type CodexResourceContextKind, type LatestCodexResourceContext } from './codex-resources'
import { createCodexResourceContextCapturedEvent } from './codex-resource-context-events'

export function CodexResourcesSection() {
  const queryClient = useQueryClient()
  const [pluginFilter, setPluginFilter] = useState('')
  const [actionMessage, setActionMessage] = useState<string | null>(null)
  const pluginsQuery = useQuery({
    queryKey: ['codex', 'plugins'],
    queryFn: async () => (await window.cranberri.codex.plugins()).plugins,
  })
  const skillsQuery = useQuery({
    queryKey: ['codex', 'skills'],
    queryFn: async () => (await window.cranberri.codex.skills()).skills,
  })
  const registryQuery = useQuery({
    queryKey: ['tools', 'registry', 'settings'],
    queryFn: async () => window.cranberri.tools.registry(null, true) as Promise<ToolRegistrySnapshot>,
    staleTime: 5000,
  })

  const plugins = pluginsQuery.data ?? []
  const skills = skillsQuery.data ?? []
  const registry = registryQuery.data ?? null
  const summary = summarizeCodexResources({ plugins, skills, registry })
  const loading = pluginsQuery.isLoading || skillsQuery.isLoading || registryQuery.isLoading
  const errors = [pluginsQuery.error, skillsQuery.error, registryQuery.error].filter(Boolean)
  const filteredPlugins = filterCodexPlugins(plugins, pluginFilter)
  const installedPlugins = filteredPlugins.filter((plugin) => plugin.installed ?? plugin.enabled)
  const availablePlugins = filteredPlugins.filter((plugin) => !(plugin.installed ?? plugin.enabled))

  const refreshResources = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['codex', 'plugins'] }),
      queryClient.invalidateQueries({ queryKey: ['codex', 'skills'] }),
      queryClient.invalidateQueries({ queryKey: ['tools', 'registry'] }),
    ])
  }

  const installPluginMutation = useMutation({
    mutationFn: async (pluginId: string) => window.cranberri.codex.installPlugin(pluginId),
    onSuccess: async (result) => {
      setActionMessage(result.message ?? 'Plugin installed.')
      await refreshResources()
    },
  })

  const upgradeMarketplacesMutation = useMutation({
    mutationFn: async () => window.cranberri.codex.upgradePluginMarketplaces(),
    onSuccess: async (result) => {
      setActionMessage(result.message ?? 'Plugin marketplaces refreshed.')
      await refreshResources()
    },
  })

  const refresh = () => {
    setActionMessage(null)
    void refreshResources()
  }

  const sendSkillToChat = (skill: (typeof skills)[number]) => {
    const context: LatestCodexResourceContext = {
      kind: 'skill',
      label: skill.displayName,
      text: skillChatContext(skill),
      inputParts: [{ type: 'skill', name: skill.name, path: skill.path }],
    }
    window.dispatchEvent(createCodexResourceContextCapturedEvent(context))
    window.dispatchEvent(createSendChatContextEvent({
      text: context.text,
      inputParts: context.inputParts,
    }))
    setActionMessage(`${skill.displayName} sent to chat.`)
  }

  const sendResourceContextToChat = (kind: CodexResourceContextKind, label: string, text: string) => {
    window.dispatchEvent(createCodexResourceContextCapturedEvent({ kind, label, text }))
    window.dispatchEvent(createSendChatContextEvent({ text }))
    setActionMessage(`${label} sent to chat.`)
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-app-text-muted">
            <PlugZap className="h-3.5 w-3.5" />
            Apps and tools
          </div>
          <div className="mt-1 text-xs text-app-text-muted">
            {loading ? 'Loading Codex resources...' : `${summary.installedPlugins} installed plugins, ${summary.availablePlugins} available plugins, ${summary.mcpTools} MCP tools`}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => upgradeMarketplacesMutation.mutate()}
            disabled={upgradeMarketplacesMutation.isPending}
            className="inline-flex items-center gap-2 rounded-lg bg-app-surface-2 px-3 py-2 text-xs font-medium hover:bg-app-surface-2/80 disabled:opacity-50"
          >
            <Download className="h-3.5 w-3.5" />
            Update
          </button>
          <button
            type="button"
            onClick={refresh}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-lg bg-app-surface-2 px-3 py-2 text-xs font-medium hover:bg-app-surface-2/80 disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {(actionMessage || installPluginMutation.error || upgradeMarketplacesMutation.error) && (
        <div className={`rounded-lg border p-3 text-xs ${installPluginMutation.error || upgradeMarketplacesMutation.error ? 'border-app-danger/30 bg-app-danger/10 text-app-danger' : 'border-app-accent/30 bg-app-accent/10 text-app-accent'}`}>
          {installPluginMutation.error instanceof Error
            ? installPluginMutation.error.message
            : upgradeMarketplacesMutation.error instanceof Error
              ? upgradeMarketplacesMutation.error.message
              : actionMessage}
        </div>
      )}

      {errors.length > 0 && (
        <div className="rounded-lg border border-app-danger/30 bg-app-danger/10 p-3 text-xs text-app-danger">
          {errors.map((error, index) => (
            <div key={index}>{error instanceof Error ? error.message : 'Failed to load Codex resource data'}</div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-4 gap-2">
        <Metric label="Plugins" value={`${summary.installedPlugins}/${summary.plugins}`} />
        <Metric label="Skills" value={`${summary.pluginSkills}/${summary.skills}`} />
        <Metric label="Apps" value={`${summary.accessibleApps}/${summary.apps}`} />
        <Metric label="MCP tools" value={String(summary.mcpTools)} />
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-2.5 h-3.5 w-3.5 text-app-text-muted" />
        <input
          value={pluginFilter}
          onChange={(event) => setPluginFilter(event.target.value)}
          placeholder="Search plugins"
          className="w-full rounded-lg border border-app-border bg-app-bg py-2 pl-9 pr-3 text-sm outline-none focus:border-app-accent"
        />
      </div>

      <ResourceGroup title="Installed plugins" icon={Boxes}>
        {installedPlugins.length ? installedPlugins.map((plugin) => <PluginRow key={plugin.id} plugin={plugin} pending={installPluginMutation.variables === plugin.id && installPluginMutation.isPending} />) : <EmptyRow label="No installed plugins match this search." />}
      </ResourceGroup>

      <ResourceGroup title="Available plugins" icon={Download}>
        {availablePlugins.length ? availablePlugins.slice(0, 24).map((plugin) => (
          <PluginRow
            key={plugin.id}
            plugin={plugin}
            pending={installPluginMutation.variables === plugin.id && installPluginMutation.isPending}
            onInstall={() => installPluginMutation.mutate(plugin.id)}
          />
        )) : <EmptyRow label="No available plugins match this search." />}
        {availablePlugins.length > 24 && <div className="text-xs text-app-text-muted">{availablePlugins.length - 24} more available plugins. Narrow the search to find them.</div>}
      </ResourceGroup>

      <ResourceGroup title="Connected apps" icon={PlugZap}>
        {registry?.apps.length ? registry.apps.map((app) => (
          <div key={app.id} className="rounded-lg border border-app-border bg-app-bg p-3">
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{app.name}</span>
              <StatusPill ok={app.accessible}>{app.accessible ? 'Accessible' : app.enabled ? 'Needs access' : 'Disabled'}</StatusPill>
              <ResourceContextButton
                label={`Send ${app.name} app context to chat`}
                onClick={() => sendResourceContextToChat('app', app.name, appChatContext(app))}
              />
            </div>
            <div className="mt-1 truncate text-xs text-app-text-muted">{app.description ?? (app.pluginDisplayNames.join(', ') || app.id)}</div>
          </div>
        )) : <EmptyRow label="No app registry entries yet." />}
      </ResourceGroup>

      <ResourceGroup title="MCP servers" icon={Wrench}>
        {registry?.mcpServers.length ? registry.mcpServers.map((server) => (
          <div key={server.name} className="rounded-lg border border-app-border bg-app-bg p-3">
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{server.name}</span>
              <span className="text-[10px] text-app-text-muted">{server.authStatus}</span>
              <span className="rounded bg-app-surface-2 px-1.5 py-0.5 text-[10px]">{server.toolCount} tools</span>
              <ResourceContextButton
                label={`Send ${server.name} MCP server context to chat`}
                onClick={() => sendResourceContextToChat('mcp-server', server.name, mcpServerChatContext(server))}
              />
            </div>
            {server.tools.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {server.tools.slice(0, 8).map((tool) => (
                  <button
                    key={tool.name}
                    type="button"
                    className="rounded bg-app-surface-2 px-1.5 py-0.5 text-[10px] text-app-text-muted hover:text-app-text focus:outline-none focus:ring-1 focus:ring-app-accent"
                    title={`Send ${tool.title ?? tool.name} tool context to chat`}
                    aria-label={`Send ${tool.title ?? tool.name} tool context to chat`}
                    onClick={() => sendResourceContextToChat('mcp-tool', tool.title ?? tool.name, mcpToolChatContext(server, tool))}
                  >
                    {tool.title ?? tool.name}
                  </button>
                ))}
                {server.tools.length > 8 && <span className="rounded bg-app-surface-2 px-1.5 py-0.5 text-[10px] text-app-text-muted">+{server.tools.length - 8}</span>}
              </div>
            )}
          </div>
        )) : <EmptyRow label="No MCP server status entries yet." />}
      </ResourceGroup>

      <ResourceGroup title="Skills" icon={Sparkles}>
        {skills.length ? skills.slice(0, 18).map((skill) => (
          <div key={skill.id} className="rounded-lg border border-app-border bg-app-bg p-3">
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{skill.displayName}</span>
              <span className="rounded bg-app-surface-2 px-1.5 py-0.5 text-[10px] text-app-text-muted">{skillSourceLabel(skill)}</span>
              <button
                type="button"
                onClick={() => sendSkillToChat(skill)}
                className="rounded p-1 text-app-text-muted hover:bg-app-surface-2 hover:text-app-text focus:outline-none focus:ring-1 focus:ring-app-accent"
                title="Send skill to chat"
                aria-label={`Send ${skill.displayName} skill to chat`}
              >
                <MessageSquare className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="mt-1 truncate text-xs text-app-text-muted">{skill.description || skill.name}</div>
          </div>
        )) : <EmptyRow label="No Codex skills found." />}
        {skills.length > 18 && <div className="text-xs text-app-text-muted">{skills.length - 18} more skills available through chat context.</div>}
      </ResourceGroup>

      {registry?.capabilities.errors.length ? (
        <div className="rounded-lg border border-app-border bg-app-bg p-3 text-xs text-app-danger">
          {registry.capabilities.errors.map((error) => <div key={error}>{error}</div>)}
        </div>
      ) : null}
    </div>
  )
}

function ResourceContextButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded p-1 text-app-text-muted hover:bg-app-surface-2 hover:text-app-text focus:outline-none focus:ring-1 focus:ring-app-accent"
      title={label}
      aria-label={label}
    >
      <MessageSquare className="h-3.5 w-3.5" />
    </button>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-app-border bg-app-bg p-3">
      <div className="text-[10px] uppercase tracking-wider text-app-text-muted">{label}</div>
      <div className="mt-1 truncate text-sm font-semibold">{value}</div>
    </div>
  )
}

function ResourceGroup({ title, icon: Icon, children }: { title: string; icon: React.ElementType; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-app-text-muted">
        <Icon className="h-3.5 w-3.5" />
        {title}
      </div>
      <div className="space-y-2">{children}</div>
    </section>
  )
}

function PluginRow({ plugin, pending = false, onInstall }: { plugin: CodexPluginInfo; pending?: boolean; onInstall?: () => void }) {
  const installed = plugin.installed ?? plugin.enabled
  return (
    <div className="rounded-lg border border-app-border bg-app-bg p-3">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{plugin.displayName}</span>
        <StatusPill ok={installed}>{installed ? (plugin.enabled ? 'Enabled' : 'Installed') : 'Available'}</StatusPill>
        {plugin.version && <span className="rounded bg-app-surface-2 px-1.5 py-0.5 text-[10px] text-app-text-muted">{plugin.version}</span>}
        {plugin.toolCount > 0 && <span className="rounded bg-app-surface-2 px-1.5 py-0.5 text-[10px]">{plugin.toolCount} tools</span>}
        {!installed && onInstall && (
          <button
            type="button"
            onClick={onInstall}
            disabled={pending}
            className="inline-flex items-center gap-1 rounded bg-app-accent px-2 py-1 text-[10px] font-semibold text-app-bg hover:bg-app-accent/90 disabled:opacity-50"
          >
            <Download className="h-3 w-3" />
            {pending ? 'Installing' : 'Install'}
          </button>
        )}
      </div>
      <div className="mt-1 truncate text-xs text-app-text-muted">{plugin.description || plugin.prompt || plugin.id}</div>
      <div className="mt-1 truncate text-[10px] text-app-text-muted">{plugin.marketplaceName ?? 'marketplace'}{plugin.sourceLabel ? ` - ${plugin.sourceLabel}` : ''}</div>
    </div>
  )
}

function StatusPill({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] ${ok ? 'bg-app-accent/10 text-app-accent' : 'bg-app-surface-2 text-app-text-muted'}`}>
      {ok && <CheckCircle2 className="h-3 w-3" />}
      {children}
    </span>
  )
}

function EmptyRow({ label }: { label: string }) {
  return <div className="rounded-lg border border-app-border bg-app-bg p-3 text-xs text-app-text-muted">{label}</div>
}
