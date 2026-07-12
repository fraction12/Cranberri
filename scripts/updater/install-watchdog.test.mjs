import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  awaitInstallOutcome,
  handleInterruptedInstall,
  recoverInterruptedInstall,
  relaunchEnvironment,
} from './install-watchdog.mjs'

const roots = []
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe('updater watchdog', () => {
  it('removes updater controls and Electron Node mode before relaunching the GUI', () => {
    expect(relaunchEnvironment({
      CRANBERRI_UPDATER: '1',
      CRANBERRI_UPDATER_FAIL_AFTER: 'candidatePromoted',
      CRANBERRI_UPDATER_HEALTH_TIMEOUT_MS: '1',
      ELECTRON_RUN_AS_NODE: '1',
      PATH: '/usr/bin',
    })).toEqual({ PATH: '/usr/bin' })
  })

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

  for (const phase of ['preflighting', 'prepared', 'candidateCopied', 'backupPromoted', 'candidatePromoted', 'relaunching', 'rollbackPrepared', 'rollbackFailed', 'rollbackRelaunchFailed']) {
    it(`records diagnostics and relaunches the previous app after interruption at ${phase}`, () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cranberri-watchdog-phase-'))
      roots.push(root)
      const currentAppPath = path.join(root, 'Cranberri.app')
      const backupAppPath = path.join(root, '.Cranberri.previous.app')
      const resultManifestPath = path.join(root, 'result.json')
      const journalPath = path.join(root, 'journal.json')
      const afterBackup = ['backupPromoted', 'candidatePromoted', 'relaunching', 'rollbackPrepared', 'rollbackFailed', 'rollbackRelaunchFailed'].includes(phase)
      if (phase !== 'backupPromoted') {
        fs.mkdirSync(currentAppPath)
        fs.writeFileSync(path.join(currentAppPath, 'version'), afterBackup ? 'candidate' : 'previous')
      }
      if (afterBackup) {
        fs.mkdirSync(backupAppPath)
        fs.writeFileSync(path.join(backupAppPath, 'version'), 'previous')
      }
      const journal = {
        phase,
        currentAppPath,
        backupAppPath,
        candidateAppPath: path.join(root, '.Cranberri.candidate.app'),
        resultManifestPath,
        journalPath,
        installId: `phase-${phase}`,
      }
      fs.writeFileSync(journalPath, JSON.stringify(journal))
      const launched = []

      expect(handleInterruptedInstall(journal, { launchApp: (appPath) => launched.push(appPath) })).toMatchObject({
        recovered: true,
        relaunched: true,
      })
      expect(launched).toEqual([currentAppPath])
      expect(fs.readFileSync(path.join(currentAppPath, 'version'), 'utf8')).toBe('previous')
      expect(JSON.parse(fs.readFileSync(resultManifestPath, 'utf8'))).toMatchObject({
        success: false,
        phase: phase === 'relaunching' ? 'relaunching' : 'preparing',
      })
      expect(JSON.parse(fs.readFileSync(journalPath, 'utf8')).phase).toBe('rolledBack')
    })
  }

  it.each(['healthAcknowledged', 'rolledBack'])('leaves terminal phase %s untouched', (phase) => {
    const launched = []
    expect(handleInterruptedInstall({ phase }, { launchApp: (appPath) => launched.push(appPath) })).toEqual({
      recovered: false,
      relaunched: false,
    })
    expect(launched).toEqual([])
  })

  it('does not restore a stale backup during a pre-backup phase', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cranberri-watchdog-stale-backup-'))
    roots.push(root)
    const currentAppPath = path.join(root, 'Cranberri.app')
    const backupAppPath = path.join(root, '.Cranberri.previous.app')
    const journalPath = path.join(root, 'journal.json')
    const resultManifestPath = path.join(root, 'result.json')
    fs.mkdirSync(currentAppPath)
    fs.mkdirSync(backupAppPath)
    fs.writeFileSync(path.join(currentAppPath, 'version'), 'still-current')
    fs.writeFileSync(path.join(backupAppPath, 'version'), 'stale-backup')
    const journal = {
      phase: 'preflighting', currentAppPath, backupAppPath, journalPath,
      resultManifestPath, installId: 'stale-backup',
    }
    const launched = []

    expect(handleInterruptedInstall(journal, { launchApp: (appPath) => launched.push(appPath) })).toMatchObject({
      recovered: true,
      relaunched: true,
    })

    expect(launched).toEqual([currentAppPath])
    expect(fs.readFileSync(path.join(currentAppPath, 'version'), 'utf8')).toBe('still-current')
    expect(fs.readFileSync(path.join(backupAppPath, 'version'), 'utf8')).toBe('stale-backup')
  })

  it.each(['prepared', 'candidateCopied', 'backupPromoted'])('preserves an owned candidate after interruption at %s', (phase) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cranberri-watchdog-candidate-'))
    roots.push(root)
    const currentAppPath = path.join(root, 'Cranberri.app')
    const candidateAppPath = path.join(root, '.Cranberri.candidate.app')
    const backupAppPath = path.join(root, '.Cranberri.previous.app')
    const journalPath = path.join(root, 'journal.json')
    const resultManifestPath = path.join(root, 'result.json')
    if (phase === 'backupPromoted') fs.mkdirSync(backupAppPath)
    else fs.mkdirSync(currentAppPath)
    fs.mkdirSync(candidateAppPath)
    fs.writeFileSync(path.join(candidateAppPath, 'version'), 'candidate')
    if (phase === 'backupPromoted') fs.writeFileSync(path.join(backupAppPath, 'version'), 'previous')
    const installId = `candidate-${phase}`

    expect(handleInterruptedInstall({
      phase, currentAppPath, candidateAppPath, backupAppPath, journalPath,
      resultManifestPath, installId,
    }, { launchApp: () => undefined })).toMatchObject({ recovered: true, relaunched: true })

    expect(fs.existsSync(candidateAppPath)).toBe(false)
    expect(fs.readFileSync(`${candidateAppPath}.failed-${installId}/version`, 'utf8')).toBe('candidate')
    expect(fs.existsSync(currentAppPath)).toBe(true)
  })

  it('uses trusted fallbacks when the journal is missing or invalid', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cranberri-watchdog-fallback-'))
    roots.push(root)
    const currentAppPath = path.join(root, 'Cranberri.app')
    const backupAppPath = path.join(root, '.Cranberri.previous.app')
    const journalPath = path.join(root, 'journal.json')
    const resultManifestPath = path.join(root, 'result.json')
    fs.mkdirSync(currentAppPath)
    fs.mkdirSync(backupAppPath)
    fs.writeFileSync(path.join(currentAppPath, 'version'), 'candidate')
    fs.writeFileSync(path.join(backupAppPath, 'version'), 'previous')
    fs.writeFileSync(journalPath, '{bad-json')
    const launched = []

    expect(handleInterruptedInstall(null, {
      fallback: { currentAppPath, backupAppPath, journalPath, resultManifestPath, installId: 'fallback' },
      launchApp: (appPath) => launched.push(appPath),
      detail: 'Updater journal is missing or invalid',
    })).toMatchObject({ recovered: true, relaunched: true })

    expect(launched).toEqual([currentAppPath])
    expect(fs.readFileSync(path.join(currentAppPath, 'version'), 'utf8')).toBe('previous')
    expect(JSON.parse(fs.readFileSync(resultManifestPath, 'utf8')).message).toMatch(/journal is missing or invalid/)
  })
})
