import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import { ipcMain } from 'electron'
import * as pty from 'node-pty'
import { getMainWindow } from './index'
import { registerProcess, updateProcess } from './processRegistry'

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
  if (process.env.ELECTRON_VITE_DEV_SERVER_URL || process.env.CRANBERRI_DEBUG_TERMINAL) {
    console.debug('[terminal] spawning', shell, 'in', resolvedCwd, `${cols}x${rows}`)
  }
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

const MAX_BUFFER_LENGTH = 200_000
const sessions = new Map<string, { session: TerminalSession; processRecordId: string; disposables: Array<() => void>; buffer: string }>()

function appendBuffer(current: string, chunk: string): string {
  const next = current + chunk
  return next.length > MAX_BUFFER_LENGTH ? next.slice(next.length - MAX_BUFFER_LENGTH) : next
}

export function initTerminalIpc(): void {
  ipcMain.handle('terminal:create', async (_, id: string, cwd: string, cols?: number, rows?: number) => {
    const existing = sessions.get(id)
    if (existing) {
      if (cols && rows) existing.session.resize(cols, rows)
      return { pid: existing.session.pid, buffer: existing.buffer }
    }

    const session = startSession(cwd, cols, rows)
    const resolvedCwd = resolveCwd(cwd)
    const processRecord = registerProcess({
      id: `terminal:${id}`,
      pid: session.pid,
      ppid: process.pid,
      command: 'Cranberri terminal',
      cwd: resolvedCwd,
      terminalWindowId: id,
      repoPath: resolvedCwd,
      kind: 'terminal',
      source: 'terminal',
    })
    const disposables: Array<() => void> = []

    const dataHandler = session.onData((data: string) => {
      const current = sessions.get(id)
      if (current) current.buffer = appendBuffer(current.buffer, data)
      getMainWindow()?.webContents.send('terminal:data', { id, data })
    })
    disposables.push(() => dataHandler.dispose())

    const exitHandler = session.onExit(({ exitCode, signal }: { exitCode: number; signal?: number }) => {
      getMainWindow()?.webContents.send('terminal:exit', { id, exitCode, signal })
      updateProcess(processRecord.id, { status: exitCode === 0 ? 'exited' : 'failed', endedAt: Date.now(), exitCode, signal })
      sessions.delete(id)
    })
    disposables.push(() => exitHandler.dispose())

    sessions.set(id, { session, processRecordId: processRecord.id, disposables, buffer: '' })
    return { pid: session.pid, buffer: '' }
  })

  ipcMain.handle('terminal:snapshot', async (_, id: string) => {
    const existing = sessions.get(id)
    return { buffer: existing?.buffer ?? '' }
  })

  ipcMain.handle('terminal:clear', async (_, id: string) => {
    const existing = sessions.get(id)
    if (existing) existing.buffer = ''
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
    updateProcess(existing.processRecordId, { status: 'killed', endedAt: Date.now(), signal: 'SIGTERM' })
    sessions.delete(id)
  })
}

export function killAllTerminals(): void {
  for (const { session, processRecordId, disposables } of sessions.values()) {
    disposables.forEach((d) => d())
    session.kill()
    updateProcess(processRecordId, { status: 'killed', endedAt: Date.now(), signal: 'SIGTERM' })
  }
  sessions.clear()
}
