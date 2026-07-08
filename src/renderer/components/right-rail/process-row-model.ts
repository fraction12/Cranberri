import type { AgentProcessInfo } from '@/shared/processes'

function formatDuration(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000))
  if (totalSeconds < 1) return '<1s'
  if (totalSeconds < 60) return `${totalSeconds}s`
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes < 60) return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`
}

export function processRuntimeLabel(processInfo: Pick<AgentProcessInfo, 'startedAt' | 'endedAt' | 'status'>, now = Date.now()): string | null {
  if (!processInfo.startedAt) return null
  const endTime = processInfo.endedAt ?? now
  const label = processInfo.status === 'running' ? 'running' : 'ran'
  return `${label} ${formatDuration(endTime - processInfo.startedAt)}`
}

export function processRowMetadata(processInfo: AgentProcessInfo, now = Date.now()): string[] {
  return [
    processInfo.status,
    processInfo.source,
    processInfo.pid != null ? `pid ${processInfo.pid}` : 'pid unknown',
    processRuntimeLabel(processInfo, now),
  ].filter((item): item is string => Boolean(item))
}

export function canFocusProcessTerminal(processInfo: Pick<AgentProcessInfo, 'terminalWindowId'>): boolean {
  return Boolean(processInfo.terminalWindowId)
}
