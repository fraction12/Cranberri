import { Activity, Bot, FileDiff, FileText, Github, PlugZap, Ticket } from 'lucide-react'
import { GitHubPanel } from './GitHubPanel'
import { ProcessesPanel } from './ProcessesPanel'
import { ToolsPanel } from './ToolsPanel'
import { cn } from '../../lib/ui'
import { typeStyle } from '../../lib/typography'

export type RightRailTab = 'files' | 'diff' | 'agents'
export type BottomPanelKind = 'issue' | 'processes' | 'github' | 'tools'

interface RightRailTabsProps {
  activeTab: RightRailTab
  agentCount: number
  onSelectTab: (tab: RightRailTab) => void
}

interface BottomPanelContentProps {
  bottomPanel: BottomPanelKind
  repoPath: string | null
  onOpenToolsSettings: () => void
}

interface BottomPanelNavProps {
  bottomPanel: BottomPanelKind | null
  onTogglePanel: (panel: BottomPanelKind) => void
}

export function RightRailTabs({ activeTab, agentCount, onSelectTab }: RightRailTabsProps) {
  return (
    <div className="grid h-10 shrink-0 grid-cols-3 gap-1 bg-app-surface p-1" role="tablist" aria-label="Right rail">
      <TabButton
        active={activeTab === 'files'}
        onClick={() => onSelectTab('files')}
        icon={<FileText className="h-4 w-4" />}
        label="Files"
        tab="files"
      />
      <TabButton
        active={activeTab === 'diff'}
        onClick={() => onSelectTab('diff')}
        icon={<FileDiff className="h-4 w-4" />}
        label="Diff"
        tab="diff"
      />
      <TabButton
        active={activeTab === 'agents'}
        onClick={() => onSelectTab('agents')}
        icon={<Bot className="h-4 w-4" />}
        label="Agents"
        tab="agents"
        count={agentCount}
      />
    </div>
  )
}

export function BottomPanelContent({ bottomPanel, repoPath, onOpenToolsSettings }: BottomPanelContentProps) {
  return (
    <div className="flex basis-1/2 min-h-0 flex-col bg-app-bg">
      <div className="flex h-9 shrink-0 items-center bg-app-surface px-3 pt-1">
        <div className={cn('flex items-center gap-2', typeStyle({ role: 'panelTitle' }))}>
          {bottomPanel === 'issue' && <Ticket className="h-3.5 w-3.5 text-app-text-muted" />}
          {bottomPanel === 'processes' && <Activity className="h-3.5 w-3.5 text-app-text-muted" />}
          {bottomPanel === 'github' && <Github className="h-3.5 w-3.5 text-app-text-muted" />}
          {bottomPanel === 'tools' && <PlugZap className="h-3.5 w-3.5 text-app-text-muted" />}
          <span>{bottomPanel === 'issue' ? 'Issue' : bottomPanel === 'processes' ? 'Processes' : bottomPanel === 'github' ? 'GitHub' : 'Tools'}</span>
        </div>
      </div>
      <div className="min-h-0 flex-1">
        {bottomPanel === 'issue' ? (
          <div className={cn('flex h-full items-center justify-center p-4 text-center', typeStyle({ role: 'body', tone: 'secondary' }))}>
            No linked issue
          </div>
        ) : bottomPanel === 'processes' ? (
          <ProcessesPanel repoPath={repoPath} />
        ) : bottomPanel === 'github' ? (
          <GitHubPanel repoPath={repoPath} />
        ) : (
          <ToolsPanel onOpenSettings={onOpenToolsSettings} />
        )}
      </div>
    </div>
  )
}

export function BottomPanelNav({ bottomPanel, onTogglePanel }: BottomPanelNavProps) {
  return (
    <div className="flex h-10 shrink-0 items-center gap-1 bg-app-surface px-2">
      <PanelNavButton
        active={bottomPanel === 'issue'}
        onClick={() => onTogglePanel('issue')}
        icon={<Ticket className="h-4 w-4" />}
        title="Issue"
      />
      <PanelNavButton
        active={bottomPanel === 'processes'}
        onClick={() => onTogglePanel('processes')}
        icon={<Activity className="h-4 w-4" />}
        title="Repo processes"
      />
      <PanelNavButton
        active={bottomPanel === 'github'}
        onClick={() => onTogglePanel('github')}
        icon={<Github className="h-4 w-4" />}
        title="GitHub"
      />
      <PanelNavButton
        active={bottomPanel === 'tools'}
        onClick={() => onTogglePanel('tools')}
        icon={<PlugZap className="h-4 w-4" />}
        title="Tools"
      />
    </div>
  )
}

function TabButton({
  active,
  onClick,
  icon,
  label,
  tab,
  count,
}: {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  label: string
  tab: RightRailTab
  count?: number
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      role="tab"
      id={`right-rail-${tab}-tab`}
      aria-controls={`right-rail-${tab}-panel`}
      aria-selected={active}
      className={cn(
        'flex h-8 items-center justify-center gap-1.5 rounded-md transition-colors duration-fast ease-standard hover:text-app-text',
        typeStyle({ role: 'control', tone: active ? 'primary' : 'secondary' }),
        active ? 'bg-app-bg shadow-[inset_0_0_0_1px_var(--app-inset)]' : 'hover:bg-app-surface-2/65',
      )}
    >
      {icon}
      {label}
      {Boolean(count) && <span className={cn('min-w-4 rounded-full bg-app-accent/14 px-1 text-center', typeStyle({ role: 'micro', tone: 'info' }))}>{count}</span>}
    </button>
  )
}

function PanelNavButton({
  active,
  onClick,
  icon,
  title,
}: {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  title: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex h-8 w-8 items-center justify-center rounded-md transition-colors duration-fast ease-standard ${
        active ? 'bg-app-surface-2 text-app-text' : 'text-app-text-muted hover:bg-app-surface-2/70 hover:text-app-text'
      }`}
      title={title}
      aria-label={title}
    >
      {icon}
    </button>
  )
}
