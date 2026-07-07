import { app, ipcMain, BrowserWindow } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import simpleGit from 'simple-git'
import { buildInfo } from '@/shared/buildInfo'
import { readSettings, writeSettings } from './settings'
import type { UpdateInfo, UpdateProgress, InstallResult, InstallManifest } from '@/shared/update'
import { updateInfoSchema, updateProgressSchema, installResultSchema, installManifestSchema } from '@/shared/update'

const UPDATE_CHANNEL = 'updater:event'

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

interface SourceRepo {
  path: string
  remoteUrl: string
  owner: string
  repo: string
  isDirty: boolean
  containsCommit: boolean
}

async function resolveSourceRepo(): Promise<SourceRepo | null> {
  const settings = readSettings()
  const candidatePaths: string[] = []
  if (settings.updater?.sourceRepoPath) {
    candidatePaths.push(settings.updater.sourceRepoPath)
  }
  // Fallback: discover from registered repos if they match the Cranberri origin.
  const { getRegisteredRepoPaths } = await import('./repos')
  for (const repoPath of getRegisteredRepoPaths()) {
    if (!candidatePaths.includes(repoPath)) candidatePaths.push(repoPath)
  }

  const repos: SourceRepo[] = []
  for (const repoPath of candidatePaths) {
    try {
      const git = simpleGit(repoPath)
      const remotes = await git.getRemotes(true)
      const origin = remotes.find((r) => r.name === 'origin') ?? remotes[0]
      const remoteUrl = origin?.refs?.fetch || origin?.refs?.push || ''
      const match = remoteUrl.match(/github\.com[:/]([^/]+)\/([^/.]+)(?:\.git)?$/)
      if (!match) continue
      const [, owner, repo] = match
      const status = await git.status()
      const containsCommit = await commitExistsInRepo(git, buildInfo.commit)
      repos.push({ path: repoPath, remoteUrl, owner, repo, isDirty: status.files.length > 0, containsCommit })
    } catch {
      continue
    }
  }

  // Prefer a repo that actually contains the running commit; otherwise return the first valid one.
  return repos.find((r) => r.containsCommit) ?? repos[0] ?? null
}

async function commitExistsInRepo(git: ReturnType<typeof simpleGit>, commit: string): Promise<boolean> {
  try {
    const result = await git.raw(['cat-file', '-t', commit])
    return result.trim() === 'commit'
  } catch {
    return false
  }
}

async function checkCommitsBehind(sourceRepo: SourceRepo, currentCommit: string): Promise<{ latestCommit: string; commitsBehind: number | null; comparisonUnknown: boolean }> {
  if (!sourceRepo.containsCommit) {
    return { latestCommit: '', commitsBehind: null, comparisonUnknown: true }
  }
  const git = simpleGit(sourceRepo.path)
  await git.fetch(['origin', 'main'])
  const latestCommit = (await git.raw(['rev-parse', 'origin/main'])).trim()
  if (latestCommit === currentCommit) {
    return { latestCommit, commitsBehind: 0, comparisonUnknown: false }
  }
  try {
    const countOutput = await git.raw(['rev-list', '--count', `${currentCommit}..origin/main`])
    const commitsBehind = Number.parseInt(countOutput.trim(), 10)
    if (Number.isNaN(commitsBehind)) throw new Error('Invalid behind count')
    return { latestCommit, commitsBehind, comparisonUnknown: false }
  } catch {
    return { latestCommit, commitsBehind: null, comparisonUnknown: true }
  }
}

type UpdateBlockedReasonLiteral = 'developmentMode' | 'noSourceRepo' | 'missingOrigin' | 'sourceNotGitHub' | 'gitFetchFailed' | 'comparisonUnknown' | 'dirtySourceRepo'

