import { z } from 'zod'

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

export interface GitCommitResult {
  title: string
  summary: string
  hash: string
}

export interface GitCommitMessageDraft {
  title: string
  summary: string
}

export const githubPanelKindSchema = z.enum(['repo', 'pulls', 'issues', 'actions', 'branches', 'commits', 'releases'])
export type GitHubPanelKind = z.infer<typeof githubPanelKindSchema>

export interface GitHubPanelItem {
  id: string
  title: string
  subtitle?: string
  state?: string
  url?: string
  author?: string
  createdAt?: string
  updatedAt?: string
  meta?: Record<string, string | number | boolean | null>
}

export interface GitHubPanelData {
  kind: GitHubPanelKind
  items: GitHubPanelItem[]
  fetchedAt: number
  source?: 'octokit' | 'gh' | 'git'
  authenticated?: boolean
}
