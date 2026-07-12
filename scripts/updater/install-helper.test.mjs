import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { installFromManifest } from './install-helper.mjs'

const roots = []

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cranberri-updater-helper-'))
  roots.push(root)
  const currentAppPath = path.join(root, 'Cranberri.app')
  const stagedAppPath = path.join(root, 'staging', 'Cranberri.app')
  fs.mkdirSync(path.join(currentAppPath, 'Contents', 'MacOS'), { recursive: true })
  fs.mkdirSync(path.join(stagedAppPath, 'Contents', 'MacOS'), { recursive: true })
  fs.writeFileSync(path.join(currentAppPath, 'version'), 'old')
  fs.writeFileSync(path.join(stagedAppPath, 'version'), 'new')
  fs.symlinkSync('version', path.join(stagedAppPath, 'version-link'))
  fs.writeFileSync(path.join(currentAppPath, 'Contents', 'MacOS', 'Cranberri'), '')
  fs.writeFileSync(path.join(stagedAppPath, 'Contents', 'MacOS', 'Cranberri'), '')
  const manifest = {
    installId: 'install-test', currentAppPath, stagedAppPath,
    candidateAppPath: path.join(root, '.Cranberri.candidate.app'),
    backupAppPath: path.join(root, '.Cranberri.previous.app'),
    journalPath: path.join(root, 'journal.json'),
    resultManifestPath: path.join(root, 'result.json'),
    logPath: path.join(root, 'install.log'), relaunchTarget: currentAppPath,
  }
  return { root, manifest }
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
  delete process.env.CRANBERRI_UPDATER_FAIL_AFTER
})

describe('atomic updater helper', () => {
  it('promotes a complete candidate atomically and retains the backup', async () => {
    const { manifest } = fixture()
    await installFromManifest(manifest, { relaunch: false })
    expect(fs.readFileSync(path.join(manifest.currentAppPath, 'version'), 'utf8')).toBe('new')
    expect(fs.readlinkSync(path.join(manifest.currentAppPath, 'version-link'))).toBe('version')
    expect(fs.readFileSync(path.join(manifest.backupAppPath, 'version'), 'utf8')).toBe('old')
    expect(JSON.parse(fs.readFileSync(manifest.journalPath, 'utf8')).phase).toBe('relaunching')
  })

  for (const phase of ['prepared', 'candidateCopied', 'backupPromoted', 'candidatePromoted', 'relaunching']) {
    it(`restores the previous app after failure at ${phase}`, async () => {
      const { manifest } = fixture()
      process.env.CRANBERRI_UPDATER_FAIL_AFTER = phase
      await expect(installFromManifest(manifest, { relaunch: false })).rejects.toThrow(/Injected updater failure/)
      expect(fs.readFileSync(path.join(manifest.currentAppPath, 'version'), 'utf8')).toBe('old')
      expect(JSON.parse(fs.readFileSync(manifest.journalPath, 'utf8')).phase).toBe('rolledBack')
      expect(fs.existsSync(manifest.candidateAppPath)).toBe(false)
    })
  }

  it('relaunches the restored app after a failed promotion', async () => {
    const { manifest } = fixture()
    const launched = []
    process.env.CRANBERRI_UPDATER_FAIL_AFTER = 'candidatePromoted'

    await expect(installFromManifest(manifest, { launchApp: (appPath) => launched.push(appPath) })).rejects.toThrow(
      /Injected updater failure/,
    )

    expect(launched).toEqual([manifest.currentAppPath])
    expect(fs.readFileSync(path.join(manifest.currentAppPath, 'version'), 'utf8')).toBe('old')
  })

  it('reports when the restored app cannot be relaunched', async () => {
    const { manifest } = fixture()
    process.env.CRANBERRI_UPDATER_FAIL_AFTER = 'candidatePromoted'

    await expect(
      installFromManifest(manifest, {
        launchApp: () => {
          throw new Error('launch unavailable')
        },
      }),
    ).rejects.toThrow(/restored app relaunch failed: launch unavailable/)

    const result = JSON.parse(fs.readFileSync(manifest.resultManifestPath, 'utf8'))
    expect(result.message).toContain('restored app relaunch failed: launch unavailable')
  })
})
