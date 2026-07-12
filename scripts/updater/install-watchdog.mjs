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
  if (journal.phase === 'relaunching' || journal.phase === 'healthAcknowledged' || journal.phase === 'rolledBack') return false
  if (!fs.existsSync(journal.backupAppPath)) return false
  if (fs.existsSync(journal.currentAppPath)) {
    fs.renameSync(journal.currentAppPath, `${journal.currentAppPath}.failed-${journal.installId}`)
  }
  fs.renameSync(journal.backupAppPath, journal.currentAppPath)
  return true
}

function relaunch(appPath) {
  const child = spawn('/usr/bin/open', ['-n', appPath], { detached: true, stdio: 'ignore' })
  child.unref()
}

async function main() {
  if (!journalPath) throw new Error('Watchdog journal path is required')
  await waitForExit(installerPid)
  if (!fs.existsSync(journalPath)) return
  const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8'))
  if (!recoverInterruptedInstall(journal)) return
  atomicJson(journalPath, { ...journal, phase: 'rolledBack', detail: 'Installer exited before completion', updatedAt: new Date().toISOString() })
  relaunch(journal.currentAppPath)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`[cranberri-updater-watchdog] ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  })
}
