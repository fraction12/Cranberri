import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import { ipcMain } from 'electron'
import * as pty from 'node-pty'
import { getMainWindow } from './index'
import type { AgentProcessInfo } from '@/shared/processes'

export interface TerminalSession {
  readonly pid: number
  readonly onData: (cb: (data: string) => void) => { dispose: () => void }
  readonly onExit: (cb: (event: { exitCode: number; signal?: number }) => void) => { dispose: () => void }
  kill(signal?: string): void
  resize(cols: number, rows: number): void
  write(data: string): void
}

function defaultShell(platform: NodeJS.Platform = process.platform): string {
  if (platform === 'win32') return process.env.ComSpec || 'powershell.exe'
  if (process.env.SHELL && process.env.SHELL.startsWith('/')) return process.env.SHELL
  for (const shell of ['/bin/zsh', '/bin/bash', '/bin/sh']) {
    if (fs.existsSync(shell)) return shell
  }
  return '/bin/sh'
}

function buildEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const base = { ...env }
  if (!base.TERM) base.TERM = 'xterm-256color'
  if (!base.TERM_PROGRAM) base.TERM_PROGRAM = 'Cranberri'
  if (!base.COLORTERM) base.COLORTERM = 'truecolor'
  return base
}

function resolveCwd(cwd: string): string {
  return path.resolve(cwd || os.homedir())
}

function startSession(cwd: string, cols = 100, rows = 30): TerminalSession {
  const shell = defaultShell()
  const resolvedCwd = resolveCwd(cwd)
  console.log('[terminal] spawning', shell, 'in', resolvedCwd, `${cols}x${rows}`)
  const session = pty.spawn(shell, [], {
    name: 'xterm-256color',
    cols,
    rows,
    cwd: resolvedCwd,
    env: buildEnv(),
  })

  return {
    pid: session.pid,
    onData: (cb) => session.onData(cb),
    onExit: (cb) => session.onExit(cb),
    kill: (signal) => session.kill(signal),
    resize: (cols, rows) => session.resize(cols, rows),
    write: (data) => session.write(data),
  }
}

const sessions = new Map<string, { session: TerminalSession; cwd: string; disposables: Array<() => void> }>()

export function initTerminalIpc(): void {
  ipcMain.handle('terminal:create', async (_, id: string, cwd: string, cols?: number, rows?: number) => {
    const existing = sessions.get(id)
    if (existing) {
      existing.disposables.forEach((d) => d())
      existing.session.kill()
    }

    const session = startSession(cwd, cols, rows)
    const disposables: Array<() => void> = []

    const dataHandler = session.onData((data: string) => {
      getMainWindow()?.webContents.send('terminal:data', { id, data })
    })
    disposables.push(() => dataHandler.dispose())

    const exitHandler = session.onExit(({ exitCode, signal }: { exitCode: number; signal?: number }) => {
      getMainWindow()?.webContents.send('terminal:exit', { id, exitCode, signal })
      sessions.delete(id)
    })
    disposables.push(() => exitHandler.dispose())

    sessions.set(id, { session, cwd: resolveCwd(cwd), disposables })
    return { pid: session.pid }
  })

  ipcMain.handle('terminal:write', async (_, id: string, data: string) => {
    sessions.get(id)?.session.write(data)
  })

  ipcMain.handle('terminal:resize', async (_, id: string, cols: number, rows: number) => {
    sessions.get(id)?.session.resize(cols, rows)
  })

  ipcMain.handle('terminal:kill', async (_, id: string) => {
    const existing = sessions.get(id)
    if (!existing) return
    existing.disposables.forEach((d) => d())
    existing.session.kill()
    sessions.delete(id)
  })
}

export function listTerminalProcesses(): AgentProcessInfo[] {
  return [...sessions.values()].map(({ session, cwd }) => ({
    pid: session.pid,
    ppid: process.pid,
    command: 'Cranberri terminal',
    cwd,
    kind: 'terminal',
  }))
}

export function killAllTerminals(): void {
  for (const { session, disposables } of sessions.values()) {
    disposables.forEach((d) => d())
    session.kill()
  }
  sessions.clear()
}
