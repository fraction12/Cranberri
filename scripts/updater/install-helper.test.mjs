import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { installFromManifest } from './install-helper.mjs'

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cranberri-updater-helper-'))
  const currentAppPath = path.join(root, 'Cranberri.app')
  const stagedAppPath = path.join(root, 'staging', 'Cranberri.app')
  fs.mkdirSync(path.join(currentAppPath, 'Contents', 'MacOS'), { recursive: true })
  fs.mkdirSync(path.join(stagedAppPath, 'Contents', 'MacOS'), { recursive: true })
  fs.writeFileSync(path.join(currentAppPath, 'version'), 'old')
  fs.writeFileSync(path.join(stagedAppPath, 'version'), 'new')
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

test('promotes a complete candidate atomically and retains the backup', async (t) => {
  const { root, manifest } = fixture()
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  await installFromManifest(manifest, { relaunch: false })
  assert.equal(fs.readFileSync(path.join(manifest.currentAppPath, 'version'), 'utf8'), 'new')
  assert.equal(fs.readFileSync(path.join(manifest.backupAppPath, 'version'), 'utf8'), 'old')
  assert.equal(JSON.parse(fs.readFileSync(manifest.journalPath, 'utf8')).phase, 'relaunching')
})

for (const phase of ['candidateCopied', 'backupPromoted', 'candidatePromoted']) {
  test(`restores the previous app after failure at ${phase}`, async (t) => {
    const { root, manifest } = fixture()
    t.after(() => fs.rmSync(root, { recursive: true, force: true }))
    const previous = process.env.CRANBERRI_UPDATER_FAIL_AFTER
    process.env.CRANBERRI_UPDATER_FAIL_AFTER = phase
    await assert.rejects(installFromManifest(manifest, { relaunch: false }), /Injected updater failure/)
    if (previous === undefined) delete process.env.CRANBERRI_UPDATER_FAIL_AFTER
    else process.env.CRANBERRI_UPDATER_FAIL_AFTER = previous
    assert.equal(fs.readFileSync(path.join(manifest.currentAppPath, 'version'), 'utf8'), 'old')
    assert.equal(JSON.parse(fs.readFileSync(manifest.journalPath, 'utf8')).phase, 'rolledBack')
  })
}
