import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_APP_STATE } from '../shared/appState'
import {
  appStateBackupPath,
  incrementBindingRevision,
  parseAppState,
  readAppStateFile,
  readPersistedAppState,
  writeAppStateFile,
  writePersistedAppState,
} from './appState'

const temporaryDirectories: string[] = []

function appStatePath(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cranberri-app-state-'))
  temporaryDirectories.push(directory)
  return path.join(directory, 'app-state.json')
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    execFileSync('/usr/bin/trash', [directory])
  }
})

describe('parseAppState', () => {
  it('migrates v1 workspaces and path-keyed pins to project-only v3 state', () => {
    const parsed = parseAppState({
      version: 1,
      expandedRepoIds: { project: true },
      workspacesByRepoId: {
        project: {
          activeWindowId: 'session-thread-1',
          windows: [
            { id: 'session-thread-1', type: 'chat', title: 'Keep me' },
            { id: 'term-1', type: 'terminal', title: 'Terminal' },
          ],
        },
      },
      pinnedCodexSessionIdsByRepoPath: { '/repo': ['thread-1', 'thread-2'] },
      pinnedCodexSessionsByRepoPath: {
        '/repo': [{ id: 'thread-1', title: 'Pinned', archived: true, updatedAt: 123 }],
      },
    }, {
      projects: [{ id: 'project', localPath: '/repo', localCheckoutId: 'checkout' }],
    })

    expect(parsed).toEqual({
      version: 3,
      expandedProjectIds: { project: true },
      workspacesByProjectId: {
        project: {
          activeWindowId: 'session-thread-1',
          windows: [
            {
              id: 'session-thread-1',
              type: 'chat',
              title: 'Keep me',
              projectId: 'project',
              taskId: null,
              checkoutId: 'checkout',
              sessionTarget: 'local',
              threadId: 'thread-1',
              bindingRevision: 0,
            },
            {
              id: 'term-1',
              type: 'terminal',
              title: 'Terminal',
              projectId: 'project',
              taskId: null,
              checkoutId: 'checkout',
              sessionTarget: 'local',
              bindingRevision: 0,
            },
          ],
        },
      },
      pinnedCodexSessionsByProjectId: {
        project: [
          { id: 'thread-1', title: 'Pinned', archived: true, updatedAt: 123 },
          { id: 'thread-2' },
        ],
      },
    })
    expect(parsed).not.toHaveProperty('expandedRepoIds')
    expect(parsed).not.toHaveProperty('workspacesByRepoId')
    expect(parsed).not.toHaveProperty('pinnedCodexSessionsByRepoPath')
  })

  it('migrates project-keyed v2 state without consulting duplicate legacy maps', () => {
    const parsed = parseAppState({
      version: 2,
      expandedProjectIds: { project: true },
      workspacesByProjectId: {
        project: {
          activeWindowId: 'session-thread-project',
          windows: [{ id: 'session-thread-project', type: 'chat', title: 'Project chat' }],
        },
      },
      pinnedCodexSessionsByProjectId: { project: [{ id: 'thread-project', title: 'Project pin' }] },
      expandedRepoIds: { legacy: true },
      workspacesByRepoId: {
        legacy: {
          activeWindowId: 'session-thread-legacy',
          windows: [{ id: 'session-thread-legacy', type: 'chat', title: 'Legacy chat' }],
        },
      },
      pinnedCodexSessionIdsByRepoPath: { '/legacy': ['thread-legacy'] },
      pinnedCodexSessionsByRepoPath: { '/legacy': [{ id: 'thread-legacy' }] },
    })

    expect(parsed).toEqual({
      version: 3,
      expandedProjectIds: { project: true },
      workspacesByProjectId: {
        project: {
          activeWindowId: 'session-thread-project',
          windows: [{
            id: 'session-thread-project',
            type: 'chat',
            title: 'Project chat',
            threadId: 'thread-project',
            bindingRevision: 0,
          }],
        },
      },
      pinnedCodexSessionsByProjectId: { project: [{ id: 'thread-project', title: 'Project pin' }] },
    })
  })

  it('derives thread ids only from valid session chat window ids', () => {
    const parsed = parseAppState({
      version: 2,
      expandedProjectIds: {},
      workspacesByProjectId: {
        project: {
          activeWindowId: 'session-',
          windows: [
            { id: 'session-', type: 'chat', title: 'Empty' },
            { id: 'session-has space', type: 'chat', title: 'Whitespace' },
            { id: 'session-terminal-thread', type: 'terminal', title: 'Terminal' },
          ],
        },
      },
      pinnedCodexSessionsByProjectId: {},
      expandedRepoIds: {},
      workspacesByRepoId: {},
      pinnedCodexSessionIdsByRepoPath: {},
      pinnedCodexSessionsByRepoPath: {},
    })

    expect(parsed.workspacesByProjectId.project.windows).toEqual([
      { id: 'session-', type: 'chat', title: 'Empty', bindingRevision: 0 },
      { id: 'session-has space', type: 'chat', title: 'Whitespace', bindingRevision: 0 },
      { id: 'session-terminal-thread', type: 'terminal', title: 'Terminal', bindingRevision: 0 },
    ])
  })

  it('accepts valid v3 browser metadata and rejects writable legacy maps', () => {
    const parsed = parseAppState({
      version: 3,
      expandedProjectIds: {},
      workspacesByProjectId: {
        project: {
          activeWindowId: 'browser-1',
          windows: [{
            id: 'browser-1',
            type: 'browser',
            title: 'Browser',
            bindingRevision: 4,
            browser: {
              url: 'https://example.com',
              title: 'Example',
              profileId: 'repo-main',
              viewportMode: 'responsive',
            },
          }],
        },
      },
      pinnedCodexSessionsByProjectId: {},
    })

    expect(parsed.workspacesByProjectId.project.windows[0]).toMatchObject({
      bindingRevision: 4,
      browser: { url: 'https://example.com', profileId: 'repo-main' },
    })
    expect(() => parseAppState({ ...parsed, expandedRepoIds: {} })).toThrow()
  })
})

