import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ipcMain } from 'electron'
import * as pty from 'node-pty'
import type { AgentProcessInfo } from '../shared/processes'
import { getMainWindow } from './index'
import { registerProcess, updateProcess } from './processRegistry'
import { assertImmutableExecutionBinding, resolveExecutionContext } from './execution-context'
import { taskTerminalCreateRequestSchema } from '../shared/terminal'

const MAX_BUFFER_LENGTH = 200_000

export interface PtyExit {
  exitCode: number
  signal?: number
}

export interface PtyJob {
  readonly pid: number
  readonly completion: Promise<PtyExit>
  snapshot(): string
  clear(): void
  kill(signal?: string): void
  resize(cols: number, rows: number): void
  write(data: string): void
  onData(callback: (data: string) => void): () => void
  onExit(callback: (event: PtyExit) => void): () => void
}

export interface PtyJobOptions {
  cwd: string
  command?: string
  args?: string[]
  env?: NodeJS.ProcessEnv
  cols?: number
  rows?: number
  logPath?: string
  process?: Omit<AgentProcessInfo, 'id' | 'pid' | 'ppid' | 'startedAt' | 'status'> & { id?: string }
}

export function defaultShell(platform: NodeJS.Platform = process.platform): string {
  if (platform === 'win32') return process.env.ComSpec || 'powershell.exe'
  if (process.env.SHELL?.startsWith('/')) return process.env.SHELL
  return ['/bin/zsh', '/bin/bash', '/bin/sh'].find(fs.existsSync) ?? '/bin/sh'
}

function ptyEnvironment(env: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined))
}

function appendBuffer(current: string, chunk: string): string {
  const next = current + chunk
  return next.length > MAX_BUFFER_LENGTH ? next.slice(-MAX_BUFFER_LENGTH) : next
}

export function createPtyJob(options: PtyJobOptions): PtyJob {
  const cwd = fs.realpathSync(options.cwd)
  const command = options.command ?? defaultShell()
  const env = {
    ...options.env,
    TERM: options.env?.TERM ?? 'xterm-256color',
    TERM_PROGRAM: options.env?.TERM_PROGRAM ?? 'Cranberri',
    COLORTERM: options.env?.COLORTERM ?? 'truecolor',
  }
  let logFd: number | null = null
  if (options.logPath) {
    fs.mkdirSync(path.dirname(options.logPath), { recursive: true, mode: 0o700 })
    logFd = fs.openSync(options.logPath, 'a', 0o600)
    fs.chmodSync(options.logPath, 0o600)
  }

  let session: pty.IPty
  try {
    session = pty.spawn(command, options.args ?? [], {
      name: 'xterm-256color',
      cols: options.cols ?? 100,
      rows: options.rows ?? 30,
      cwd,
      env: ptyEnvironment(env),
    })
  } catch (error) {
    if (logFd !== null) fs.closeSync(logFd)
    throw error
  }

  let buffer = ''
  let settled = false
  const dataCallbacks = new Set<(data: string) => void>()
  const exitCallbacks = new Set<(event: PtyExit) => void>()
  const processRecord = options.process
    ? registerProcess({ ...options.process, pid: session.pid, ppid: process.pid })
    : null

  const completion = new Promise<PtyExit>((resolve) => {
    session.onData((data) => {
      buffer = appendBuffer(buffer, data)
      if (logFd !== null) fs.writeSync(logFd, data)
      for (const callback of dataCallbacks) callback(data)
    })
    session.onExit((event) => {
      settled = true
      if (logFd !== null) {
        fs.closeSync(logFd)
        logFd = null
      }
      const exit = { exitCode: event.exitCode, signal: event.signal }
      if (processRecord) {
        updateProcess(processRecord.id, {
          status: event.exitCode === 0 ? 'exited' : 'failed',
          endedAt: Date.now(),
          exitCode: event.exitCode,
          signal: event.signal,
        })
      }
      for (const callback of exitCallbacks) callback(exit)
      resolve(exit)
    })
  })

  return {
    pid: session.pid,
    completion,
    snapshot: () => buffer,
    clear: () => { buffer = '' },
    kill: (signal) => { if (!settled) session.kill(signal) },
    resize: (cols, rows) => session.resize(cols, rows),
    write: (data) => session.write(data),
    onData: (callback) => {
      dataCallbacks.add(callback)
      return () => dataCallbacks.delete(callback)
    },
    onExit: (callback) => {
      exitCallbacks.add(callback)
      return () => exitCallbacks.delete(callback)
    },
  }
}

