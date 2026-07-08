import type { AgentProcessInfo } from '@/shared/processes'

function formatTime(value: number | undefined): string | null {
  if (!value) return null
  return new Date(value).toISOString()
}

export function processChatContext(processInfo: AgentProcessInfo): string {
  return [
    'Repo process context:',
    `Process: ${processInfo.command || processInfo.id}`,
    `ID: ${processInfo.id}`,
    `Kind: ${processInfo.kind}`,
    `Status: ${processInfo.status}`,
    `PID: ${processInfo.pid ?? 'unknown'}`,
    processInfo.ppid != null ? `Parent PID: ${processInfo.ppid}` : null,
    `Repo: ${processInfo.repoPath}`,
    processInfo.cwd ? `CWD: ${processInfo.cwd}` : null,
    processInfo.terminalWindowId ? `Terminal window: ${processInfo.terminalWindowId}` : null,
    `Source: ${processInfo.source}`,
    formatTime(processInfo.startedAt) ? `Started: ${formatTime(processInfo.startedAt)}` : null,
    formatTime(processInfo.endedAt) ? `Ended: ${formatTime(processInfo.endedAt)}` : null,
    processInfo.exitCode != null ? `Exit code: ${processInfo.exitCode}` : null,
    processInfo.signal != null ? `Signal: ${processInfo.signal}` : null,
  ].filter((line): line is string => Boolean(line)).join('\n')
}
