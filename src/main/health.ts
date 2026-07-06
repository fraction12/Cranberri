import { app, ipcMain } from 'electron'
import { execFile } from 'node:child_process'
import type { CranberriHealthCheck, CranberriHealthLevel, CranberriHealthReport } from '@/shared/health'

function run(command: string, args: string[], timeout = 8000): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve) => {
    execFile(command, args, { timeout, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      resolve({
        stdout: stdout?.toString() ?? '',
        stderr: stderr?.toString() ?? '',
        code: error ? 1 : 0,
      })
    })
  })
}

async function commandCheck(id: string, label: string, command: string, args: string[] = ['--version']): Promise<CranberriHealthCheck> {
  const result = await run(command, args)
  if (result.code === 0) {
    return { id, label, level: 'ok', detail: (result.stdout || result.stderr).trim().split('\n')[0] || `${command} is available` }
  }
  return { id, label, level: 'warning', detail: `${command} is unavailable or not responding`, fixAvailable: id === 'codex-cli' }
}

function aggregate(checks: CranberriHealthCheck[]): CranberriHealthLevel {
  if (checks.some((check) => check.level === 'error')) return 'error'
  if (checks.some((check) => check.level === 'warning')) return 'warning'
  return 'ok'
}

async function readHealth(): Promise<CranberriHealthReport> {
  const checks: CranberriHealthCheck[] = [
    { id: 'app', label: 'Cranberri app', level: 'ok', detail: `Version ${app.getVersion()}` },
    await commandCheck('node', 'Node runtime', 'node'),
    await commandCheck('git', 'Git CLI', 'git'),
    await commandCheck('codex-cli', 'Codex CLI', 'codex', ['--version']),
  ]

  return {
    level: aggregate(checks),
    checkedAt: Date.now(),
    checks,
  }
}

async function runDoctor(): Promise<CranberriHealthReport> {
  // Doctor is intentionally conservative for now. No surprise installs, no process kills.
  // Future quick fixes can hang off individual check ids with explicit user-triggered actions.
  return readHealth()
}

export function initHealthIpc(): void {
  ipcMain.handle('health:read', async () => readHealth())
  ipcMain.handle('health:doctor', async () => runDoctor())
}
