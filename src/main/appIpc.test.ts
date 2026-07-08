import { beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const handlers = new Map<string, (...args: unknown[]) => unknown>()

vi.mock('electron', () => ({
  app: {
    getVersion: vi.fn(() => '0.1.3'),
  },
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler)
    }),
  },
  dialog: {
    showSaveDialog: vi.fn(async () => ({ canceled: true, filePath: '' })),
  },
  shell: {
    openExternal: vi.fn(async () => undefined),
    openPath: vi.fn(async () => ''),
    showItemInFolder: vi.fn(),
  },
}))

import { dialog, shell } from 'electron'
import { initAppIpc } from './appIpc'

describe('app IPC', () => {
  beforeEach(() => {
    handlers.clear()
    vi.clearAllMocks()
    initAppIpc()
  })

  it('opens and reveals absolute local paths through Electron shell', async () => {
    await expect(handlers.get('app:open-path')?.({}, '/tmp/Cranberri/README.md')).resolves.toEqual({ ok: true })
    expect(shell.openPath).toHaveBeenCalledWith('/tmp/Cranberri/README.md')

    expect(handlers.get('app:reveal-path')?.({}, '/tmp/Cranberri/README.md')).toEqual({ ok: true })
    expect(shell.showItemInFolder).toHaveBeenCalledWith('/tmp/Cranberri/README.md')
  })

  it('rejects relative paths before calling shell helpers', async () => {
    await expect(handlers.get('app:open-path')?.({}, 'README.md')).rejects.toThrow('Expected an absolute local path')
    expect(() => handlers.get('app:reveal-path')?.({}, 'README.md')).toThrow('Expected an absolute local path')
    expect(shell.openPath).not.toHaveBeenCalled()
    expect(shell.showItemInFolder).not.toHaveBeenCalled()
  })

  it('surfaces openPath failures', async () => {
    vi.mocked(shell.openPath).mockResolvedValueOnce('No app can open this file')

    await expect(handlers.get('app:open-path')?.({}, '/tmp/Cranberri/unknown.bin')).rejects.toThrow('No app can open this file')
  })

  it('exports text files through a native save dialog', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cranberri-export-'))
    const exportPath = path.join(tempDir, 'Smoke Thread.md')
    vi.mocked(dialog.showSaveDialog).mockResolvedValueOnce({ canceled: false, filePath: exportPath })

    await expect(handlers.get('app:export-text-file')?.({}, {
      defaultPath: 'Smoke Thread.md',
      content: '# Smoke Thread\n',
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    })).resolves.toEqual({ canceled: false, path: exportPath })

    expect(dialog.showSaveDialog).toHaveBeenCalledWith({
      defaultPath: 'Smoke Thread.md',
      filters: [{ name: 'Markdown', extensions: ['md'] }],
      properties: ['createDirectory', 'showOverwriteConfirmation'],
    })
    await expect(fs.readFile(exportPath, 'utf8')).resolves.toBe('# Smoke Thread\n')
    await fs.rm(tempDir, { recursive: true, force: true })
  })

  it('does not write a file when export is canceled', async () => {
    vi.mocked(dialog.showSaveDialog).mockResolvedValueOnce({ canceled: true, filePath: '' })

    await expect(handlers.get('app:export-text-file')?.({}, {
      content: 'No file',
    })).resolves.toEqual({ canceled: true })
  })

  it('rejects invalid export payloads', async () => {
    await expect(handlers.get('app:export-text-file')?.({}, {
      filters: [{ name: '', extensions: [] }],
      content: 'Invalid',
    })).rejects.toThrow()
    expect(dialog.showSaveDialog).not.toHaveBeenCalled()
  })
})
