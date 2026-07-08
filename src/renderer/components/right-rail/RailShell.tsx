import { Activity, FileDiff, FileText, Github, PlugZap, Ticket } from 'lucide-react'
import { GitHubPanel } from './GitHubPanel'
import { ProcessesPanel } from './ProcessesPanel'
import { ToolsPanel } from './ToolsPanel'

export type RightRailTab = 'files' | 'diff'
export type BottomPanelKind = 'issue' | 'processes' | 'github' | 'tools'

interface RightRailTabsProps {
  activeTab: RightRailTab
  onSelectTab: (tab: RightRailTab) => void
}

interface BottomPanelContentProps {
  bottomPanel: BottomPanelKind
  repoPath: string | null
}

interface BottomPanelNavProps {
  bottomPanel: BottomPanelKind | null
  onTogglePanel: (panel: BottomPanelKind) => void
}

export function RightRailTabs({ activeTab, onSelectTab }: RightRailTabsProps) {
  return (
    <div className="flex h-9 shrink-0 border-b border-app-border">
      <TabButton
        active={activeTab === 'files'}
        onClick={() => onSelectTab('files')}
        icon={<FileText className="h-4 w-4" />}
        label="Files"
      />
      <TabButton
        active={activeTab === 'diff'}
        onClick={() => onSelectTab('diff')}
        icon={<FileDiff className="h-4 w-4" />}
        label="Diff"
      />
    </div>
  )
}

export function BottomPanelContent({ bottomPanel, repoPath }: BottomPanelContentProps) {
  return (
    <div className="basis-1/2 min-h-0 border-t border-app-border bg-app-bg">
      <div className="flex h-8 shrink-0 items-center border-b border-app-border bg-app-surface-2 px-3">
        <div className="flex items-center gap-2 text-xs font-medium text-app-text">
          {bottomPanel === 'issue' && <Ticket className="h-3.5 w-3.5 text-app-text-muted" />}
          {bottomPanel === 'processes' && <Activity className="h-3.5 w-3.5 text-app-text-muted" />}
          {bottomPanel === 'github' && <Github className="h-3.5 w-3.5 text-app-text-muted" />}
          {bottomPanel === 'tools' && <PlugZap className="h-3.5 w-3.5 text-app-text-muted" />}
          <span>{bottomPanel === 'issue' ? 'Issue' : bottomPanel === 'processes' ? 'Processes' : bottomPanel === 'github' ? 'GitHub' : 'Tools'}</span>
        </div>
      </div>
      {bottomPanel === 'issue' ? (
        <div className="p-3 text-sm text-app-text-muted">
          No Linear issue linked.
        </div>
      ) : bottomPanel === 'processes' ? (
        <ProcessesPanel repoPath={repoPath} />
      ) : bottomPanel === 'github' ? (
        <GitHubPanel repoPath={repoPath} />
      ) : (
        <ToolsPanel />
      )}
    </div>
  )
}

export function BottomPanelNav({ bottomPanel, onTogglePanel }: BottomPanelNavProps) {
  return (
    <div className="flex h-10 shrink-0 items-center gap-1 border-t border-app-border px-3 text-[11px] text-app-text-muted">
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
}: {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  label: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-1 items-center justify-center gap-1.5 text-xs hover:text-app-text ${
        active ? 'bg-app-surface-2 text-app-text' : 'text-app-text-muted'
      }`}
    >
      {icon}
      {label}
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
      className={`rounded-lg p-2 hover:bg-app-surface-2 hover:text-app-text ${
        active ? 'bg-app-surface-2 text-app-text' : 'text-app-text-muted'
      }`}
      title={title}
    >
      {icon}
    </button>
  )
}
