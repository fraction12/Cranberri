import { app, ipcMain, BrowserWindow } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import https from 'node:https'
import { buildInfo } from '@/shared/buildInfo'
import type { UpdateInfo, UpdateProgress, InstallResult, InstallManifest } from '@/shared/update'
import { updateInfoSchema, updateProgressSchema, installResultSchema, installManifestSchema } from '@/shared/update'

const UPDATE_CHANNEL = 'updater:event'
const RELEASES_API_URL = 'https://api.github.com/repos/fraction12/Cranberri/releases/latest'
const USER_AGENT = 'CranberriUpdater/0.1.0'

function getUserData(...segments: string[]): string {
  return path.join(app.getPath('userData'), ...segments)
}

function getMainWindow(): Electron.BrowserWindow | null {
  return BrowserWindow.getAllWindows()[0] ?? null
}

function broadcast(event: unknown): void {
  const win = getMainWindow()
  if (win && !win.isDestroyed()) {
    win.webContents.send(UPDATE_CHANNEL, event)
  }
}

function emitProgress(progress: UpdateProgress): void {
  broadcast({ type: 'progress', progress: updateProgressSchema.parse(progress) })
}

function emitStatus(status: UpdateInfo): void {
  broadcast({ type: 'status', status: updateInfoSchema.parse(status) })
}

interface ReleaseAsset {
  name: string
  browser_download_url: string
}

interface GitHubRelease {
  tag_name: string
  target_commitish: string
  html_url: string
  assets: ReleaseAsset[]
}

interface ReleaseUpdate {
  release: GitHubRelease
  asset: ReleaseAsset
  latestCommit: string
}

function requestBuffer(url: string, redirectCount = 0): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/vnd.github+json' } }, (res) => {
      const location = res.headers.location
      if (location && res.statusCode && res.statusCode >= 300 && res.statusCode < 400) {
        res.resume()
        if (redirectCount > 5) reject(new Error('Too many redirects while downloading update'))
        else resolve(requestBuffer(new URL(location, url).toString(), redirectCount + 1))
        return
      }

      if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
        const chunks: Buffer[] = []
        res.on('data', (chunk: Buffer) => chunks.push(chunk))
        res.on('end', () => reject(new Error(`Request failed ${res.statusCode}: ${Buffer.concat(chunks).toString('utf8').slice(0, 300)}`)))
        return
      }

      const chunks: Buffer[] = []
      res.on('data', (chunk: Buffer) => chunks.push(chunk))
      res.on('end', () => resolve(Buffer.concat(chunks)))
    })
    req.on('error', reject)
    req.setTimeout(30_000, () => {
      req.destroy(new Error('Request timed out'))
    })
  })
}

async function fetchLatestRelease(): Promise<GitHubRelease> {
  const buffer = await requestBuffer(RELEASES_API_URL)
  const json = JSON.parse(buffer.toString('utf8')) as Partial<GitHubRelease>
  return {
    tag_name: typeof json.tag_name === 'string' ? json.tag_name : '',
    target_commitish: typeof json.target_commitish === 'string' ? json.target_commitish : '',
    html_url: typeof json.html_url === 'string' ? json.html_url : '',
    assets: Array.isArray(json.assets)
      ? json.assets.flatMap((asset) => {
        const value = asset as Partial<ReleaseAsset>
        return typeof value.name === 'string' && typeof value.browser_download_url === 'string'
          ? [{ name: value.name, browser_download_url: value.browser_download_url }]
          : []
      })
      : [],
  }
}

function pickReleaseAsset(release: GitHubRelease): ReleaseAsset | null {
  return release.assets.find((asset) => /Cranberri-.*arm64-mac\.zip$/.test(asset.name))
    ?? release.assets.find((asset) => /Cranberri-.*arm64\.dmg$/.test(asset.name))
    ?? null
}

interface GitRefResponse {
  object?: {
    sha?: string
    type?: string
  }
}

