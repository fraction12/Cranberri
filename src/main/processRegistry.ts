import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import type { AgentProcessInfo } from '@/shared/processes'

interface ProcessRegistryFile {
  processes: AgentProcessInfo[]
}

function registryPath(): string {
  return path.join(app.getPath('userData'), 'process-registry.json')
}

function readRegistry(): ProcessRegistryFile {
  try {
    const raw = fs.readFileSync(registryPath(), 'utf8')
    const parsed = JSON.parse(raw) as Partial<ProcessRegistryFile>
    return { processes: Array.isArray(parsed.processes) ? parsed.processes : [] }
  } catch {
    return { processes: [] }
  }
}

function writeRegistry(state: ProcessRegistryFile): void {
  fs.mkdirSync(path.dirname(registryPath()), { recursive: true })
  fs.writeFileSync(registryPath(), JSON.stringify(state, null, 2))
}

function normalizeRepoPath(repoPath: string): string {
  return path.resolve(repoPath)
}

function isProcessAlive(pid: number | null | undefined): boolean {
  if (!pid) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function reconcileRunningState(processInfo: AgentProcessInfo): AgentProcessInfo {
  if (processInfo.status !== 'running') return processInfo
  if (isProcessAlive(processInfo.pid)) return processInfo
  return {
    ...processInfo,
    status: 'unknown',
    endedAt: processInfo.endedAt ?? Date.now(),
  }
}

export function registerProcess(processInfo: Omit<AgentProcessInfo, 'id' | 'startedAt' | 'status'> & Partial<Pick<AgentProcessInfo, 'id' | 'startedAt' | 'status'>>): AgentProcessInfo {
  const now = Date.now()
  const record: AgentProcessInfo = {
    ...processInfo,
    id: processInfo.id ?? crypto.randomUUID(),
    repoPath: normalizeRepoPath(processInfo.repoPath),
    cwd: processInfo.cwd ? path.resolve(processInfo.cwd) : undefined,
    startedAt: processInfo.startedAt ?? now,
    status: processInfo.status ?? 'running',
  }
  const state = readRegistry()
  const existingIndex = state.processes.findIndex((item) => item.id === record.id)
  const processes = existingIndex >= 0 ? [...state.processes] : [record, ...state.processes]
  if (existingIndex >= 0) processes[existingIndex] = { ...processes[existingIndex], ...record }
  writeRegistry({ processes: processes.slice(0, 500) })
  return record
}

export function updateProcess(id: string, patch: Partial<AgentProcessInfo>): void {
  const state = readRegistry()
  const processes = state.processes.map((processInfo) => processInfo.id === id ? { ...processInfo, ...patch } : processInfo)
  writeRegistry({ processes })
}

export function listProcessesForRepo(repoPath: string): AgentProcessInfo[] {
  const normalized = normalizeRepoPath(repoPath)
  const state = readRegistry()
  const reconciled = state.processes.map(reconcileRunningState)
  if (JSON.stringify(reconciled) !== JSON.stringify(state.processes)) {
    writeRegistry({ processes: reconciled })
  }
  return reconciled
    .filter((processInfo) => processInfo.repoPath === normalized)
    .sort((a, b) => {
      if (a.status === 'running' && b.status !== 'running') return -1
      if (a.status !== 'running' && b.status === 'running') return 1
      return b.startedAt - a.startedAt
    })
}
