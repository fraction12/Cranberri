export interface GitFileStatus {
  path: string
  status: 'added' | 'modified' | 'deleted' | 'renamed' | 'untracked' | 'conflict' | 'staged' | 'tracked'
}

export interface FileTreeNode {
  path: string
  type: 'file' | 'dir'
  children: FileTreeNode[]
}

export interface DiffChange {
  type: 'add' | 'del' | 'normal'
  addLine?: number
  delLine?: number
  ln1?: number
  ln2?: number
  line: string
}

export interface DiffChunk {
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  changes: DiffChange[]
}

export interface DiffFile {
  from?: string
  to: string
  additions: number
  deletions: number
  chunks: DiffChunk[]
}

export interface DiffResult {
  files: DiffFile[]
}

export interface GitHubRepoSummary {
  remoteUrl: string | null
  webUrl: string | null
  owner: string | null
  repo: string | null
  branch: string | null
  tracking: string | null
  ahead: number
  behind: number
  isGitHub: boolean
}
