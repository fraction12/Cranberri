import { execFile } from 'node:child_process'
import path from 'node:path'
import { ipcMain } from 'electron'
import type { AgentProcessInfo } from '@/shared/processes'
import { listTerminalProcesses } from './terminal'

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

function normalizeRepoPath(repoPath: string): string {
  return path.resolve(repoPath)
}

function isInsideRepo(cwd: string | undefined, repoPath: string): boolean {
  if (!cwd) return false
  const resolvedCwd = path.resolve(cwd)
  const resolvedRepo = normalizeRepoPath(repoPath)
  return resolvedCwd === resolvedRepo || resolvedCwd.startsWith(`${resolvedRepo}${path.sep}`)
}

function classify(command: string): AgentProcessInfo['kind'] {
  const lower = command.toLowerCase()
  if (lower.includes('vite') || lower.includes('next dev') || lower.includes('electron-vite') || lower.includes('npm run dev')) return 'dev-server'
  if (lower.includes('codex') || lower.includes('claude') || lower.includes('opencode') || lower.includes('hermes')) return 'agent'
  if (lower.includes('zsh') || lower.includes('bash') || lower.includes('fish') || lower.includes('node-pty')) return 'terminal'
  return 'process'
}

async function listCwdProcesses(repoPath: string): Promise<AgentProcessInfo[]> {
  const output = await run('lsof', ['-n', '-a', '-d', 'cwd', '-F', 'pc', '+D', normalizeRepoPath(repoPath)])
  const processes: AgentProcessInfo[] = []
  let current: Partial<AgentProcessInfo> | null = null

  for (const line of output.split('\n')) {
    if (!line) continue
    const tag = line[0]
    const value = line.slice(1)
    if (tag === 'p') {
      if (current?.pid && current.command) processes.push(current as AgentProcessInfo)
      current = { pid: Number(value), ppid: 0, command: '', kind: 'process' }
    } else if (tag === 'c' && current) {
      current.command = value
      current.kind = classify(value)
    }
  }
  if (current?.pid && current.command) processes.push(current as AgentProcessInfo)

  return processes
}

async function hydrateCommands(processes: AgentProcessInfo[]): Promise<AgentProcessInfo[]> {
  if (!processes.length) return processes
  const psOutput = await run('ps', ['-axo', 'pid=,ppid=,command='])
  const byPid = new Map<number, { ppid: number; command: string }>()
  for (const line of psOutput.split('\n')) {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/)
    if (!match) continue
    byPid.set(Number(match[1]), { ppid: Number(match[2]), command: match[3] })
  }
  return processes.map((processInfo) => {
    const full = byPid.get(processInfo.pid)
    const command = full?.command ?? processInfo.command
    return {
      ...processInfo,
      ppid: full?.ppid ?? processInfo.ppid,
      command,
      kind: processInfo.kind === 'terminal' ? 'terminal' : classify(command),
    }
  })
}

async function appProcessIds(): Promise<Set<number>> {
  const psOutput = await run('ps', ['-axo', 'pid=,ppid=,command='])
  const children = new Map<number, number[]>()
  const appIds = new Set<number>([process.pid])

  for (const line of psOutput.split('\n')) {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/)
    if (!match) continue
    const pid = Number(match[1])
    const ppid = Number(match[2])
    const command = match[3]
    children.set(ppid, [...(children.get(ppid) ?? []), pid])
    if (command.includes('electron-vite') || command.includes('out/main/index.cjs')) {
      appIds.add(pid)
    }
  }

  const queue = [...appIds]
  for (const pid of queue) {
    for (const childPid of children.get(pid) ?? []) {
      if (appIds.has(childPid)) continue
      appIds.add(childPid)
      queue.push(childPid)
    }
  }

  return appIds
}

function isAppLevelProcess(processInfo: AgentProcessInfo, appIds: Set<number>): boolean {
  if (appIds.has(processInfo.pid) || appIds.has(processInfo.ppid)) return true
  const command = processInfo.command.toLowerCase()
  return command.includes('electron-vite') || command.includes('out/main/index.cjs') || command.includes('cranberri')
}

export function initProcessesIpc(): void {
  ipcMain.handle('processes:list', async (_, repoPath: string) => {
    const terminalProcesses = listTerminalProcesses().filter((processInfo) => isInsideRepo(processInfo.cwd, repoPath))
    const cwdProcesses = await listCwdProcesses(repoPath)
    const byPid = new Map<number, AgentProcessInfo>()
    for (const processInfo of [...terminalProcesses, ...cwdProcesses]) {
      byPid.set(processInfo.pid, processInfo)
    }
    const hydrated = await hydrateCommands([...byPid.values()])
    const appIds = await appProcessIds()
    return { processes: hydrated.filter((processInfo) => !isAppLevelProcess(processInfo, appIds)) }
  })
}
