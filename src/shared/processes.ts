export interface AgentProcessInfo {
  pid: number
  ppid: number
  command: string
  cwd?: string
  kind: 'dev-server' | 'agent' | 'terminal' | 'process'
}
