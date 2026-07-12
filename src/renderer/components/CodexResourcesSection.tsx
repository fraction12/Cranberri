import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, Loader2, MessageSquare, RefreshCw, Search } from 'lucide-react'
import { toast } from 'sonner'
import type { CodexPluginInfo, CodexSkillInfo } from '@/shared/codex'
import type { ToolRegistrySnapshot } from '@/shared/tools'
import { useCodexWindows } from '../state/codex'
import { refreshToolCatalogQueries } from '../state/tools'
import { reportSendChatContextError, sendChatContext } from '../state/chat-context-command'
import {
  appChatContext,
  codexAppStatus,
  filterCodexPlugins,
  groupCodexApps,
  mcpServerChatContext,
  skillChatContext,
  skillSourceLabel,
  type LatestCodexResourceContext,
} from './codex-resources'
import { createCodexResourceContextCapturedEvent } from './codex-resource-context-events'
import { SettingsPage, SettingsSection } from './settings/settings-page'
import { buttonStyle, cn, fieldStyle, segmentedControl, segmentedItem, segmentedItemActive } from '../lib/ui'
import { typeStyle } from '../lib/typography'
import { IconButton } from './ui/IconButton'

type ExtensionView = 'installed' | 'browse' | 'connections' | 'skills'

const EXTENSION_VIEWS: Array<{ value: ExtensionView; label: string }> = [
  { value: 'installed', label: 'Installed' },
  { value: 'browse', label: 'Browse' },
  { value: 'connections', label: 'Connections' },
  { value: 'skills', label: 'Skills' },
]

