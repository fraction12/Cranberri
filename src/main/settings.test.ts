import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_APP_SETTINGS, type AppSettings } from '../shared/settings'

const electron = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  userDataPath: '',
}))

vi.mock('electron', () => ({
  app: { getPath: () => electron.userDataPath },
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
      electron.handlers.set(channel, handler)
    },
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
})
