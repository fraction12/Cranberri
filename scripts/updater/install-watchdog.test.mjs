import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { awaitInstallOutcome, recoverInterruptedInstall } from './install-watchdog.mjs'

const roots = []
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe('updater watchdog', () => {
  it('restores backup when the installer dies between promotion phases', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cranberri-watchdog-'))
    roots.push(root)
    const currentAppPath = path.join(root, 'Cranberri.app')
    const backupAppPath = path.join(root, '.Cranberri.previous.app')
    fs.mkdirSync(currentAppPath)
    fs.mkdirSync(backupAppPath)
    fs.writeFileSync(path.join(currentAppPath, 'version'), 'candidate')
    fs.writeFileSync(path.join(backupAppPath, 'version'), 'previous')

    expect(recoverInterruptedInstall({ phase: 'candidatePromoted', currentAppPath, backupAppPath, installId: 'test' })).toBe(true)
    expect(fs.readFileSync(path.join(currentAppPath, 'version'), 'utf8')).toBe('previous')
    expect(fs.readFileSync(`${currentAppPath}.failed-test/version`, 'utf8')).toBe('candidate')
  })

  it('leaves a health-acknowledged promotion alone', () => {
    expect(recoverInterruptedInstall({ phase: 'healthAcknowledged' })).toBe(false)
  })

  it('treats a missing startup health acknowledgement as recoverable', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cranberri-watchdog-health-'))
    roots.push(root)
    const journalPath = path.join(root, 'journal.json')
    const currentAppPath = path.join(root, 'Cranberri.app')
    const backupAppPath = path.join(root, '.Cranberri.previous.app')
    fs.mkdirSync(currentAppPath)
    fs.mkdirSync(backupAppPath)
    fs.writeFileSync(path.join(currentAppPath, 'version'), 'candidate')
    fs.writeFileSync(path.join(backupAppPath, 'version'), 'previous')
    fs.writeFileSync(journalPath, JSON.stringify({ phase: 'relaunching', currentAppPath, backupAppPath, installId: 'health-timeout' }))

    const journal = await awaitInstallOutcome(journalPath, { healthTimeoutMs: 0, pollIntervalMs: 1 })

    expect(journal.phase).toBe('relaunching')
    expect(recoverInterruptedInstall(journal)).toBe(true)
    expect(fs.readFileSync(path.join(currentAppPath, 'version'), 'utf8')).toBe('previous')
  })
})
