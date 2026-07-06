import { app } from 'electron'
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import type { AgentProcessInfo, AgentProcessKind } from '@/shared/processes'

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

function run(command: string, args: string[], timeout = 2500): Promise<string> {
  return new Promise((resolve) => {
    execFile(command, args, { timeout, maxBuffer: 1024 * 1024 }, (error, stdout) => {
      if (error) {
        resolve(stdout?.toString() ?? '')
        return
      }
      resolve(stdout.toString())
    })
  })
}

function classify(command: string): AgentProcessKind {
  const lower = command.toLowerCase()
  if (lower.includes('vite') || lower.includes('next dev') || lower.includes('electron-vite') || lower.includes('npm run dev')) return 'dev-server'
  if (lower.includes('hermes') || lower.includes('codex') || lower.includes('claude') || lower.includes('opencode')) return 'agent'
  if (/\b(zsh|bash|fish|sh)\b/.test(lower)) return 'terminal'
  return 'process'
}

function shouldTrackChild(command: string): boolean {
  return classify(command) !== 'terminal'
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

async function discoverChildrenForRunningTerminals(processes: AgentProcessInfo[], repoPath: string): Promise<AgentProcessInfo[]> {
  const terminals = processes.filter((processInfo) => processInfo.status === 'running' && processInfo.kind === 'terminal' && processInfo.pid)
  if (!terminals.length) return processes

  const psOutput = await run('ps', ['-axo', 'pid=,ppid=,command='])
  const children = new Map<number, Array<{ pid: number; ppid: number; command: string }>>()
  for (const line of psOutput.split('\n')) {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/)
    if (!match) continue
    const processInfo = { pid: Number(match[1]), ppid: Number(match[2]), command: match[3] }
    children.set(processInfo.ppid, [...(children.get(processInfo.ppid) ?? []), processInfo])
  }

  const known = new Map(processes.map((processInfo) => [processInfo.id, processInfo]))
  for (const terminal of terminals) {
    const queue = [...(children.get(terminal.pid as number) ?? [])]
    for (const child of queue) {
      queue.push(...(children.get(child.pid) ?? []))
      if (!shouldTrackChild(child.command)) continue
      const id = `child:${child.pid}`
      const existing = known.get(id)
      known.set(id, {
        id,
        pid: child.pid,
        ppid: child.ppid,
        command: child.command,
        cwd: terminal.cwd,
        repoPath: normalizeRepoPath(repoPath),
        kind: classify(child.command),
        source: terminal.source,
        status: existing?.status === 'running' || !existing ? 'running' : existing.status,
        startedAt: existing?.startedAt ?? Date.now(),
        endedAt: existing?.endedAt,
        exitCode: existing?.exitCode,
        signal: existing?.signal,
      })
    }
  }

  return [...known.values()]
}

export async function listProcessesForRepo(repoPath: string): Promise<AgentProcessInfo[]> {
  const normalized = normalizeRepoPath(repoPath)
  const state = readRegistry()
  const discovered = await discoverChildrenForRunningTerminals(state.processes, normalized)
  const reconciled = discovered.map(reconcileRunningState)
  if (JSON.stringify(reconciled) !== JSON.stringify(state.processes)) {
    writeRegistry({ processes: reconciled.slice(0, 500) })
  }
  return reconciled
    .filter((processInfo) => processInfo.repoPath === normalized)
    .sort((a, b) => {
      if (a.status === 'running' && b.status !== 'running') return -1
      if (a.status !== 'running' && b.status === 'running') return 1
      return b.startedAt - a.startedAt
    })
}