describe('incrementBindingRevision', () => {
  it('increments revisions monotonically and rejects overflow', () => {
    expect(incrementBindingRevision(0)).toBe(1)
    expect(incrementBindingRevision(41)).toBe(42)
    expect(() => incrementBindingRevision(Number.MAX_SAFE_INTEGER)).toThrow('Cannot increment binding revision')
  })
})

describe('app-state persistence', () => {
  it('atomically writes validated v3 state and rotates the previous primary to last-known-good', () => {
    const target = appStatePath()
    const first = {
      ...DEFAULT_APP_STATE,
      expandedProjectIds: { first: true },
    }
    const second = {
      ...DEFAULT_APP_STATE,
      expandedProjectIds: { second: true },
    }

    writeAppStateFile(target, first)
    writeAppStateFile(target, second)

    expect(readAppStateFile(target)).toEqual({ state: second, source: 'primary' })
    expect(readAppStateFile(appStateBackupPath(target))).toEqual({ state: first, source: 'primary' })
  })

  it('recovers deterministically from a corrupt primary using the last-known-good snapshot', () => {
    const target = appStatePath()
    const lastKnownGood = {
      ...DEFAULT_APP_STATE,
      expandedProjectIds: { recoverable: true },
    }
    writeAppStateFile(target, lastKnownGood)
    writeAppStateFile(target, { ...DEFAULT_APP_STATE, expandedProjectIds: { newer: true } })
    fs.writeFileSync(target, '{"version":3')

    expect(readAppStateFile(target)).toEqual({ state: lastKnownGood, source: 'backup' })
  })

  it('does not replace a valid backup with a corrupt primary during a later write', () => {
    const target = appStatePath()
    const lastKnownGood = {
      ...DEFAULT_APP_STATE,
      expandedProjectIds: { recoverable: true },
    }
    writeAppStateFile(target, lastKnownGood)
    writeAppStateFile(target, { ...DEFAULT_APP_STATE, expandedProjectIds: { newer: true } })
    fs.writeFileSync(target, '{"version":3')

    writeAppStateFile(target, { ...DEFAULT_APP_STATE, expandedProjectIds: { replacement: true } })
    fs.writeFileSync(target, '{"version":3')

    expect(readAppStateFile(target)).toEqual({ state: lastKnownGood, source: 'backup' })
  })

  it('fails closed when the primary and backup are both corrupt', () => {
    const target = appStatePath()
    fs.writeFileSync(target, '{"version":3')
    fs.writeFileSync(appStateBackupPath(target), '{"version":2')

    expect(() => readAppStateFile(target)).toThrow('Cannot read app state primary or backup')
  })

  it('uses the backup after an interrupted promotion leaves the primary missing', () => {
    const target = appStatePath()
    const backup = appStateBackupPath(target)
    const lastKnownGood = {
      ...DEFAULT_APP_STATE,
      expandedProjectIds: { recoverable: true },
    }
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(backup, JSON.stringify(lastKnownGood))

    expect(readAppStateFile(target)).toEqual({ state: lastKnownGood, source: 'backup' })
  })

  it('blocks later writes when persisted state is unavailable', () => {
    const target = appStatePath()
    fs.writeFileSync(target, '{"version":3')
    fs.writeFileSync(appStateBackupPath(target), '{"version":2')

    expect(() => readPersistedAppState(target, { projects: [] })).toThrow(
      'Cannot read app state primary or backup',
    )
    expect(() => writePersistedAppState(DEFAULT_APP_STATE, target)).toThrow(
      'Cannot write app state while persisted state is unavailable',
    )
    expect(fs.readFileSync(target, 'utf8')).toBe('{"version":3')

    readPersistedAppState(path.join(path.dirname(target), 'fresh.json'), { projects: [] })
  })
})
