#!/usr/bin/env node
/* eslint-disable no-func-assign */
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'

const [, , manifestPath, parentPid] = process.argv

if (!manifestPath) {
  console.error('Usage: install-helper.mjs <manifest-path> [parent-pid]')
  process.exit(1)
}

function log(message) {
  console.log(`[cranberri-updater] ${message}`)
}

async function waitForParent(pid) {
  if (!pid || pid === '0') return
  const target = Number.parseInt(pid, 10)
  if (Number.isNaN(target)) return
  log(`Waiting for parent process ${target} to exit...`)
  for (;;) {
    try {
      process.kill(target, 0)
    } catch {
      log('Parent process exited.')
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
}

function rmrf(target) {
  if (!fs.existsSync(target)) return
  fs.rmSync(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}

function cpR(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  const result = spawn('cp', ['-R', src, dest], { stdio: 'inherit' })
  return new Promise((resolve, reject) => {
    result.on('error', reject)
    result.on('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`cp -R exited with code ${code}`))
    })
  })
}

async function relaunch(appPath) {
  const executable = path.join(appPath, 'Contents', 'MacOS', 'Cranberri')
  if (!fs.existsSync(executable)) {
    throw new Error(`Executable not found at ${executable}`)
  }
  log(`Relaunching ${appPath}`)
  const child = spawn('open', ['-n', appPath], {
    detached: true,
    stdio: 'ignore',
  })
  child.unref()
}

async function main() {
  let manifest
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  } catch (error) {
    log(`Failed to read manifest: ${error.message}`)
    process.exit(1)
  }

  const {
    currentAppPath,
    stagedAppPath,
    backupAppPath,
    resultManifestPath,
  } = manifest

  if (!currentAppPath || !stagedAppPath || !backupAppPath || !resultManifestPath) {
    log('Invalid manifest: missing required paths')
    process.exit(1)
  }

  for (const p of [currentAppPath, stagedAppPath]) {
    if (!fs.existsSync(p)) {
      log(`Required path does not exist: ${p}`)
      writeResult(resultManifestPath, false, 'replacing', `Missing path: ${p}`, manifest)
      process.exit(1)
    }
  }

  // Write a helper log next to the result manifest for debugging.
  const helperLogPath = path.join(path.dirname(resultManifestPath), 'install-helper.log')
  const originalLog = log
  const fileLog = (message) => {
    originalLog(message)
    try {
      fs.appendFileSync(helperLogPath, `${new Date().toISOString()} ${message}\n`)
    } catch {
      // ignore
    }
  }
  log = fileLog
  log(`Helper starting. manifest=${manifestPath} parentPid=${parentPid}`)

  await waitForParent(parentPid)

  // Allow a small settle window after the parent exits.
  await new Promise((resolve) => setTimeout(resolve, 1000))

  try {
    log(`Backing up current app to ${backupAppPath}`)
    rmrf(backupAppPath)
    fs.mkdirSync(path.dirname(backupAppPath), { recursive: true })
    await cpR(currentAppPath, backupAppPath)

    log(`Replacing current app with staged app`)
    rmrf(currentAppPath)
    await cpR(stagedAppPath, currentAppPath)

    log(`Verifying replacement`)
    const relaunchTarget = manifest.relaunchTarget || currentAppPath
    if (!fs.existsSync(relaunchTarget)) {
      throw new Error(`Relaunch target missing after replacement: ${relaunchTarget}`)
    }

    log(`Staged app present at ${stagedAppPath}`)

    writeResult(resultManifestPath, true, 'relaunching', 'Update installed successfully', manifest)
    await relaunch(relaunchTarget)
    log('Relaunch initiated. Helper exiting.')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    log(`Install failed: ${message}`)
    // Try to restore backup if replacement failed and backup exists.
    try {
      if (fs.existsSync(backupAppPath) && !fs.existsSync(currentAppPath)) {
        log('Restoring backup app')
        await cpR(backupAppPath, currentAppPath)
      }
    } catch (restoreError) {
      const restoreMessage = restoreError instanceof Error ? restoreError.message : String(restoreError)
      log(`Restore failed: ${restoreMessage}`)
    }
    writeResult(resultManifestPath, false, 'replacing', message, manifest)
    process.exit(1)
  }
}

function writeResult(resultPath, success, phase, message, manifest) {
  const payload = {
    success,
    phase,
    message,
    logPath: manifest?.logPath ?? null,
    completedAt: new Date().toISOString(),
  }
  fs.mkdirSync(path.dirname(resultPath), { recursive: true })
  fs.writeFileSync(resultPath, JSON.stringify(payload, null, 2))
}

main().catch((error) => {
  log(`Unhandled error: ${error.message}`)
  process.exit(1)
})
