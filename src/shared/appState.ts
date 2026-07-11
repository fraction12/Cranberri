export type WorkspaceWindowType = 'chat' | 'terminal' | 'browser'

export interface BrowserWindowState {
  url: string
  title?: string
  profileId: string
  viewportMode?: 'responsive' | 'mobile' | 'tablet' | 'desktop'
  devServerProcessId?: string
}

export interface WorkspaceWindowState {
  id: string
  type: WorkspaceWindowType
  title: string
  browser?: BrowserWindowState
  projectId?: string
  taskId?: string | null
  checkoutId?: string
}

export interface RepoWorkspaceState {
  windows: WorkspaceWindowState[]
  activeWindowId: string | null
}

export interface PinnedCodexSessionRecord {
  id: string
  title?: string
  archived?: boolean
  updatedAt?: number | null
}

export interface CranberriAppState {
  version: 2
  expandedProjectIds: Record<string, boolean>
  workspacesByProjectId: Record<string, RepoWorkspaceState>
  pinnedCodexSessionsByProjectId: Record<string, PinnedCodexSessionRecord[]>
  expandedRepoIds: Record<string, boolean>
  workspacesByRepoId: Record<string, RepoWorkspaceState>
  pinnedCodexSessionIdsByRepoPath: Record<string, string[]>
  pinnedCodexSessionsByRepoPath: Record<string, PinnedCodexSessionRecord[]>
}

export const DEFAULT_APP_STATE: CranberriAppState = {
  version: 2,
  expandedProjectIds: {},
  workspacesByProjectId: {},
  pinnedCodexSessionsByProjectId: {},
  expandedRepoIds: {},
  workspacesByRepoId: {},
  pinnedCodexSessionIdsByRepoPath: {},
  pinnedCodexSessionsByRepoPath: {},
}