interface GitTagResponse {
  object?: {
    sha?: string
  }
}

async function resolveReleaseCommit(release: GitHubRelease): Promise<string> {
  if (/^[a-f0-9]{40}$/i.test(release.target_commitish)) return release.target_commitish
  if (!release.tag_name) return release.target_commitish

  try {
    const encodedTag = encodeURIComponent(release.tag_name)
    const refBuffer = await requestBuffer(`https://api.github.com/repos/fraction12/Cranberri/git/ref/tags/${encodedTag}`)
    const ref = JSON.parse(refBuffer.toString('utf8')) as GitRefResponse
    const sha = ref.object?.sha
    if (!sha) return release.target_commitish || release.tag_name
    if (ref.object?.type !== 'tag') return sha

    const tagBuffer = await requestBuffer(`https://api.github.com/repos/fraction12/Cranberri/git/tags/${sha}`)
    const tag = JSON.parse(tagBuffer.toString('utf8')) as GitTagResponse
    return tag.object?.sha ?? sha
  } catch {
    return release.target_commitish || release.tag_name
  }
}

async function resolveReleaseUpdate(): Promise<ReleaseUpdate | null> {
  const release = await fetchLatestRelease()
  const asset = pickReleaseAsset(release)
  if (!asset) return null
  return { release, asset, latestCommit: await resolveReleaseCommit(release) }
}

type UpdateBlockedReasonLiteral = 'developmentMode' | 'noRelease' | 'noArtifact' | 'releaseCheckFailed' | 'comparisonUnknown'

async function performCheck(): Promise<UpdateInfo> {
  if (!buildInfo.packaged) {
    return blocked('developmentMode', 'Updates install packaged app builds. Development builds update through git.')
  }

  try {
    const update = await resolveReleaseUpdate()
    if (!update) {
      return blocked('noArtifact', 'No downloadable Cranberri macOS arm64 artifact was found on the latest GitHub release.')
    }
    if (!update.latestCommit) {
      return blocked('noRelease', 'No GitHub release metadata is available for Cranberri.')
    }
    if (update.latestCommit === buildInfo.commit || update.release.tag_name === buildInfo.commit.slice(0, 7)) {
      return {
        status: 'upToDate',
        currentCommit: buildInfo.commit,
        latestCommit: update.latestCommit,
        commitsBehind: 0,
        sourceRepoPath: update.asset.name,
        sourceRepoDirty: null,
        blockedReason: null,
        blockedMessage: null,
        phase: null,
        phaseMessage: null,
        failedPhase: null,
        failureMessage: null,
        logPath: null,
      }
    }
    return {
      status: 'updateAvailable',
      currentCommit: buildInfo.commit,
      latestCommit: update.latestCommit,
      commitsBehind: null,
      sourceRepoPath: update.asset.name,
      sourceRepoDirty: null,
      blockedReason: null,
      blockedMessage: null,
      phase: null,
      phaseMessage: null,
      failedPhase: null,
      failureMessage: null,
      logPath: null,
    }
  } catch (error) {
    return blocked('releaseCheckFailed', error instanceof Error ? error.message : String(error))
  }

  function blocked(reason: UpdateBlockedReasonLiteral, message: string, latestCommit: string | null = null): UpdateInfo {
    return {
      status: 'blocked',
      currentCommit: buildInfo.commit,
      latestCommit,
      commitsBehind: null,
      sourceRepoPath: null,
      sourceRepoDirty: null,
      blockedReason: reason,
      blockedMessage: message,
      phase: null,
      phaseMessage: null,
      failedPhase: null,
      failureMessage: null,
      logPath: null,
    }
  }
}

let currentStatus: UpdateInfo = updateInfoSchema.parse({
  status: 'unknown',
  currentCommit: buildInfo.commit,
  latestCommit: null,
  commitsBehind: null,
  sourceRepoPath: null,
  sourceRepoDirty: null,
  blockedReason: null,
  blockedMessage: null,
  phase: null,
  phaseMessage: null,
  failedPhase: null,
  failureMessage: null,
  logPath: null,
})