async function performCheck(): Promise<UpdateInfo> {
  if (!buildInfo.packaged) {
    return blocked('developmentMode', 'Updates install packaged app builds. Development builds update through git.')
  }
  const sourceRepo = await resolveSourceRepo()
  if (!sourceRepo) {
    return blocked('noSourceRepo', 'No Cranberri source repo is configured. Add one in Settings.')
  }
  if (!sourceRepo.remoteUrl.includes('github.com')) {
    return blocked('sourceNotGitHub', 'The configured source repo origin is not GitHub.')
  }
  if (!sourceRepo.containsCommit) {
    return blocked('comparisonUnknown', `Running commit ${buildInfo.commit.slice(0, 7)} is not in the source repo at ${sourceRepo.path}.`, null)
  }

  try {
    const { latestCommit, commitsBehind, comparisonUnknown } = await checkCommitsBehind(sourceRepo, buildInfo.commit)
    if (comparisonUnknown) {
      return blocked('comparisonUnknown', `Running commit ${buildInfo.commit.slice(0, 7)} is not in the source repo history.`, latestCommit)
    }
    if (commitsBehind === 0) {
      return {
        status: 'upToDate',
        currentCommit: buildInfo.commit,
        latestCommit,
        commitsBehind: 0,
        sourceRepoPath: sourceRepo.path,
        sourceRepoDirty: sourceRepo.isDirty,
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
      latestCommit,
      commitsBehind,
      sourceRepoPath: sourceRepo.path,
      sourceRepoDirty: sourceRepo.isDirty,
      blockedReason: null,
      blockedMessage: null,
      phase: null,
      phaseMessage: null,
      failedPhase: null,
      failureMessage: null,
      logPath: null,
    }
  } catch (error) {
    return blocked('gitFetchFailed', error instanceof Error ? error.message : String(error))
  }

  function blocked(reason: UpdateBlockedReasonLiteral, message: string, latestCommit: string | null = null): UpdateInfo {
    return {
      status: 'blocked',
      currentCommit: buildInfo.commit,
      latestCommit,
      commitsBehind: null,
      sourceRepoPath: sourceRepo?.path ?? null,
      sourceRepoDirty: sourceRepo?.isDirty ?? null,
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
  const sourceRepo = await resolveSourceRepo()
  if (!sourceRepo) {
    return { success: false, phase: null, message: 'Source repo not found.', logPath: null }
  }

  const stagingDir = getUserData('updater-staging')
  const logPath = path.join(stagingDir, 'build.log')
  fs.mkdirSync(stagingDir, { recursive: true })

  setStatus({ status: 'building', phase: 'preparing', phaseMessage: 'Preparing hidden staging area', logPath })

  try {
    emitProgress({ phase: 'preparing', message: 'Refreshing latest origin/main', percent: 2 })
    const refreshed = await checkCommitsBehind(sourceRepo, buildInfo.commit)
    const targetCommit = refreshed.latestCommit || currentStatus.latestCommit!
    if (refreshed.commitsBehind === 0) {
      setStatus({
        status: 'upToDate',
        currentCommit: buildInfo.commit,
        latestCommit: targetCommit,
        commitsBehind: 0,
        sourceRepoPath: sourceRepo.path,
        sourceRepoDirty: sourceRepo.isDirty,
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

    await stageSource(sourceRepo.path, targetCommit, stagingDir)
    emitProgress({ phase: 'dependencies', message: 'Installing dependencies', percent: 15 })
    await runLogged(['npm', 'install'], path.join(stagingDir, 'source'), logPath)
    emitProgress({ phase: 'building', message: 'Building application', percent: 40 })
    await runLogged(['npm', 'run', 'build'], path.join(stagingDir, 'source'), logPath)
    emitProgress({ phase: 'packaging', message: 'Packaging macOS app', percent: 70 })
    await runLogged(['npm', 'run', 'package:dir'], path.join(stagingDir, 'source'), logPath)
    emitProgress({ phase: 'readyToInstall', message: 'Ready to install', percent: 95 })
    setStatus({ status: 'readyToInstall', phase: 'readyToInstall', phaseMessage: 'Ready to install' })

    const stagedAppPath = path.join(stagingDir, 'source', 'dist', 'mac-arm64', 'Cranberri.app')
    if (!fs.existsSync(stagedAppPath)) {
      throw new Error(`Packaged app not found at ${stagedAppPath}`)
    }

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
    spawn(process.execPath, [helperPath, manifestPath, String(process.pid)], {
      detached: true,
      stdio: 'ignore',
      env: { ...process.env, CRANBERRI_UPDATER: '1' },
    }).unref()

    app.quit()
    return { success: true, phase: 'relaunching', message: 'Quitting to install update', logPath }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    setStatus({ status: 'failed', failedPhase: currentStatus.phase, failureMessage: message, logPath })
    return { success: false, phase: currentStatus.phase, message, logPath }
  }
}

async function stageSource(repoPath: string, commit: string, stagingDir: string): Promise<void> {
  const sourceDir = path.join(stagingDir, 'source')
  fs.rmSync(sourceDir, { recursive: true, force: true })
  fs.mkdirSync(stagingDir, { recursive: true })
  emitProgress({ phase: 'fetching', message: `Cloning source at ${commit.slice(0, 7)}`, percent: 5 })
  await runLogged(['git', 'clone', '--shared', '--no-checkout', repoPath, sourceDir], stagingDir, path.join(stagingDir, 'clone.log'))
  await runLogged(['git', 'checkout', commit], sourceDir, path.join(stagingDir, 'clone.log'))
}

async function runLogged(command: string[], cwd: string, logPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const log = fs.createWriteStream(logPath, { flags: 'a' })
    log.write(`\n$ ${command.join(' ')}\n`)
    const proc = spawn(command[0], command.slice(1), { cwd, env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' } })
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

  ipcMain.handle('updater:set-source-repo', (_, repoPath: string) => {
    const settings = readSettings()
    const next = { ...settings, updater: { ...(settings.updater ?? {}), sourceRepoPath: repoPath } }
    writeSettings(next)
    return { ok: true }
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
