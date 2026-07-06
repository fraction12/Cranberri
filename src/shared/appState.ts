export type WorkspaceWindowType = 'chat' | 'terminal'

export interface WorkspaceWindowState {
  id: string
  type: WorkspaceWindowType
  title: string
}

export interface RepoWorkspaceState {
  windows: WorkspaceWindowState[]
  activeWindowId: string | null
}

export interface CranberriAppState {
  version: 1
  expandedRepoIds: Record<string, boolean>
  workspacesByRepoId: Record<string, RepoWorkspaceState>
}

export const DEFAULT_APP_STATE: CranberriAppState = {
  version: 1,
  expandedRepoIds: {},
  workspacesByRepoId: {},
}
