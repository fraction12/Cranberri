import { app, ipcMain, shell } from 'electron'
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import https from 'node:https'
import path from 'node:path'
import type { CranberriHealthCheck, CranberriHealthLevel, CranberriHealthReport } from '@/shared/health'

const NODE_VERSION = 'v22.13.1'
const NODE_PKG_URL = `https://nodejs.org/dist/${NODE_VERSION}/node-${NODE_VERSION}.pkg`

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
  return { id, label, level: 'warning', detail: `${command} is unavailable or not responding`, fixAvailable: id === 'node' || id === 'codex-cli' }
}

function download(url: string, destination: string, redirects = 0): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume()
        if (redirects > 5) reject(new Error('Too many redirects while downloading Node installer'))
        else resolve(download(new URL(res.headers.location, url).toString(), destination, redirects + 1))
        return
      }

      if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
        res.resume()
        reject(new Error(`Node installer download failed with HTTP ${res.statusCode ?? 'unknown'}`))
        return
      }

      fs.mkdirSync(path.dirname(destination), { recursive: true })
      const file = fs.createWriteStream(destination)
      res.pipe(file)
      file.on('finish', () => file.close(() => resolve()))
      file.on('error', reject)
    })
    req.on('error', reject)
    req.setTimeout(60_000, () => req.destroy(new Error('Node installer download timed out')))
  })
}

async function installNodeIfMissing(): Promise<CranberriHealthCheck | null> {
  const existing = await run('node', ['--version'])
  if (existing.code === 0) return null

  const installerPath = path.join(app.getPath('userData'), 'installers', `node-${NODE_VERSION}.pkg`)
  if (!fs.existsSync(installerPath)) {
    await download(NODE_PKG_URL, installerPath)
  }
  const openError = await shell.openPath(installerPath)
  if (openError) throw new Error(openError)

  return {
    id: 'node-installer',
    label: 'Node installer',
    level: 'warning',
    detail: `Opened Node ${NODE_VERSION} installer. Finish it, then refresh Cranberri health.`,
  }
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
  const extraChecks: CranberriHealthCheck[] = []
  const nodeInstaller = await installNodeIfMissing()
  if (nodeInstaller) extraChecks.push(nodeInstaller)

  const report = await readHealth()
  return {
    ...report,
    level: aggregate([...report.checks, ...extraChecks]),
    checks: [...report.checks, ...extraChecks],
  }
}

export function initHealthIpc(): void {
  ipcMain.handle('health:read', async () => readHealth())
  ipcMain.handle('health:doctor', async () => runDoctor())
}
