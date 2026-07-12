#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const [
  ,,
  manifestPath,
  parentPid,
  fallbackCurrentAppPath,
  fallbackResultManifestPath,
  fallbackJournalPath,
  fallbackInstallId,
  fallbackLogPath,
  fallbackStagedAppPath,
  fallbackCandidateAppPath,
  fallbackBackupAppPath,
] = process.argv

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

function safeJournal(manifest, phase, detail = null) {
  try {
    journal(manifest, phase, detail)
    return null
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
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

function rollback(manifest, cause, state) {
  let rollbackError = null
  try {
    if (state.backupOwned && fs.existsSync(manifest.backupAppPath)) {
      if (fs.existsSync(manifest.currentAppPath)) preserveResidual(manifest.currentAppPath, manifest.installId)
      fs.renameSync(manifest.backupAppPath, manifest.currentAppPath)
    }
    if (state.candidateOwned && fs.existsSync(manifest.candidateAppPath)) {
      preserveResidual(manifest.candidateAppPath, manifest.installId)
    }
  } catch (error) {
    rollbackError = error instanceof Error ? error.message : String(error)
    safeJournal(manifest, 'rollbackFailed', rollbackError)
  }
  return rollbackError
}

export function relaunchEnvironment(environment = process.env) {
  const launchEnvironment = { ...environment }
  delete launchEnvironment.ELECTRON_RUN_AS_NODE
  return launchEnvironment
}

function relaunch(appPath) {
  const executable = path.join(appPath, 'Contents', 'MacOS', 'Cranberri')
  if (!fs.existsSync(executable)) throw new Error(`Executable not found at ${executable}`)
  const child = spawn('/usr/bin/open', ['-n', appPath], {
    detached: true,
    stdio: 'ignore',
    env: relaunchEnvironment(),
  })
  child.unref()
}

export async function installFromManifest(manifest, options = {}) {
  const launchApp = options.launchApp ?? relaunch
  const state = { backupOwned: false, candidateOwned: false }

  try {
    validateManifest(manifest)
    journal(manifest, 'preflighting')
    if (!fs.existsSync(manifest.currentAppPath) || !fs.existsSync(manifest.stagedAppPath)) {
      throw new Error('Installed or staged app bundle is unavailable')
    }
    if (fs.existsSync(manifest.backupAppPath)) throw new Error('A previous updater backup still awaits health acknowledgement')
    if (fs.existsSync(manifest.candidateAppPath)) throw new Error('An updater candidate already exists')
    journal(manifest, 'prepared')
    fs.cpSync(manifest.stagedAppPath, manifest.candidateAppPath, {
      recursive: true,
      preserveTimestamps: true,
      errorOnExist: true,
      verbatimSymlinks: true,
    })
    state.candidateOwned = true
    journal(manifest, 'candidateCopied')
    fs.renameSync(manifest.currentAppPath, manifest.backupAppPath)
    state.backupOwned = true
    journal(manifest, 'backupPromoted')
    fs.renameSync(manifest.candidateAppPath, manifest.currentAppPath)
    state.candidateOwned = false
    journal(manifest, 'candidatePromoted')
    writeResult(manifest, true, 'relaunching', 'Update promoted; waiting for startup health acknowledgement')
    journal(manifest, 'relaunching')
    if (options.relaunch !== false) launchApp(manifest.relaunchTarget || manifest.currentAppPath)
    return { success: true }
  } catch (error) {
    const cause = error instanceof Error ? error : new Error(String(error))
    const rollbackError = rollback(manifest, cause, state)
    let relaunchError = null
    const journalError = safeJournal(manifest, 'rollbackPrepared', cause.message)
    if (!rollbackError && options.relaunch !== false && fs.existsSync(manifest.currentAppPath)) {
      try {
        launchApp(manifest.relaunchTarget || manifest.currentAppPath)
      } catch (launchError) {
        relaunchError = launchError instanceof Error ? launchError.message : String(launchError)
      }
    }
    const failures = [
      cause.message,
      rollbackError ? `rollback failed: ${rollbackError}` : null,
      journalError ? `journal failed: ${journalError}` : null,
      relaunchError ? `restored app relaunch failed: ${relaunchError}` : null,
    ].filter(Boolean)
    const message = failures.join('; ')
    writeResult(manifest, false, state.backupOwned || rollbackError ? 'replacing' : 'preparing', message)
    safeJournal(manifest, relaunchError ? 'rollbackRelaunchFailed' : 'rolledBack', message)
    throw new Error(message, { cause: error })
  }
}

function trustedFallback(value) {
  if (!value || typeof value !== 'object') return null
  const required = ['installId', 'currentAppPath', 'resultManifestPath', 'journalPath']
  return required.every((key) => typeof value[key] === 'string' && value[key]) ? value : null
}

function assertMatchesFallback(manifest, fallback) {
  if (!fallback) return
  for (const key of [
    'installId',
    'currentAppPath',
    'stagedAppPath',
    'candidateAppPath',
    'backupAppPath',
    'resultManifestPath',
    'journalPath',
  ]) {
    if (typeof fallback[key] === 'string' && fallback[key] && manifest[key] !== fallback[key]) {
      throw new Error(`Updater manifest ${key} does not match trusted launcher context`)
    }
  }
}

async function diagnoseManifestFailure(fallback, error, options) {
  const cause = error instanceof Error ? error : new Error(String(error))
  if (!fallback) throw cause
  const diagnosticManifest = {
    ...fallback,
    stagedAppPath: fallback.stagedAppPath ?? `${fallback.currentAppPath}.unavailable`,
    candidateAppPath: fallback.candidateAppPath ?? `${fallback.currentAppPath}.candidate-unavailable`,
    backupAppPath: fallback.backupAppPath ?? `${fallback.currentAppPath}.backup-unavailable`,
    relaunchTarget: fallback.relaunchTarget ?? fallback.currentAppPath,
  }
  const launchApp = options.launchApp ?? relaunch
  let relaunchError = null
  safeJournal(diagnosticManifest, 'rollbackPrepared', cause.message)
  if (options.relaunch !== false && fs.existsSync(diagnosticManifest.currentAppPath)) {
    try {
      launchApp(diagnosticManifest.relaunchTarget)
    } catch (launchError) {
      relaunchError = launchError instanceof Error ? launchError.message : String(launchError)
    }
  }
  const message = relaunchError
    ? `${cause.message}; restored app relaunch failed: ${relaunchError}`
    : cause.message
  writeResult(diagnosticManifest, false, 'preparing', message)
  safeJournal(diagnosticManifest, relaunchError ? 'rollbackRelaunchFailed' : 'rolledBack', message)
  throw new Error(message, { cause })
}

export async function installFromManifestPath(filePath, options = {}) {
  const fallback = trustedFallback(options.fallback)
  let manifest
  try {
    if (!filePath) throw new Error('Updater manifest path is missing')
    manifest = JSON.parse(fs.readFileSync(filePath, 'utf8'))
    assertMatchesFallback(manifest, fallback)
  } catch (error) {
    return diagnoseManifestFailure(fallback, new Error(`Updater manifest is invalid: ${error instanceof Error ? error.message : String(error)}`), options)
  }
  return installFromManifest(manifest, options)
}

async function main() {
  const fallback = {
    currentAppPath: fallbackCurrentAppPath,
    resultManifestPath: fallbackResultManifestPath,
    journalPath: fallbackJournalPath,
    installId: fallbackInstallId,
    logPath: fallbackLogPath,
    stagedAppPath: fallbackStagedAppPath,
    candidateAppPath: fallbackCandidateAppPath,
    backupAppPath: fallbackBackupAppPath,
    relaunchTarget: fallbackCurrentAppPath,
  }
  const watchdogPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'install-watchdog.mjs')
  const watchdog = spawn(process.execPath, [
    watchdogPath,
    fallbackJournalPath ?? '',
    String(process.pid),
    fallbackCurrentAppPath ?? '',
    fallbackResultManifestPath ?? '',
    fallbackInstallId ?? '',
    fallbackLogPath ?? '',
    fallbackBackupAppPath ?? '',
    fallbackCandidateAppPath ?? '',
  ], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  })
  watchdog.unref()
  await waitForParent(parentPid)
  await new Promise((resolve) => setTimeout(resolve, 500))
  await installFromManifestPath(manifestPath, { fallback })
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    log(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