interface IntegratedTerminalOptions {
  id: string
  cwd: string
  cols?: number
  rows?: number
  script?: string
  env?: NodeJS.ProcessEnv
  process?: PtyJobOptions['process']
  execution?: { taskId: string; checkoutId: string }
}

const sessions = new Map<string, { job: PtyJob; cwd: string; execution?: { taskId: string; checkoutId: string }; processRecordId?: string }>()

export function openIntegratedTerminal(options: IntegratedTerminalOptions): { pid: number; buffer: string } {
  const requestedCwd = fs.realpathSync(options.cwd || os.homedir())
  const existing = sessions.get(options.id)
  if (existing) {
    if (existing.execution && options.execution) assertImmutableExecutionBinding(existing.execution, options.execution, 'Terminal')
    if (existing.cwd !== requestedCwd) throw new Error('Terminal execution context is immutable')
    if (options.cols && options.rows) existing.job.resize(options.cols, options.rows)
    return { pid: existing.job.pid, buffer: existing.job.snapshot() }
  }

  const shell = defaultShell()
  const args = options.script
    ? (process.platform === 'win32' ? ['-NoExit', '-Command', options.script] : ['-lc', `${options.script}; exec ${shell} -l`])
    : []
  const job = createPtyJob({
    cwd: requestedCwd,
    command: shell,
    args,
    env: options.env ?? process.env,
    cols: options.cols,
    rows: options.rows,
    process: options.process ?? {
      id: `terminal:${options.id}`,
      command: 'Cranberri terminal',
      cwd: requestedCwd,
      terminalWindowId: options.id,
      repoPath: requestedCwd,
      kind: 'terminal',
      source: 'terminal',
    },
  })
  sessions.set(options.id, { job, cwd: requestedCwd, execution: options.execution, processRecordId: options.process?.id })
  job.onData((data) => getMainWindow()?.webContents.send('terminal:data', { id: options.id, data }))
  job.onExit(({ exitCode, signal }) => {
    sessions.delete(options.id)
    getMainWindow()?.webContents.send('terminal:exit', { id: options.id, exitCode, signal })
  })
  return { pid: job.pid, buffer: '' }
}

export function initTerminalIpc(): void {
  ipcMain.handle('terminal:create', async (_, id: string, cwd: string, cols?: number, rows?: number) => (
    openIntegratedTerminal({ id, cwd, cols, rows })
  ))
  ipcMain.handle('terminal:task:create', async (_, request: unknown) => {
    const parsed = taskTerminalCreateRequestSchema.parse(request)
    const context = resolveExecutionContext(parsed.taskId)
    return openIntegratedTerminal({
      id: parsed.id,
      cwd: context.cwd,
      cols: parsed.cols,
      rows: parsed.rows,
      execution: { taskId: context.taskId, checkoutId: context.checkoutId },
      process: {
        id: `terminal:${parsed.id}`,
        command: 'Cranberri terminal',
        cwd: context.cwd,
        terminalWindowId: parsed.id,
        repoPath: context.cwd,
        projectId: context.projectId,
        taskId: context.taskId,
        checkoutId: context.checkoutId,
        worktreeId: context.worktreeId ?? undefined,
        kind: 'terminal',
        source: 'terminal',
      },
    })
  })
  ipcMain.handle('terminal:snapshot', async (_, id: string) => ({ buffer: sessions.get(id)?.job.snapshot() ?? '' }))
  ipcMain.handle('terminal:clear', async (_, id: string) => sessions.get(id)?.job.clear())
  ipcMain.handle('terminal:write', async (_, id: string, data: string) => sessions.get(id)?.job.write(data))
  ipcMain.handle('terminal:resize', async (_, id: string, cols: number, rows: number) => sessions.get(id)?.job.resize(cols, rows))
  ipcMain.handle('terminal:kill', async (_, id: string) => {
    sessions.get(id)?.job.kill()
    sessions.delete(id)
  })
}

export function killAllTerminals(): void {
  for (const { job } of sessions.values()) job.kill()
  sessions.clear()
}