function setStatus(partial: Partial<UpdateInfo>): UpdateInfo {
  currentStatus = updateInfoSchema.parse({ ...currentStatus, ...partial })
  emitStatus(currentStatus)
  return currentStatus
}

async function installUpdate(): Promise<InstallResult> {
  if (currentStatus.status !== 'updateAvailable' && currentStatus.status !== 'failed') {
    return { success: false, phase: null, message: 'No update is available.', logPath: null }
  }

  const stagingDir = getUserData('updater-staging')
  const logPath = path.join(stagingDir, 'build.log')
  fs.mkdirSync(stagingDir, { recursive: true })

  setStatus({ status: 'building', phase: 'preparing', phaseMessage: 'Preparing update download', logPath })

  try {
    emitProgress({ phase: 'preparing', message: 'Finding latest release artifact', percent: 5 })
    const update = await resolveReleaseUpdate()
    if (!update) throw new Error('No downloadable Cranberri macOS arm64 artifact was found on the latest GitHub release')
    if (update.latestCommit === buildInfo.commit || update.release.tag_name === buildInfo.commit.slice(0, 7)) {
      setStatus({
        status: 'upToDate',
        currentCommit: buildInfo.commit,
        latestCommit: update.latestCommit,
        commitsBehind: 0,
        sourceRepoPath: update.asset.name,
        sourceRepoDirty: null,
        blockedReason: null,
        blockedMessage: null,
        phase: null,
        phaseMessage: null,
        failedPhase: null,
        failureMessage: null,
        logPath,
      })
      return { success: true, phase: 'upToDate' as const, message: 'Already up to date after refresh.', logPath }
    }

    emitProgress({ phase: 'fetching', message: `Downloading ${update.asset.name}`, percent: 20 })
    const stagedAppPath = await stageReleaseAsset(update.asset, stagingDir, logPath)
    emitProgress({ phase: 'readyToInstall', message: 'Ready to install', percent: 95 })
    setStatus({ status: 'readyToInstall', phase: 'readyToInstall', phaseMessage: 'Ready to install' })

    const currentAppPath = getCurrentAppPath()
    const backupAppPath = getUserData('updater-backup', 'Cranberri.app')
    const resultManifestPath = getUserData('updater-result.json')

    const manifest: InstallManifest = {
      currentAppPath,
      stagedAppPath,
      backupAppPath,
      logPath,
      resultManifestPath,
      relaunchTarget: currentAppPath,
    }

    const validated = installManifestSchema.parse(manifest)
    const manifestPath = getUserData('updater-manifest.json')
    fs.writeFileSync(manifestPath, JSON.stringify(validated, null, 2))

    emitProgress({ phase: 'backingUp', message: 'Writing install manifest and quitting app', percent: 98 })
    setStatus({ status: 'installing', phase: 'replacing', phaseMessage: 'Installing update and relaunching' })

    const appPath = app.getAppPath()
    const helperPath = appPath.endsWith('app.asar')
      ? path.join(appPath.replace(/app\.asar$/, 'app.asar.unpacked'), 'out', 'updater', 'install-helper.mjs')
      : path.join(__dirname, '../updater/install-helper.mjs')
    const nodeBinary = await findNodeBinary()
    const helperRunner = nodeBinary ?? process.execPath
    const helperEnv = nodeBinary
      ? { ...process.env, CRANBERRI_UPDATER: '1' }
      : { ...process.env, CRANBERRI_UPDATER: '1', ELECTRON_RUN_AS_NODE: '1' }
    const helperLogPath = path.join(path.dirname(resultManifestPath), 'install-helper.log')
    const helperOut = fs.openSync(helperLogPath, 'a')
    spawn(helperRunner, [helperPath, manifestPath, String(process.pid)], {
      detached: true,
      stdio: ['ignore', helperOut, helperOut],
      env: helperEnv,
    }).unref()
    fs.closeSync(helperOut)

    app.quit()
    return { success: true, phase: 'relaunching', message: 'Quitting to install update', logPath }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    setStatus({ status: 'failed', failedPhase: currentStatus.phase, failureMessage: message, logPath })
    return { success: false, phase: currentStatus.phase, message, logPath }
  }
}

