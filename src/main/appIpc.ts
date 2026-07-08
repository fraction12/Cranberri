import path from 'node:path'
import { writeFile } from 'node:fs/promises'
import { app, dialog, ipcMain, shell } from 'electron'
import { exportTextFileParamsSchema, type ExportTextFileParams, type ExportTextFileResult } from '../shared/app'
import { buildInfo } from '../shared/buildInfo'

function validateAbsolutePath(filePath: unknown): string {
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) {
    throw new Error('Expected an absolute local path')
  }
  return filePath
}

async function openPath(filePath: string): Promise<{ ok: true }> {
  const error = await shell.openPath(filePath)
  if (error) throw new Error(error)
  return { ok: true }
}

function revealPath(filePath: string): { ok: true } {
  shell.showItemInFolder(filePath)
  return { ok: true }
}

async function exportTextFile(params: ExportTextFileParams): Promise<ExportTextFileResult> {
  const result = await dialog.showSaveDialog({
    defaultPath: params.defaultPath,
    filters: params.filters,
    properties: ['createDirectory', 'showOverwriteConfirmation'],
  })
  if (result.canceled || !result.filePath) return { canceled: true }

  const filePath = validateAbsolutePath(result.filePath)
  await writeFile(filePath, params.content, 'utf8')
  return { canceled: false, path: filePath }
}

export function initAppIpc(): void {
  ipcMain.handle('app:get-version', () => app.getVersion())
  ipcMain.handle('app:open-external', async (_, url: string) => shell.openExternal(url))
  ipcMain.handle('app:open-path', async (_, filePath: unknown) => openPath(validateAbsolutePath(filePath)))
  ipcMain.handle('app:reveal-path', (_, filePath: unknown) => revealPath(validateAbsolutePath(filePath)))
  ipcMain.handle('app:export-text-file', async (_, params: unknown) => exportTextFile(exportTextFileParamsSchema.parse(params)))
  ipcMain.handle('app:build-info', () => buildInfo)
}
