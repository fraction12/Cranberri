import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createDailyDriverFixtures,
  trashDailyDriverFixtures,
} from './daily-driver-fixtures.mjs'
import {
  finishEvidenceRecord,
  startEvidenceRecord,
  trashEvidenceArtifacts,
} from './daily-driver-evidence.mjs'

const fixtureRoots: string[] = []
const evidenceRoots: string[] = []

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

afterEach(() => {
  for (const root of fixtureRoots.splice(0)) {
    if (fs.existsSync(root)) trashDailyDriverFixtures(root)
  }
  for (const root of evidenceRoots.splice(0)) {
    if (fs.existsSync(root)) trashEvidenceArtifacts(root)
  }
})

describe('daily-driver UAT fixtures', () => {
  it('creates deterministic local, worktree, handoff, dirty, and error cases under the OS temp root', () => {
    const first = createDailyDriverFixtures()
    const second = createDailyDriverFixtures()
    fixtureRoots.push(first.root, second.root)

    expect(fs.realpathSync(first.root).startsWith(`${fs.realpathSync(os.tmpdir())}${path.sep}`)).toBe(true)
    expect(first.fixtureSha).toBe(second.fixtureSha)
    expect(Object.keys(first.cases)).toEqual(['local', 'worktree', 'handoff', 'dirty', 'error'])

    expect(git(first.cases.local.repoPath, 'branch', '--show-current')).toBe('main')
    expect(git(first.cases.worktree.repoPath, 'branch', '--show-current')).toBe('uat/worktree')
    expect(git(first.cases.handoff.repoPath, 'branch', '--show-current')).toBe('uat/handoff')
    expect(git(first.cases.dirty.repoPath, 'status', '--porcelain')).toContain('dirty-tracked.txt')
    expect(fs.existsSync(first.cases.error.missingCheckoutPath)).toBe(false)
    expect(() => git(first.cases.error.notGitPath, 'status', '--porcelain')).toThrow()

    const seededRegistry = JSON.parse(fs.readFileSync(path.join(first.userDataPath, 'repos.json'), 'utf8'))
    expect(seededRegistry.repos).toEqual([expect.objectContaining({ path: first.cases.local.repoPath })])
    expect(JSON.stringify(seededRegistry)).not.toContain(process.cwd())
  })

  it('rejects non-temp fixture roots and delegates cleanup only to /usr/bin/trash', () => {
    expect(() => createDailyDriverFixtures({ tempRoot: process.cwd() })).toThrow(/OS temp root/)

    const fixture = createDailyDriverFixtures()
    fixtureRoots.push(fixture.root)
    const calls: Array<{ file: string; args: string[] }> = []
    trashDailyDriverFixtures(fixture.root, {
      execFile: (file, args) => {
        calls.push({ file, args })
        return ''
      },
    })

    expect(calls).toEqual([{ file: '/usr/bin/trash', args: [fixture.root] }])
    expect(fs.existsSync(fixture.root)).toBe(true)
  })
})

describe('daily-driver UAT evidence', () => {
  it('records installed build metadata, fixture identity, machine data, timings, assertions, and raw evidence paths', () => {
    const fixture = createDailyDriverFixtures()
    fixtureRoots.push(fixture.root)

    const started = startEvidenceRecord({
      scenarioId: 'DD-01',
      fixtureManifestPath: fixture.manifestPath,
      appMetadata: {
        version: '0.1.11',
        build: '1011',
        bundleId: 'com.fraction12.cranberri',
        path: '/Applications/Cranberri.app',
      },
    })
    evidenceRoots.push(started.artifactRoot)
    const screenshotPath = path.join(started.artifactRoot, 'after.png')
    fs.writeFileSync(screenshotPath, 'sanitized fixture screenshot placeholder')

    const record = finishEvidenceRecord(started.recordPath, {
      timings: { launchToUsableMs: 842 },
      stateAssertions: [{ id: 'workspace-visible', passed: true, actual: 'local fixture selected' }],
      severity: 'none',
      result: 'pass',
      evidencePaths: [{ kind: 'screenshot-after', path: screenshotPath }],
    })

    expect(record).toMatchObject({
      schemaVersion: 1,
      scenarioId: 'DD-01',
      fixtureSha: fixture.fixtureSha,
      app: {
        version: '0.1.11',
        build: '1011',
        bundleId: 'com.fraction12.cranberri',
        path: '/Applications/Cranberri.app',
      },
      timings: { launchToUsableMs: 842 },
      severity: 'none',
      result: 'pass',
    })
    expect(record.machine).toEqual(expect.objectContaining({ platform: process.platform, arch: process.arch }))
    expect(record.stateAssertions).toEqual([
      { id: 'workspace-visible', passed: true, actual: 'local fixture selected' },
    ])
    expect(record.evidencePaths).toEqual([{ kind: 'screenshot-after', path: screenshotPath }])
    expect(started.recordPath.startsWith(`${fs.realpathSync(os.tmpdir())}${path.sep}`)).toBe(true)
  })

  it('uses trash-only evidence cleanup and rejects incomplete installed app metadata', () => {
    const fixture = createDailyDriverFixtures()
    fixtureRoots.push(fixture.root)
    expect(() => startEvidenceRecord({
      scenarioId: 'DD-01',
      fixtureManifestPath: fixture.manifestPath,
      appMetadata: { version: '0.1.11', build: '', bundleId: 'test', path: '/Applications/Test.app' },
    })).toThrow(/requires build/)

    const started = startEvidenceRecord({
      scenarioId: 'DD-01',
      fixtureManifestPath: fixture.manifestPath,
      appMetadata: { version: '0.1.11', build: '1011', bundleId: 'test', path: '/Applications/Test.app' },
    })
    evidenceRoots.push(started.artifactRoot)
    const calls: Array<{ file: string; args: string[] }> = []
    trashEvidenceArtifacts(started.artifactRoot, {
      execFile: (file, args) => {
        calls.push({ file, args })
        return ''
      },
    })
    expect(calls).toEqual([{ file: '/usr/bin/trash', args: [started.artifactRoot] }])
  })
})

describe('daily-driver UAT corpus', () => {
  it('gives every versioned scenario deterministic preconditions and pass conditions', () => {
    const scenarios = fs.readFileSync(
      path.resolve('docs/uat/daily-driver-scenarios.md'),
      'utf8',
    )
    const headings = [...scenarios.matchAll(/^### (DD-[0-9]{2}) /gm)].map((match) => match[1])
    expect(headings).toEqual(Array.from({ length: 14 }, (_, index) => `DD-${String(index + 1).padStart(2, '0')}`))

    for (const scenarioId of headings) {
      const section = scenarios.split(`### ${scenarioId} `)[1]?.split('\n### DD-')[0] ?? ''
      expect(section, `${scenarioId} preconditions`).toContain('**Preconditions:**')
      expect(section, `${scenarioId} pass conditions`).toContain('**Pass conditions:**')
    }
  })

  it('keeps production cleanup free of direct filesystem deletion APIs', () => {
    const sources = [
      'scripts/uat/daily-driver-fixtures.mjs',
      'scripts/uat/daily-driver-evidence.mjs',
    ].map((file) => fs.readFileSync(path.resolve(file), 'utf8')).join('\n')

    expect(sources).not.toMatch(/\b(?:rm|rmSync|rmdir|rmdirSync|unlink|unlinkSync)\s*\(/)
    expect(sources).toContain("execFile('/usr/bin/trash'")
  })
})