export function CodexResourcesSection() {
  const queryClient = useQueryClient()
  const { activeThreadId } = useCodexWindows()
  const [view, setView] = useState<ExtensionView>('installed')
  const [search, setSearch] = useState('')
  const pluginsQuery = useQuery({ queryKey: ['codex', 'plugins'], queryFn: async () => (await window.cranberri.codex.plugins()).plugins })
  const skillsQuery = useQuery({ queryKey: ['codex', 'skills'], queryFn: async () => (await window.cranberri.codex.skills()).skills })
  const registryQuery = useQuery({
    queryKey: ['tools', 'registry', 'settings'],
    queryFn: async () => window.cranberri.tools.registry(null, true) as Promise<ToolRegistrySnapshot>,
    staleTime: 5000,
  })

  const plugins = pluginsQuery.data ?? []
  const skills = useMemo(() => skillsQuery.data ?? [], [skillsQuery.data])
  const registry = registryQuery.data ?? null
  const filteredPlugins = filterCodexPlugins(plugins, search)
  const installedPlugins = filteredPlugins.filter((plugin) => plugin.installed ?? plugin.enabled)
  const availablePlugins = filteredPlugins.filter((plugin) => !(plugin.installed ?? plugin.enabled))
  const filteredSkills = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return skills
    return skills.filter((skill) => [skill.displayName, skill.name, skill.description, skill.pluginName].filter(Boolean).join(' ').toLowerCase().includes(query))
  }, [search, skills])
  const initialLoading = !pluginsQuery.data && !skillsQuery.data && !registryQuery.data
    && (pluginsQuery.isLoading || skillsQuery.isLoading || registryQuery.isLoading)
  const refreshing = pluginsQuery.isFetching || skillsQuery.isFetching || registryQuery.isFetching
  const queryFailed = Boolean(pluginsQuery.error || skillsQuery.error || registryQuery.error)
  const connectionPartial = Boolean(registry?.capabilities.errors.length)

  const refreshResources = async (notify = false) => {
    try {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['codex', 'plugins'] }),
        queryClient.invalidateQueries({ queryKey: ['codex', 'skills'] }),
        queryClient.invalidateQueries({ queryKey: ['tools', 'registry'] }),
        refreshToolCatalogQueries(queryClient, activeThreadId),
      ])
      if (notify) toast.success('Extensions refreshed')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not refresh extensions')
    }
  }

  const installPlugin = useMutation({
    mutationFn: async (pluginId: string) => window.cranberri.codex.installPlugin(pluginId),
    onSuccess: async (result) => {
      toast.success(result.message ?? 'Plugin installed')
      await refreshResources()
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : 'Could not install plugin'),
  })

  const updatePlugins = useMutation({
    mutationFn: async () => window.cranberri.codex.upgradePluginMarketplaces(),
    onSuccess: async (result) => {
      toast.success(result.message ?? 'Plugin catalogs updated')
      await refreshResources()
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : 'Could not update plugin catalogs'),
  })

  const sendSkillToChat = async (skill: (typeof skills)[number]) => {
    const context: LatestCodexResourceContext = {
      kind: 'skill',
      label: skill.displayName,
      text: skillChatContext(skill),
      inputParts: [{ type: 'skill', name: skill.name, path: skill.path }],
    }
    window.dispatchEvent(createCodexResourceContextCapturedEvent(context))
    try {
      await sendChatContext({ text: context.text, inputParts: context.inputParts })
      toast.success(`${skill.displayName} added to chat`)
    } catch (error) {
      reportSendChatContextError(error)
    }
  }

  const sendConnectionToChat = async (kind: 'app' | 'mcp-server', label: string, text: string) => {
    window.dispatchEvent(createCodexResourceContextCapturedEvent({ kind, label, text }))
    try {
      await sendChatContext({ text })
      toast.success(`${label} added to chat`)
    } catch (error) {
      reportSendChatContextError(error)
    }
  }

  return (
    <SettingsPage
      title="Extensions"
      description="Manage plugins, connections, and reusable skills."
      actions={(
        <>
          <button
            type="button"
            onClick={() => updatePlugins.mutate()}
            disabled={updatePlugins.isPending}
            className={buttonStyle({ tone: 'secondary', size: 'small' })}
          >
            <Download className="h-3.5 w-3.5" />
            Update plugins
          </button>
          <IconButton
            type="button"
            onClick={() => void refreshResources(true)}
            disabled={refreshing}
            label="Refresh extensions"
          >
            {refreshing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          </IconButton>
        </>
      )}
    >
      <div className={cn(segmentedControl, 'grid-cols-4')} role="group" aria-label="Extension view">
        {EXTENSION_VIEWS.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={view === option.value}
            onClick={() => { setView(option.value); setSearch('') }}
            className={cn(segmentedItem, 'h-8 px-2', view === option.value && segmentedItemActive)}
          >
            {option.label}
          </button>
        ))}
      </div>

      <label className="relative block">
        <span className="sr-only">Search extensions</span>
        <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-app-text-muted" />
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={`Search ${EXTENSION_VIEWS.find((option) => option.value === view)?.label.toLowerCase()}`}
          className={cn(fieldStyle, 'w-full pl-8 pr-3')}
        />
      </label>

      {queryFailed && (
        <div role="alert" className={cn('flex items-center justify-between gap-3 rounded-md bg-app-danger/5 px-3 py-3', typeStyle({ role: 'status', tone: 'danger' }))}>
          <span>Some extension data could not be loaded.</span>
          <button type="button" onClick={() => void refreshResources()} className={cn('underline underline-offset-4', typeStyle({ role: 'control', tone: 'danger' }))}>Retry</button>
        </div>
      )}
      {connectionPartial && view === 'connections' && (
        <div role="status" className={cn('rounded-md bg-app-warning/8 px-3 py-3', typeStyle({ role: 'status', tone: 'warning' }))}>Some connections could not be verified in this runtime.</div>
      )}
      {initialLoading ? <LoadingRow /> : (
        <ExtensionViewContent
          view={view}
          installedPlugins={installedPlugins}
          availablePlugins={availablePlugins}
          skills={filteredSkills}
          registry={registry}
          search={search}
          installPlugin={installPlugin}
          onSendSkill={sendSkillToChat}
          onSendConnection={sendConnectionToChat}
        />
      )}
    </SettingsPage>
  )
}

