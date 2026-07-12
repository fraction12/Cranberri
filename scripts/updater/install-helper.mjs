#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const [, , manifestPath, parentPid] = process.argv

function log(message) {
  console.log(`[cranberri-updater] ${message}`)
}

function atomicJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const temporary = `${filePath}.${process.pid}.tmp`
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2), { mode: 0o600 })
  fs.renameSync(temporary, filePath)
}

function journal(manifest, phase, detail = null) {
  atomicJson(manifest.journalPath, {
    version: 1,
    installId: manifest.installId,
    phase,
    detail,
    currentAppPath: manifest.currentAppPath,
    candidateAppPath: manifest.candidateAppPath,
    backupAppPath: manifest.backupAppPath,
    resultManifestPath: manifest.resultManifestPath,
    logPath: manifest.logPath ?? null,
    updatedAt: new Date().toISOString(),
  })
  if (process.env.CRANBERRI_UPDATER_FAIL_AFTER === phase) {
    throw new Error(`Injected updater failure after ${phase}`)
  }
}

async function waitForParent(pid) {
  if (!pid || pid === '0') return
  const target = Number.parseInt(pid, 10)
  if (!Number.isSafeInteger(target) || target <= 0) return
  for (;;) {
    try {
      process.kill(target, 0)
    } catch {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
}

function validateManifest(manifest) {
  const required = ['installId', 'currentAppPath', 'stagedAppPath', 'candidateAppPath', 'backupAppPath', 'journalPath', 'resultManifestPath']
  for (const key of required) {
    if (typeof manifest[key] !== 'string' || !manifest[key]) throw new Error(`Invalid manifest: missing ${key}`)
  }
  if (!manifest.currentAppPath.endsWith('.app') || !manifest.stagedAppPath.endsWith('.app')) {
    throw new Error('Updater paths must reference macOS app bundles')
  }
  const installDirectory = path.resolve(path.dirname(manifest.currentAppPath))
  for (const sibling of [manifest.candidateAppPath, manifest.backupAppPath]) {
    if (path.resolve(path.dirname(sibling)) !== installDirectory) {
      throw new Error('Candidate and backup must be on the installed app volume')
    }
  }
  if (new Set([manifest.currentAppPath, manifest.stagedAppPath, manifest.candidateAppPath, manifest.backupAppPath]).size !== 4) {
    throw new Error('Updater paths must be distinct')
  }
}

function writeResult(manifest, success, phase, message) {
  atomicJson(manifest.resultManifestPath, {
    success,
    phase,
    message,
    logPath: manifest.logPath ?? null,
    completedAt: new Date().toISOString(),
  })
}

function preserveResidual(residualPath, installId) {
  if (!fs.existsSync(residualPath)) return null
  const preserved = `${residualPath}.failed-${installId}`
  fs.renameSync(residualPath, preserved)
  return preserved
}

function rollback(manifest, cause) {
  let rollbackError = null
  try {
    if (fs.existsSync(manifest.backupAppPath)) {
      if (fs.existsSync(manifest.currentAppPath)) preserveResidual(manifest.currentAppPath, manifest.installId)
      fs.renameSync(manifest.backupAppPath, manifest.currentAppPath)
    }
    journal(manifest, 'rolledBack', cause.message)
  } catch (error) {
    rollbackError = error instanceof Error ? error.message : String(error)
    journal(manifest, 'rollbackFailed', rollbackError)
  }
  return rollbackError
}

function relaunch(appPath) {
  const executable = path.join(appPath, 'Contents', 'MacOS', 'Cranberri')
  if (!fs.existsSync(executable)) throw new Error(`Executable not found at ${executable}`)
  const child = spawn('/usr/bin/open', ['-n', appPath], { detached: true, stdio: 'ignore' })
  child.unref()
}

export async function installFromManifest(manifest, options = {}) {
  validateManifest(manifest)
  if (!fs.existsSync(manifest.currentAppPath) || !fs.existsSync(manifest.stagedAppPath)) {
    throw new Error('Installed or staged app bundle is unavailable')
  }
  if (fs.existsSync(manifest.backupAppPath)) throw new Error('A previous updater backup still awaits health acknowledgement')
  if (fs.existsSync(manifest.candidateAppPath)) throw new Error('An updater candidate already exists')

  journal(manifest, 'prepared')
  try {
    fs.cpSync(manifest.stagedAppPath, manifest.candidateAppPath, {
      recursive: true,
      preserveTimestamps: true,
      errorOnExist: true,
    })
    journal(manifest, 'candidateCopied')
    fs.renameSync(manifest.currentAppPath, manifest.backupAppPath)
    journal(manifest, 'backupPromoted')
    fs.renameSync(manifest.candidateAppPath, manifest.currentAppPath)
    journal(manifest, 'candidatePromoted')
    writeResult(manifest, true, 'relaunching', 'Update promoted; waiting for startup health acknowledgement')
    journal(manifest, 'relaunching')
    if (options.relaunch !== false) relaunch(manifest.relaunchTarget || manifest.currentAppPath)
    return { success: true }
  } catch (error) {
    const cause = error instanceof Error ? error : new Error(String(error))
    const rollbackError = rollback(manifest, cause)
    const message = rollbackError ? `${cause.message}; rollback failed: ${rollbackError}` : cause.message
    writeResult(manifest, false, rollbackError ? 'replacing' : 'backingUp', message)
    throw new Error(message, { cause: error })
  }
}

async function main() {
  if (!manifestPath) throw new Error('Usage: install-helper.mjs <manifest-path> [parent-pid]')
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  await waitForParent(parentPid)
  await new Promise((resolve) => setTimeout(resolve, 500))
  const watchdogPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'install-watchdog.mjs')
  const watchdog = spawn(process.execPath, [watchdogPath, manifest.journalPath, String(process.pid)], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  })
  watchdog.unref()
  await installFromManifest(manifest)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    log(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
