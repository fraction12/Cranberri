import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: {
    getAppPath: () => '/tmp/Cranberri.app',
    getPath: () => '/tmp/cranberri-user-data',
    getVersion: () => '0.1.3',
    isPackaged: false,
  },
  ipcMain: {
    handle: vi.fn(),
  },
  shell: {
    openPath: vi.fn(),
  },
  systemPreferences: {
    isTrustedAccessibilityClient: vi.fn(() => false),
  },
}))

vi.mock('electron-log/main', () => ({
  default: {
    info: vi.fn(),
    transports: {
      file: {
        getFile: () => ({ path: '/tmp/cranberri.log' }),
      },
    },
  },
}))

import { moduleLoadCheck, pathCheck } from './health'
import { appendBoundedJsonLine, electronLogPath, sanitizeTelemetryPayload } from './telemetry'

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { force: true, recursive: true })
  }
})

describe('diagnostics helpers', () => {
  it('redacts sensitive telemetry keys recursively', () => {
    expect(sanitizeTelemetryPayload({
      ok: true,
      token: 'secret',
      nested: {
        Authorization: 'bearer secret',
        apiKey: 'sk-secret',
        api_key: 'sk-secret-too',
        credential: 'private',
        value: 'visible',
      },
    })).toEqual({
      ok: true,
      nested: {
        value: 'visible',
      },
    })
  })

  it('exposes the native electron log path', () => {
    expect(electronLogPath()).toBe('/tmp/cranberri.log')
  })

  it('keeps the JSONL diagnostic log within its retention budget', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cranberri-telemetry-'))
    tempDirs.push(dir)
    const filePath = path.join(dir, 'debug-telemetry.jsonl')

    await appendBoundedJsonLine(filePath, `${JSON.stringify({ id: 1, value: 'a'.repeat(40) })}\n`, 120)
    await appendBoundedJsonLine(filePath, `${JSON.stringify({ id: 2, value: 'b'.repeat(40) })}\n`, 120)
    await appendBoundedJsonLine(filePath, `${JSON.stringify({ id: 3, value: 'c'.repeat(40) })}\n`, 120)

    const content = fs.readFileSync(filePath, 'utf8')
    expect(Buffer.byteLength(content)).toBeLessThanOrEqual(120)
    expect(content).toContain('"id":3')
    expect(content.split('\n').filter(Boolean).every((line) => JSON.parse(line))).toBeTruthy()
  })

  it('checks file paths without throwing', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cranberri-health-'))
    tempDirs.push(dir)
    const filePath = path.join(dir, 'exists.txt')
    fs.writeFileSync(filePath, 'ok')

    expect(pathCheck('exists', 'Existing file', filePath)).toMatchObject({ level: 'ok' })
    expect(pathCheck('missing', 'Missing file', path.join(dir, 'missing.txt'), 'error')).toMatchObject({ level: 'error' })
  })

  it('checks whether modules can be loaded by the main process', async () => {
    await expect(moduleLoadCheck('fs', 'Node fs', 'node:fs')).resolves.toMatchObject({ level: 'ok' })
    await expect(moduleLoadCheck('missing', 'Missing module', 'cranberri-missing-module')).resolves.toMatchObject({ level: 'error' })
  })
})
