import { app, ipcMain, shell } from 'electron'
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import https from 'node:https'
import path from 'node:path'
import { buildInfo } from '../shared/buildInfo'
import type { CranberriDiagnosticsReport, CranberriHealthCheck, CranberriHealthLevel, CranberriHealthReport } from '../shared/health'
import { nativeHelperSettingsTargetSchema } from '../shared/nativeHelpers'
import { electronLogPath, getTelemetryStore, telemetryPath } from './telemetry'
import { localStorePath } from './store'
import { nativeHelperStatusToHealthCheck, openNativeHelperSettings, readNativeHelperStatuses } from './nativeHelpers'
import { resolveCodexRuntime } from './codex/env'

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

export async function moduleLoadCheck(id: string, label: string, moduleName: string): Promise<CranberriHealthCheck> {
  try {
    await import(moduleName)
    return { id, label, level: 'ok', detail: `${moduleName} loads in the main process` }
  } catch (error) {
    return {
      id,
      label,
      level: 'error',
      detail: error instanceof Error ? error.message : `${moduleName} failed to load`,
    }
  }
}

export function pathCheck(id: string, label: string, filePath: string, level: CranberriHealthLevel = 'warning'): CranberriHealthCheck {
  if (fs.existsSync(filePath)) {
    return { id, label, level: 'ok', detail: filePath }
  }
  return { id, label, level, detail: `Missing: ${filePath}` }
}

export async function readHealth(): Promise<CranberriHealthReport> {
  const nativeHelpers = await readNativeHelperStatuses()
  const codexCheck: CranberriHealthCheck = await resolveCodexRuntime().then(
    (runtime) => ({ id: 'codex-cli', label: 'Codex CLI', level: 'ok', detail: `${runtime.version ?? 'Unknown version'} — ${runtime.executable}` }),
    (error) => ({ id: 'codex-cli', label: 'Codex CLI', level: 'warning', detail: error instanceof Error ? error.message : 'Codex was not found in your login shell' }),
  )
  const checks: CranberriHealthCheck[] = [
    { id: 'app', label: 'Cranberri app', level: 'ok', detail: `Version ${app.getVersion()}` },
    await commandCheck('node', 'Node runtime', 'node'),
    await commandCheck('git', 'Git CLI', 'git'),
    codexCheck,
    await moduleLoadCheck('native-better-sqlite3', 'better-sqlite3 native module', 'better-sqlite3'),
    await moduleLoadCheck('native-node-pty', 'node-pty native module', 'node-pty'),
    await moduleLoadCheck('native-bufferutil', 'bufferutil native module', 'bufferutil'),
    await moduleLoadCheck('native-utf-8-validate', 'utf-8-validate native module', 'utf-8-validate'),
    pathCheck('sqlite-store', 'Local SQLite event store', localStorePath(app.getPath('userData'))),
    pathCheck('renderer-build', 'Renderer build output', app.isPackaged ? path.join(process.resourcesPath, 'app.asar', 'out', 'renderer') : path.join(__dirname, '../renderer'), app.isPackaged ? 'error' : 'warning'),
    ...nativeHelpers.map(nativeHelperStatusToHealthCheck),
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

export async function readDiagnostics(): Promise<CranberriDiagnosticsReport> {
  const health = await readHealth()
  const nativeHelpers = await readNativeHelperStatuses()
  return {
    checkedAt: Date.now(),
    health,
    build: buildInfo,
    runtime: {
      platform: process.platform,
      arch: process.arch,
      electron: process.versions.electron ?? 'unknown',
      chrome: process.versions.chrome ?? 'unknown',
      node: process.versions.node,
      v8: process.versions.v8,
      packaged: app.isPackaged,
    },
    paths: {
      app: app.getAppPath(),
      userData: app.getPath('userData'),
      resources: process.resourcesPath,
      debugTelemetry: telemetryPath(),
      electronLog: electronLogPath(),
      sqlite: localStorePath(app.getPath('userData')),
    },
    nativeHelpers,
    recentEvents: getTelemetryStore().readEvents(25),
  }
}

export function initHealthIpc(): void {
  ipcMain.handle('health:read', async () => readHealth())
  ipcMain.handle('health:doctor', async () => runDoctor())
  ipcMain.handle('health:diagnostics', async () => readDiagnostics())
  ipcMain.handle('native-helpers:open-settings', async (_, target: unknown) => openNativeHelperSettings(nativeHelperSettingsTargetSchema.parse(target)))
}