const toolCache = new Map<string, string | null>()

async function findExecutable(name: string, candidates: string[]): Promise<string | null> {
  const cached = toolCache.get(name)
  if (cached !== undefined) return cached

  const fromPath = await new Promise<string | null>((resolve) => {
    const proc = spawn('which', [name], { timeout: 5000 })
    let stdout = ''
    proc.stdout?.on('data', (data) => { stdout += data.toString() })
    proc.on('error', () => resolve(null))
    proc.on('exit', (code) => {
      const found = stdout.trim().split('\n')[0]
      resolve(code === 0 && found ? found : null)
    })
  })

  const result = fromPath ?? candidates.find((candidate) => fs.existsSync(candidate)) ?? null
  toolCache.set(name, result)
  return result
}

async function findNodeBinary(): Promise<string | null> {
  return findExecutable('node', ['/opt/homebrew/bin/node', '/usr/local/bin/node', '/usr/bin/node'])
}

const RESOLVABLE_TOOLS: Record<string, string[]> = {
  npm: ['/opt/homebrew/bin/npm', '/usr/local/bin/npm'],
  git: ['/opt/homebrew/bin/git', '/usr/local/bin/git', '/usr/bin/git'],
  node: ['/opt/homebrew/bin/node', '/usr/local/bin/node', '/usr/bin/node'],
  ditto: ['/usr/bin/ditto'],
}

async function resolveCommand(command: string[]): Promise<string[]> {
  const name = command[0]
  if (!name || path.isAbsolute(name) || !RESOLVABLE_TOOLS[name]) return command
  const resolved = await findExecutable(name, RESOLVABLE_TOOLS[name])
  return resolved ? [resolved, ...command.slice(1)] : command
}

async function makeBuildEnv(): Promise<NodeJS.ProcessEnv> {
  const nodePath = await findNodeBinary()
  const basePath = process.env.PATH ?? ''
  const separator = process.platform === 'win32' ? ';' : ':'
  const extraPaths: string[] = []
  if (nodePath) extraPaths.push(path.dirname(nodePath))
  const npmPath = await findExecutable('npm', RESOLVABLE_TOOLS.npm)
  if (npmPath && !extraPaths.includes(path.dirname(npmPath))) {
    extraPaths.push(path.dirname(npmPath))
  }
  return {
    ...process.env,
    PATH: [...extraPaths, basePath].join(separator),
    FORCE_COLOR: '0',
    NO_COLOR: '1',
  }
}

async function stageReleaseAsset(asset: ReleaseAsset, stagingDir: string, logPath: string): Promise<string> {
  const downloadDir = path.join(stagingDir, 'download')
  const extractDir = path.join(stagingDir, 'extracted')
  fs.rmSync(downloadDir, { recursive: true, force: true })
  fs.rmSync(extractDir, { recursive: true, force: true })
  fs.mkdirSync(downloadDir, { recursive: true })
  fs.mkdirSync(extractDir, { recursive: true })

  const assetPath = path.join(downloadDir, asset.name)
  fs.appendFileSync(logPath, `\nDownloading ${asset.browser_download_url}\n`)
  fs.writeFileSync(assetPath, await requestBuffer(asset.browser_download_url))
  fs.appendFileSync(logPath, `Downloaded ${asset.name} (${fs.statSync(assetPath).size} bytes)\n`)

  if (!asset.name.endsWith('.zip')) {
    throw new Error(`Unsupported update artifact ${asset.name}. Publish the macOS zip asset for in-app updates.`)
  }

  emitProgress({ phase: 'packaging', message: 'Extracting downloaded app', percent: 70 })
  await runLogged(['ditto', '-x', '-k', assetPath, extractDir], stagingDir, logPath)
  const stagedAppPath = findAppBundle(extractDir)
  if (!stagedAppPath) {
    throw new Error(`Cranberri.app not found inside ${asset.name}`)
  }
  return stagedAppPath
}

