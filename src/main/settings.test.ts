import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_APP_SETTINGS, type AppSettings } from '../shared/settings'

const electron = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  userDataPath: '',
  themeSource: 'system',
}))

vi.mock('electron', () => ({
  app: { getPath: () => electron.userDataPath },
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
      electron.handlers.set(channel, handler)
    },
  },
  nativeTheme: {
    get themeSource() { return electron.themeSource },
    set themeSource(value: string) { electron.themeSource = value },
  },
}))

import { initSettingsIpc, readSettings, writeSettings } from './settings'

const tempDirs: string[] = []

function settings(overrides: Partial<AppSettings['codex']>): AppSettings {
  return {
    ...DEFAULT_APP_SETTINGS,
    codex: { ...DEFAULT_APP_SETTINGS.codex, ...overrides },
  }
}

beforeEach(() => {
  electron.userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'cranberri-settings-'))
  tempDirs.push(electron.userDataPath)
  electron.handlers.clear()
  electron.themeSource = 'system'
})

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('Codex settings persistence', () => {
  it('persists supported GPT-5.6 Ultra defaults', () => {
    writeSettings(settings({ defaultModel: 'gpt-5.6-sol', defaultEffort: 'ultra', defaultSpeed: 'fast' }))

    expect(readSettings().codex).toMatchObject({
      defaultModel: 'gpt-5.6-sol',
      defaultEffort: 'ultra',
      defaultSpeed: 'fast',
    })
  })

  it('repairs unsupported effort and speed combinations on disk', () => {
    writeSettings(settings({ defaultModel: 'gpt-5.4-mini', defaultEffort: 'ultra', defaultSpeed: 'fast' }))

    expect(readSettings().codex).toMatchObject({
      defaultModel: 'gpt-5.4-mini',
      defaultEffort: 'medium',
      defaultSpeed: 'standard',
    })
    const persisted = JSON.parse(fs.readFileSync(path.join(electron.userDataPath, 'settings.json'), 'utf8'))
    expect(persisted.data.codex).toMatchObject({ defaultEffort: 'medium', defaultSpeed: 'standard' })
  })

  it('normalizes an incompatible settings file written by an older build', () => {
    fs.writeFileSync(path.join(electron.userDataPath, 'settings.json'), JSON.stringify({
      version: 1,
      data: settings({
        defaultModel: 'gpt-5.3-codex-spark',
        defaultEffort: 'ultra',
        defaultSpeed: 'fast',
      }),
    }))

    expect(readSettings().codex).toMatchObject({
      defaultModel: 'gpt-5.3-codex-spark',
      defaultEffort: 'high',
      defaultSpeed: 'standard',
    })
  })

  it('returns normalized settings from the IPC boundary', () => {
    initSettingsIpc()
    const setSettings = electron.handlers.get('settings:set')

    expect(setSettings?.({}, settings({
      defaultModel: 'gpt-5.6-luna',
      defaultEffort: 'ultra',
      defaultSpeed: 'fast',
    }))).toEqual({
      settings: settings({
        defaultModel: 'gpt-5.6-luna',
        defaultEffort: 'medium',
        defaultSpeed: 'fast',
      }),
    })
  })

  it('migrates older appearance settings and bounds font sizes', () => {
    fs.writeFileSync(path.join(electron.userDataPath, 'settings.json'), JSON.stringify({
      version: 1,
      data: {
        ...DEFAULT_APP_SETTINGS,
        editor: { fontSize: 99, lineWrap: true },
        terminal: { fontSize: 2 },
        appearance: { theme: 'dark' },
      },
    }))

    expect(readSettings()).toMatchObject({
      editor: { fontSize: 24 },
      terminal: { fontSize: 8 },
      appearance: {
        theme: 'dark',
        accent: 'green',
        uiFontSize: 14,
        reducedMotion: 'system',
      },
    })
  })

  it('keeps Electron native theme in sync with persisted settings', () => {
    writeSettings({
      ...DEFAULT_APP_SETTINGS,
      appearance: { ...DEFAULT_APP_SETTINGS.appearance, theme: 'dark' },
    })
    initSettingsIpc()
    expect(electron.themeSource).toBe('dark')

    const setSettings = electron.handlers.get('settings:set')
    setSettings?.({}, {
      ...DEFAULT_APP_SETTINGS,
      appearance: { ...DEFAULT_APP_SETTINGS.appearance, theme: 'light' },
    })
    expect(electron.themeSource).toBe('light')
  })
})

describe('Tool curation settings persistence', () => {
  it('migrates pre-tools settings without disturbing existing sections', () => {
    const preToolsSettings = {
      codex: {
        ...DEFAULT_APP_SETTINGS.codex,
        defaultApprovalMode: 'ask' as const,
        streamTokens: false,
      },
      editor: { fontSize: 16, lineWrap: false },
      terminal: { fontSize: 18, defaultShell: '/bin/zsh' },
      appearance: {
        theme: 'dark' as const,
        accent: 'rose' as const,
        uiFontSize: 15,
        reducedMotion: 'on' as const,
      },
      updater: { channel: 'beta' as const, sourceRepoPath: '/tmp/cranberri-source' },
    }
    fs.writeFileSync(path.join(electron.userDataPath, 'settings.json'), JSON.stringify({
      version: 2,
      data: preToolsSettings,
    }))

    expect(readSettings()).toEqual({
      ...preToolsSettings,
      tools: {
        pinnedToolIds: [],
        dismissedDefaultToolIds: [],
      },
    })
  })

  it('persists pins and default dismissals independently while retaining orphan IDs', () => {
    const tools = {
      pinnedToolIds: [
        'mcp:provider%3Aalpha:custom%3Atool',
        'browser:provider%2Fid:open',
      ],
      dismissedDefaultToolIds: ['cli:rg', 'codex:apply_patch'],
    }

    writeSettings({ ...DEFAULT_APP_SETTINGS, tools })

    expect(readSettings().tools).toEqual(tools)
    const persisted = JSON.parse(fs.readFileSync(path.join(electron.userDataPath, 'settings.json'), 'utf8'))
    expect(persisted).toMatchObject({ version: 3, data: { tools } })
  })

  it('drops malformed tool IDs without discarding valid persisted choices', () => {
    fs.writeFileSync(path.join(electron.userDataPath, 'settings.json'), JSON.stringify({
      version: 3,
      data: {
        ...DEFAULT_APP_SETTINGS,
        tools: {
          pinnedToolIds: ['cli:rg', 'not-a-catalog-id', 'mcp:github:search'],
          dismissedDefaultToolIds: ['codex:apply_patch', 'cli:bad value'],
        },
      },
    }))

    expect(readSettings().tools).toEqual({
      pinnedToolIds: ['cli:rg', 'mcp:github:search'],
      dismissedDefaultToolIds: ['codex:apply_patch'],
    })
  })
})
