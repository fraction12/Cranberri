import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const childProcess = vi.hoisted(() => ({
  signature: 'unsigned' as 'unsigned' | 'adHoc' | 'developerId' | 'other',
  nativeStatus: 0,
  nativeChecks: 0,
}))

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/cranberri-updater-test', isPackaged: false },
  BrowserWindow: { getAllWindows: () => [] },
  ipcMain: { handle: vi.fn() },
  shell: { trashItem: vi.fn() },
}))

vi.mock('./settings', () => ({
  readSettings: () => ({ updater: { channel: 'stable', sourceRepoPath: null } }),
}))

vi.mock('./updater-preflight', () => ({ assertUpdateQuiescent: vi.fn() }))

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  return {
    ...actual,
    execFileSync: (command: string) => {
      if (command === '/usr/bin/plutil') {
        return JSON.stringify({
          CFBundleIdentifier: 'com.dushyantgarg.cranberri',
          CFBundleShortVersionString: '0.2.0',
          LSMinimumSystemVersion: '13.0',
        })
      }
      if (command === '/usr/bin/file') return 'Mach-O 64-bit executable arm64'
      throw new Error(`Unexpected command: ${command}`)
    },
    spawnSync: (command: string, args: string[]) => {
      if (command === '/usr/bin/codesign' && args[0] === '-dv') {
        const stderr = childProcess.signature === 'developerId'
          ? 'Authority=Developer ID Application: Cranberri'
          : childProcess.signature === 'adHoc'
            ? 'Signature=adhoc'
            : childProcess.signature === 'unsigned'
              ? 'code object is not signed at all'
              : 'Authority=Apple Development: Cranberri'
        return { status: 0, stdout: '', stderr }
      }
      if (command === '/usr/bin/codesign') return { status: 0, stdout: '', stderr: '' }
      childProcess.nativeChecks += 1
      return { status: childProcess.nativeStatus, stdout: '', stderr: childProcess.nativeStatus ? 'native load failed' : '' }
    },
  }
})

import {
  assertCandidateSignaturePolicy,
  canonicalCranberriRemote,
  compareSemanticVersions,
  consumePendingResult,
  stableCandidateDisposition,
  validateStagedApp,
} from './updater'

const roots: string[] = []

function appFixture(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cranberri-updater-validation-'))
  roots.push(root)
  const appPath = path.join(root, 'Cranberri.app')
  fs.mkdirSync(path.join(appPath, 'Contents', 'MacOS'), { recursive: true })
  fs.writeFileSync(path.join(appPath, 'Contents', 'Info.plist'), '')
  fs.writeFileSync(path.join(appPath, 'Contents', 'MacOS', 'Cranberri'), '')
  return appPath
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
  childProcess.signature = 'unsigned'
  childProcess.nativeStatus = 0
  childProcess.nativeChecks = 0
  delete process.env.CRANBERRI_UPDATER_ROLLBACK_VERSION
})

describe('updater source provenance', () => {
  it.each([
    ['https://github.com/fraction12/Cranberri.git', 'github.com/fraction12/cranberri'],
    ['git@github.com:fraction12/Cranberri.git', 'github.com/fraction12/cranberri'],
    ['ssh://git@github.com/fraction12/Cranberri.git', 'github.com/fraction12/cranberri'],
  ])('canonicalizes the private Cranberri GitHub remote %s', (remote, canonical) => {
    expect(canonicalCranberriRemote(remote)).toBe(canonical)
  })

  it.each([
    'https://github.com/fraction12/not-cranberri.git',
    'https://github.example.com/fraction12/Cranberri.git',
    'https://evil.test/github.com/fraction12/Cranberri.git',
    '/Users/me/Cranberri',
  ])('rejects a non-canonical beta source remote %s', (remote) => {
    expect(canonicalCranberriRemote(remote)).toBeNull()
  })
})

describe('updater candidate policy', () => {
  it('permits an unsigned local beta while still running native validation', () => {
    const appPath = appFixture()
    validateStagedApp(appPath, {
      identifier: 'com.dushyantgarg.cranberri',
      version: '0.2.0',
      architecture: 'arm64',
      minimumSystemVersion: '13.0',
      signature: 'unsigned',
    }, 'beta', { currentSystemVersion: '14.0' })
    expect(childProcess.nativeChecks).toBe(1)
  })

  it('requires Developer ID signing for stable candidates', () => {
    expect(() => assertCandidateSignaturePolicy('stable', 'unsigned', 'unsigned')).toThrow(/Developer ID/)
    expect(() => assertCandidateSignaturePolicy('stable', 'adHoc', 'adHoc')).toThrow(/Developer ID/)
    expect(() => assertCandidateSignaturePolicy('stable', 'developerId', 'developerId')).not.toThrow()
  })

  it('rejects a beta candidate whose native modules do not load', () => {
    const appPath = appFixture()
    childProcess.nativeStatus = 1
    expect(() => validateStagedApp(appPath, {
      identifier: 'com.dushyantgarg.cranberri',
      version: '0.2.0',
      architecture: 'arm64',
      minimumSystemVersion: '13.0',
      signature: 'unsigned',
    }, 'beta', { currentSystemVersion: '14.0' })).toThrow(/native module validation failed/i)
  })
})

describe('stable semantic version discovery', () => {
  it('orders releases using semantic versions rather than commits or lexical strings', () => {
    expect(compareSemanticVersions('0.1.11', '0.1.12')).toBe(-1)
    expect(compareSemanticVersions('0.1.11', '0.1.11')).toBe(0)
    expect(compareSemanticVersions('0.10.0', '0.2.0')).toBe(1)
    expect(compareSemanticVersions('1.0.0-beta.2', '1.0.0')).toBe(-1)
  })

  it('accepts only newer stable releases by default', () => {
    expect(stableCandidateDisposition('0.1.11', '0.1.12', null)).toBe('update')
    expect(stableCandidateDisposition('0.1.11', '0.1.11', null)).toBe('upToDate')
    expect(() => stableCandidateDisposition('0.1.11', '0.1.10', null)).toThrow(/older/)
  })

  it('allows an older release only through an exact rollback target', () => {
    expect(stableCandidateDisposition('0.1.11', '0.1.10', '0.1.10')).toBe('rollback')
    expect(() => stableCandidateDisposition('0.1.11', '0.1.10', '0.1.9')).toThrow(/older/)
  })
})

describe('update result consumption', () => {
  it('atomically consumes a pending result once', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cranberri-updater-result-'))
    roots.push(root)
    const resultPath = path.join(root, 'updater-result.json')
    fs.writeFileSync(resultPath, JSON.stringify({
      success: false,
      phase: 'preparing',
      message: 'Recovered previous app',
      logPath: null,
    }))

    expect(consumePendingResult(resultPath)).toMatchObject({ message: 'Recovered previous app' })
    expect(consumePendingResult(resultPath)).toBeNull()
    expect(fs.existsSync(resultPath)).toBe(false)
    expect(fs.existsSync(`${resultPath}.consumed`)).toBe(true)
  })

  it('quarantines an invalid result instead of retrying it on every launch', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cranberri-updater-result-invalid-'))
    roots.push(root)
    const resultPath = path.join(root, 'updater-result.json')
    fs.writeFileSync(resultPath, '{bad-json')

    expect(consumePendingResult(resultPath)).toBeNull()
    expect(consumePendingResult(resultPath)).toBeNull()
    expect(fs.existsSync(`${resultPath}.consumed`)).toBe(true)
  })
})
