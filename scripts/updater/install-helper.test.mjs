import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { installFromManifest, installFromManifestPath, relaunchEnvironment } from './install-helper.mjs'

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
  it('removes Electron Node mode before relaunching the GUI', () => {
    expect(relaunchEnvironment({ ELECTRON_RUN_AS_NODE: '1', PATH: '/usr/bin' })).toEqual({ PATH: '/usr/bin' })
  })

  it('promotes a complete candidate atomically and retains the backup', async () => {
    const { manifest } = fixture()
    await installFromManifest(manifest, { relaunch: false })
    expect(fs.readFileSync(path.join(manifest.currentAppPath, 'version'), 'utf8')).toBe('new')
    expect(fs.readlinkSync(path.join(manifest.currentAppPath, 'version-link'))).toBe('version')
    expect(fs.readFileSync(path.join(manifest.backupAppPath, 'version'), 'utf8')).toBe('old')
    expect(JSON.parse(fs.readFileSync(manifest.journalPath, 'utf8')).phase).toBe('relaunching')
  })

  for (const phase of ['preflighting', 'prepared', 'candidateCopied', 'backupPromoted', 'candidatePromoted', 'relaunching']) {
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

  for (const prepareFailure of [
    {
      name: 'the staged app is missing',
      arrange: ({ manifest }) => fs.renameSync(manifest.stagedAppPath, `${manifest.stagedAppPath}.missing`),
      message: /Installed or staged app bundle is unavailable/,
    },
    {
      name: 'a stale backup exists',
      arrange: ({ manifest }) => fs.mkdirSync(manifest.backupAppPath),
      message: /previous updater backup/,
    },
    {
      name: 'a stale candidate exists',
      arrange: ({ manifest }) => fs.mkdirSync(manifest.candidateAppPath),
      message: /updater candidate already exists/,
    },
  ]) {
    it(`records diagnostics and relaunches the current app when ${prepareFailure.name}`, async () => {
      const setup = fixture()
      const launched = []
      prepareFailure.arrange(setup)

      await expect(installFromManifest(setup.manifest, {
        launchApp: (appPath) => launched.push(appPath),
      })).rejects.toThrow(prepareFailure.message)

      expect(launched).toEqual([setup.manifest.currentAppPath])
      expect(JSON.parse(fs.readFileSync(setup.manifest.resultManifestPath, 'utf8'))).toMatchObject({
        success: false,
        phase: 'preparing',
      })
      expect(JSON.parse(fs.readFileSync(setup.manifest.journalPath, 'utf8'))).toMatchObject({
        phase: 'rolledBack',
      })
    })
  }

  it('uses trusted fallback paths to diagnose an invalid manifest and relaunch the current app', async () => {
    const { root, manifest } = fixture()
    const manifestPath = path.join(root, 'invalid-manifest.json')
    fs.writeFileSync(manifestPath, '{not-json')
    const launched = []

    await expect(installFromManifestPath(manifestPath, {
      fallback: manifest,
      launchApp: (appPath) => launched.push(appPath),
    })).rejects.toThrow(/manifest/i)

    expect(launched).toEqual([manifest.currentAppPath])
    expect(JSON.parse(fs.readFileSync(manifest.resultManifestPath, 'utf8'))).toMatchObject({
      success: false,
      phase: 'preparing',
    })
  })

  it('uses trusted fallback paths when the manifest file is missing', async () => {
    const { root, manifest } = fixture()
    const launched = []

    await expect(installFromManifestPath(path.join(root, 'missing-manifest.json'), {
      fallback: manifest,
      launchApp: (appPath) => launched.push(appPath),
    })).rejects.toThrow(/manifest.*invalid/i)

    expect(launched).toEqual([manifest.currentAppPath])
    expect(JSON.parse(fs.readFileSync(manifest.resultManifestPath, 'utf8')).success).toBe(false)
  })

  it('does not trust stale app paths from a valid manifest over launcher fallbacks', async () => {
    const { root, manifest } = fixture()
    const manifestPath = path.join(root, 'stale-manifest.json')
    fs.writeFileSync(manifestPath, JSON.stringify({
      ...manifest,
      currentAppPath: path.join(root, 'Moved.app'),
      stagedAppPath: path.join(root, 'Missing.app'),
    }))
    const launched = []

    await expect(installFromManifestPath(manifestPath, {
      fallback: manifest,
      launchApp: (appPath) => launched.push(appPath),
    })).rejects.toThrow(/does not match trusted launcher context/)

    expect(launched).toEqual([manifest.currentAppPath])
    expect(fs.readFileSync(path.join(manifest.currentAppPath, 'version'), 'utf8')).toBe('old')
  })
})