function ExtensionViewContent({
  view,
  installedPlugins,
  availablePlugins,
  skills,
  registry,
  search,
  installPlugin,
  onSendSkill,
  onSendConnection,
}: {
  view: ExtensionView
  installedPlugins: CodexPluginInfo[]
  availablePlugins: CodexPluginInfo[]
  skills: CodexSkillInfo[]
  registry: ToolRegistrySnapshot | null
  search: string
  installPlugin: { mutate: (pluginId: string) => void; isPending: boolean; variables?: string }
  onSendSkill: (skill: CodexSkillInfo) => void
  onSendConnection: (kind: 'app' | 'mcp-server', label: string, text: string) => void
}) {
  if (view === 'installed') {
    return <PluginList title="Installed plugins" plugins={installedPlugins} empty="No installed plugins match this search." />
  }
  if (view === 'browse') {
    return (
      <PluginList
        title="Available plugins"
        plugins={availablePlugins.slice(0, 30)}
        empty="No available plugins match this search."
        onInstall={(plugin) => installPlugin.mutate(plugin.id)}
        pendingId={installPlugin.isPending ? installPlugin.variables : undefined}
        footer={availablePlugins.length > 30 ? `Showing 30 of ${availablePlugins.length}. Search to narrow the list.` : undefined}
      />
    )
  }
  if (view === 'skills') {
    return (
      <SettingsSection title="Skills" description="Add a skill to the active chat when you need it.">
        <div className="space-y-1">
          {skills.slice(0, 40).map((skill) => (
            <div key={skill.id} className="flex items-center gap-3 rounded-md px-2 py-2.5 hover:bg-app-bg">
              <div className="min-w-0 flex-1">
                <div className={cn('truncate', typeStyle({ role: 'body', tone: 'primary' }))}>{skill.displayName}</div>
                <div className={cn('mt-0.5 truncate', typeStyle({ role: 'metadata', tone: 'secondary' }))}>{skill.description || skillSourceLabel(skill)}</div>
              </div>
              <IconButton type="button" onClick={() => onSendSkill(skill)} label={`Add ${skill.displayName} to chat`}>
                <MessageSquare className="h-3.5 w-3.5" />
              </IconButton>
            </div>
          ))}
          {skills.length === 0 && <EmptyRow label="No skills match this search." />}
        </div>
        {skills.length > 40 && <p className={typeStyle({ role: 'metadata', tone: 'secondary' })}>Showing 40 of {skills.length}. Search to narrow the list.</p>}
      </SettingsSection>
    )
  }
  return <ConnectionsView registry={registry} search={search} onSend={onSendConnection} />
}

function PluginList({ title, plugins, empty, onInstall, pendingId, footer }: {
  title: string
  plugins: CodexPluginInfo[]
  empty: string
  onInstall?: (plugin: CodexPluginInfo) => void
  pendingId?: string
  footer?: string
}) {
  return (
    <SettingsSection title={title}>
      <div className="space-y-1">
        {plugins.map((plugin) => (
          <div key={plugin.id} className="flex items-center gap-3 rounded-md px-2 py-2.5 hover:bg-app-bg">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className={cn('truncate', typeStyle({ role: 'body', tone: 'primary' }))}>{plugin.displayName}</span>
                {plugin.version && <span className={cn('shrink-0', typeStyle({ role: 'micro', tone: 'secondary' }))}>{plugin.version}</span>}
              </div>
              <div className={cn('mt-0.5 truncate', typeStyle({ role: 'metadata', tone: 'secondary' }))}>{plugin.description || plugin.prompt || 'Codex plugin'}</div>
            </div>
            {onInstall ? (
              <button type="button" onClick={() => onInstall(plugin)} disabled={pendingId === plugin.id} className={buttonStyle({ tone: 'secondary', size: 'small' })}>
                {pendingId === plugin.id ? 'Installing...' : 'Install'}
              </button>
            ) : <span className={typeStyle({ role: 'status', tone: plugin.enabled ? 'success' : 'secondary' })}>{plugin.enabled ? 'Enabled' : 'Installed'}</span>}
          </div>
        ))}
        {plugins.length === 0 && <EmptyRow label={empty} />}
      </div>
      {footer && <p className={typeStyle({ role: 'metadata', tone: 'secondary' })}>{footer}</p>}
    </SettingsSection>
  )
}

