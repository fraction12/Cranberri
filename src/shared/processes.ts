export type AgentProcessKind = 'dev-server' | 'agent' | 'terminal' | 'process'
export type AgentProcessStatus = 'running' | 'exited' | 'killed' | 'failed' | 'unknown'
export type AgentProcessSource = 'codex' | 'terminal' | 'app-server' | 'manual'

export interface AgentProcessInfo {
  id: string
  pid: number | null
  ppid?: number | null
  command: string
  cwd?: string
  repoPath: string
  kind: AgentProcessKind
  source: AgentProcessSource
  status: AgentProcessStatus
  startedAt: number
  endedAt?: number
  exitCode?: number | null
  signal?: number | string | null
}