function findAppBundle(root: string): string | null {
  const entries = fs.readdirSync(root, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name)
    if (entry.isDirectory() && entry.name === 'Cranberri.app') return fullPath
    if (entry.isDirectory()) {
      const nested = findAppBundle(fullPath)
      if (nested) return nested
    }
  }
  return null
}

async function runLogged(command: string[], cwd: string, logPath: string): Promise<void> {
  const resolved = await resolveCommand(command)
  const env = await makeBuildEnv()
  return new Promise((resolve, reject) => {
    const log = fs.createWriteStream(logPath, { flags: 'a' })
    log.write(`\n$ ${command.join(' ')} (resolved: ${resolved.join(' ')})\n`)
    const proc = spawn(resolved[0], resolved.slice(1), { cwd, env })
    proc.stdout?.on('data', (data: Buffer) => log.write(data))
    proc.stderr?.on('data', (data: Buffer) => log.write(data))
    proc.on('error', (error) => {
      log.write(`\nspawn error: ${error.message}\n`)
      log.end(() => reject(error))
    })
    proc.on('exit', (code) => {
      log.write(`\nexit code: ${code}\n`)
      log.end(() => {
        if (code === 0) resolve()
        else reject(new Error(`Command failed with exit code ${code}: ${command.join(' ')}`))
      })
    })
  })
}

function getCurrentAppPath(): string {
  const execPath = process.execPath
  // In packaged app: .../Cranberri.app/Contents/MacOS/Cranberri
  const macosDir = path.dirname(execPath)
  const contentsDir = path.dirname(macosDir)
  return path.join(contentsDir, '..')
}

function readPendingResult(): InstallResult | null {
  try {
    const resultPath = getUserData('updater-result.json')
    if (!fs.existsSync(resultPath)) return null
    const raw = JSON.parse(fs.readFileSync(resultPath, 'utf8'))
    return installResultSchema.parse(raw)
  } catch {
    return null
  }
}

export function initUpdaterIpc(): void {
  ipcMain.handle('updater:check', async () => {
    setStatus({ status: 'checking' })
    const result = await performCheck()
    setStatus(result)
    return result
  })

  ipcMain.handle('updater:status', () => currentStatus)

  ipcMain.handle('updater:install', async () => {
    return installUpdate()
  })

  ipcMain.handle('updater:pending-result', () => {
    return readPendingResult()
  })

  ipcMain.handle('updater:clear-result', () => {
    try {
      fs.rmSync(getUserData('updater-result.json'), { force: true })
      return { ok: true }
    } catch {
      return { ok: false }
    }
  })

  // Auto-check on startup in packaged builds, but don't block the window.
  if (app.isPackaged) {
    setStatus({ status: 'checking' })
    performCheck()
      .then((result) => {
        setStatus(result)
        if (result.status === 'updateAvailable' || result.status === 'blocked') {
          const main = BrowserWindow.getAllWindows()[0]
          if (main?.webContents) {
            main.webContents.send('updater:auto-check-result', result)
          }
        }
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error)
        setStatus({ status: 'failed', failedPhase: 'preparing', failureMessage: message })
      })
  }

  const pending = readPendingResult()
  if (pending) {
    setStatus({ status: 'failed', failedPhase: pending.phase, failureMessage: pending.message ?? 'Update failed', logPath: pending.logPath })
  }
}