function ConnectionsView({ registry, search, onSend }: {
  registry: ToolRegistrySnapshot | null
  search: string
  onSend: (kind: 'app' | 'mcp-server', label: string, text: string) => void
}) {
  const [showDirectory, setShowDirectory] = useState(false)
  const query = search.trim().toLowerCase()
  const apps = (registry?.apps ?? []).filter((app) => !query || [app.name, app.description].filter(Boolean).join(' ').toLowerCase().includes(query))
  const servers = (registry?.mcpServers ?? []).filter((server) => !query || server.name.toLowerCase().includes(query))
  const { ready: readyApps, directory: directoryApps } = groupCodexApps(apps)
  const directoryOpen = Boolean(query) || showDirectory
  const visibleDirectoryApps = directoryApps.slice(0, 40)
  return (
    <div className="space-y-6">
      <SettingsSection title="Available apps">
        <div className="space-y-1" data-available-apps="true">
          {readyApps.map((app) => (
            <ConnectionRow key={app.id} name={app.name} detail={app.description || 'Codex app'} status="Ready" tone="success" onSend={() => onSend('app', app.name, appChatContext(app))} />
          ))}
          {readyApps.length === 0 && <EmptyRow label={query ? 'No available apps match this search.' : 'No apps are currently available to Codex.'} />}
        </div>
      </SettingsSection>
      <SettingsSection title="App directory" description="Catalog entries reported by Codex. These are not connected.">
        <div className="space-y-1" data-app-directory="true">
          {directoryApps.length === 0 ? (
            <EmptyRow label={query ? 'No directory apps match this search.' : 'No unavailable apps found.'} />
          ) : directoryOpen ? (
            <>
              {visibleDirectoryApps.map((app) => {
                const status = codexAppStatus(app)
                return (
                  <ConnectionRow
                    key={app.id}
                    name={app.name}
                    detail={app.description || 'Codex ecosystem app'}
                    status={status === 'disabled' ? 'Disabled' : 'Unavailable'}
                    tone={status === 'disabled' ? 'secondary' : 'warning'}
                  />
                )
              })}
              {directoryApps.length > visibleDirectoryApps.length && (
                <p className={typeStyle({ role: 'metadata', tone: 'secondary' })}>Showing {visibleDirectoryApps.length} of {directoryApps.length}. Search to narrow the list.</p>
              )}
              {!query && (
                <button type="button" onClick={() => setShowDirectory(false)} className={buttonStyle({ tone: 'secondary', size: 'compact' })}>
                  Hide unavailable
                </button>
              )}
            </>
          ) : (
            <div className="flex items-center justify-between gap-3 rounded-md px-2 py-2.5 hover:bg-app-bg">
              <span className={typeStyle({ role: 'metadata', tone: 'secondary' })}>{directoryApps.length} unavailable app{directoryApps.length === 1 ? '' : 's'}</span>
              <button type="button" onClick={() => setShowDirectory(true)} className={buttonStyle({ tone: 'secondary', size: 'compact' })}>
                Show unavailable
              </button>
            </div>
          )}
        </div>
      </SettingsSection>
      <SettingsSection title="MCP servers">
        <div className="space-y-1">
          {servers.map((server) => (
            <ConnectionRow
              key={server.name}
              name={server.name}
              detail={`${server.toolCount} tool${server.toolCount === 1 ? '' : 's'} available`}
              status={server.toolCount > 0 ? 'Ready' : 'No tools'}
              tone={server.toolCount > 0 ? 'success' : 'secondary'}
              onSend={() => onSend('mcp-server', server.name, mcpServerChatContext(server))}
            />
          ))}
          {servers.length === 0 && <EmptyRow label="No MCP servers found." />}
        </div>
      </SettingsSection>
    </div>
  )
}

function ConnectionRow({ name, detail, status, tone, onSend }: {
  name: string
  detail: string
  status: string
  tone: 'success' | 'warning' | 'secondary'
  onSend?: () => void
}) {
  return (
    <div className="flex items-center gap-3 rounded-md px-2 py-2.5 hover:bg-app-bg">
      <div className="min-w-0 flex-1">
        <div className={cn('truncate', typeStyle({ role: 'body', tone: 'primary' }))}>{name}</div>
        <div className={cn('mt-0.5 truncate', typeStyle({ role: 'metadata', tone: 'secondary' }))}>{detail}</div>
      </div>
      <span className={cn('shrink-0', typeStyle({ role: 'status', tone }))}>{status}</span>
      {onSend && (
        <IconButton type="button" onClick={onSend} label={`Add ${name} to chat`}>
          <MessageSquare className="h-3.5 w-3.5" />
        </IconButton>
      )}
    </div>
  )
}

function LoadingRow() {
  return <div className={cn('flex items-center gap-2 px-2 py-4', typeStyle({ role: 'status', tone: 'secondary' }))}><Loader2 className="h-4 w-4 animate-spin" />Loading extensions</div>
}

function EmptyRow({ label }: { label: string }) {
  return <div className={cn('py-4', typeStyle({ role: 'metadata', tone: 'secondary' }))}>{label}</div>
}
