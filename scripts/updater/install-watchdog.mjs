#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const [, , journalPath, installerPid] = process.argv

function atomicJson(filePath, value) {
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
  if (!journalPath) throw new Error('Watchdog journal path is required')
  await waitForExit(installerPid)
  if (!fs.existsSync(journalPath)) return
  const timeout = Number.parseInt(process.env.CRANBERRI_UPDATER_HEALTH_TIMEOUT_MS ?? '', 10)
  const journal = await awaitInstallOutcome(journalPath, {
    healthTimeoutMs: Number.isSafeInteger(timeout) && timeout >= 0 ? timeout : undefined,
  })
  if (!recoverInterruptedInstall(journal)) return
  const message = journal.phase === 'relaunching'
    ? 'Updated app did not acknowledge startup health in time'
    : 'Installer exited before promotion completed'
  atomicJson(journalPath, { ...journal, phase: 'rolledBack', detail: message, updatedAt: new Date().toISOString() })
  if (typeof journal.resultManifestPath === 'string') {
    atomicJson(journal.resultManifestPath, {
      success: false,
      phase: 'relaunching',
      message,
      logPath: typeof journal.logPath === 'string' ? journal.logPath : null,
      completedAt: new Date().toISOString(),
    })
  }
  relaunch(journal.currentAppPath)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`[cranberri-updater-watchdog] ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  })
}
