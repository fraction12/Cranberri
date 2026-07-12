#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const [
  ,,
  journalPath,
  installerPid,
  fallbackCurrentAppPath,
  fallbackResultManifestPath,
  fallbackInstallId,
  fallbackLogPath,
  fallbackBackupAppPath,
  fallbackCandidateAppPath,
] = process.argv

function atomicJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const temporary = `${filePath}.${process.pid}.tmp`
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2), { mode: 0o600 })
  fs.renameSync(temporary, filePath)
}

async function waitForExit(rawPid) {
  const pid = Number.parseInt(rawPid, 10)
  if (!Number.isSafeInteger(pid) || pid <= 0) return
  for (;;) {
    try { process.kill(pid, 0) } catch { return }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
}

export function recoverInterruptedInstall(journal) {
  if (journal.phase === 'healthAcknowledged' || journal.phase === 'rolledBack') return false
  if (!fs.existsSync(journal.backupAppPath)) return false
  if (fs.existsSync(journal.currentAppPath)) {
    fs.renameSync(journal.currentAppPath, `${journal.currentAppPath}.failed-${journal.installId}`)
  }
  fs.renameSync(journal.backupAppPath, journal.currentAppPath)
  return true
}

function installFailureMessage(phase) {
  return phase === 'relaunching'
    ? 'Updated app did not acknowledge startup health in time'
    : 'Installer exited before the update completed'
}

function phaseOwnsBackup(phase) {
  return ['backupPromoted', 'candidatePromoted', 'relaunching', 'rollbackPrepared', 'rollbackFailed', 'rollbackRelaunchFailed'].includes(phase)
}

export function handleInterruptedInstall(journal, options = {}) {
  const fallback = options.fallback && typeof options.fallback === 'object'
    ? Object.fromEntries(Object.entries(options.fallback).filter(([, value]) => typeof value === 'string' && value))
    : {}
  const state = { ...(journal && typeof journal === 'object' ? journal : {}), ...fallback }
  if (state.phase === 'healthAcknowledged' || state.phase === 'rolledBack') {
    return { recovered: false, relaunched: false }
  }

  const detail = options.detail ?? installFailureMessage(state.phase)
  const launchApp = options.launchApp ?? relaunch
  let recoveryError = null
  let residualError = null
  let relaunchError = null
  let recovered = false
  if (
    ['prepared', 'candidateCopied', 'backupPromoted'].includes(state.phase)
    && typeof state.candidateAppPath === 'string'
    && fs.existsSync(state.candidateAppPath)
  ) {
    try {
      fs.renameSync(state.candidateAppPath, `${state.candidateAppPath}.failed-${state.installId}`)
    } catch (error) {
      residualError = error instanceof Error ? error.message : String(error)
    }
  }
  try {
    const shouldRestoreBackup = phaseOwnsBackup(state.phase) || !journal
    if (shouldRestoreBackup && typeof state.backupAppPath === 'string' && fs.existsSync(state.backupAppPath)) {
      recoverInterruptedInstall(state)
      recovered = true
    } else if (typeof state.currentAppPath === 'string' && fs.existsSync(state.currentAppPath)) {
      recovered = true
    } else {
      throw new Error('Neither the current app nor its updater backup is available')
    }
  } catch (error) {
    recoveryError = error instanceof Error ? error.message : String(error)
  }

  const initialMessage = [
    detail,
    recoveryError ? `rollback failed: ${recoveryError}` : null,
    residualError ? `candidate preservation failed: ${residualError}` : null,
  ].filter(Boolean).join('; ')
  if (typeof state.journalPath === 'string' && state.journalPath) {
    atomicJson(state.journalPath, { ...state, phase: recoveryError ? 'rollbackFailed' : 'rollbackPrepared', detail: initialMessage, updatedAt: new Date().toISOString() })
  }
  if (!recoveryError && options.relaunch !== false) {
    try {
      launchApp(state.currentAppPath)
    } catch (error) {
      relaunchError = error instanceof Error ? error.message : String(error)
    }
  }

  const message = [initialMessage, relaunchError ? `restored app relaunch failed: ${relaunchError}` : null].filter(Boolean).join('; ')
  const result = {
    success: false,
    phase: state.phase === 'relaunching' ? 'relaunching' : 'preparing',
    message,
    logPath: typeof state.logPath === 'string' ? state.logPath : null,
    completedAt: new Date().toISOString(),
  }
  if (typeof state.resultManifestPath === 'string' && state.resultManifestPath) {
    atomicJson(state.resultManifestPath, result)
  }
  if (typeof state.journalPath === 'string' && state.journalPath) {
    atomicJson(state.journalPath, {
      ...state,
      phase: recoveryError ? 'rollbackFailed' : relaunchError ? 'rollbackRelaunchFailed' : 'rolledBack',
      detail: message,
      updatedAt: new Date().toISOString(),
    })
  }
  return { recovered, relaunched: recovered && !relaunchError && options.relaunch !== false, message }
}

function readJournal(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

export async function awaitInstallOutcome(filePath, options = {}) {
  const healthTimeoutMs = options.healthTimeoutMs ?? 45_000
  const pollIntervalMs = options.pollIntervalMs ?? 250
  let current = readJournal(filePath)
  if (current.phase !== 'relaunching') return current

  const deadline = Date.now() + healthTimeoutMs
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs))
    current = readJournal(filePath)
    if (current.phase !== 'relaunching') return current
  }
  return readJournal(filePath)
}

export function relaunchEnvironment(environment = process.env) {
  const launchEnvironment = { ...environment }
  delete launchEnvironment.ELECTRON_RUN_AS_NODE
  for (const key of Object.keys(launchEnvironment)) {
    if (key === 'CRANBERRI_UPDATER' || key.startsWith('CRANBERRI_UPDATER_')) delete launchEnvironment[key]
  }
  return launchEnvironment
}

function relaunch(appPath) {
  const child = spawn('/usr/bin/open', ['-n', appPath], {
    detached: true,
    stdio: 'ignore',
    env: relaunchEnvironment(),
  })
  child.unref()
}

async function main() {
  await waitForExit(installerPid)
  const fallback = {
    currentAppPath: fallbackCurrentAppPath,
    resultManifestPath: fallbackResultManifestPath,
    journalPath,
    installId: fallbackInstallId,
    logPath: fallbackLogPath,
    backupAppPath: fallbackBackupAppPath,
    candidateAppPath: fallbackCandidateAppPath,
  }
  let journal = null
  let journalError = null
  try {
    if (!journalPath || !fs.existsSync(journalPath)) throw new Error('Updater journal is missing')
    journal = readJournal(journalPath)
  } catch (error) {
    journalError = error instanceof Error ? error.message : String(error)
  }
  const timeout = Number.parseInt(process.env.CRANBERRI_UPDATER_HEALTH_TIMEOUT_MS ?? '', 10)
  if (journal?.phase === 'relaunching') {
    journal = await awaitInstallOutcome(journalPath, {
      healthTimeoutMs: Number.isSafeInteger(timeout) && timeout >= 0 ? timeout : undefined,
    })
  }
  handleInterruptedInstall(journal, {
    fallback,
    detail: journalError ? `Updater journal is missing or invalid: ${journalError}` : undefined,
  })
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`[cranberri-updater-watchdog] ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  })
}
