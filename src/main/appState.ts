import { app, ipcMain } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { DEFAULT_APP_STATE, type CranberriAppState } from '@/shared/appState'

const workspaceWindowSchema = z.object({
  id: z.string(),
  type: z.enum(['chat', 'terminal']),
  title: z.string(),
})

const repoWorkspaceSchema = z.object({
  windows: z.array(workspaceWindowSchema),
  activeWindowId: z.string().nullable(),
})

const appStateSchema = z.object({
  version: z.literal(1),
  expandedRepoIds: z.record(z.string(), z.boolean()).default({}),
  workspacesByRepoId: z.record(z.string(), repoWorkspaceSchema).default({}),
})

function appStatePath(): string {
  return path.join(app.getPath('userData'), 'app-state.json')
}

function readAppState(): CranberriAppState {
  try {
    const raw = fs.readFileSync(appStatePath(), 'utf8')
    return appStateSchema.parse(JSON.parse(raw))
  } catch {
    return DEFAULT_APP_STATE
  }
}

function writeAppState(state: CranberriAppState): CranberriAppState {
  const parsed = appStateSchema.parse(state)
  fs.mkdirSync(path.dirname(appStatePath()), { recursive: true })
  fs.writeFileSync(appStatePath(), JSON.stringify(parsed, null, 2))
  return parsed
}

export function initAppStateIpc(): void {
  ipcMain.handle('app-state:read', () => readAppState())
  ipcMain.handle('app-state:write', (_, state: CranberriAppState) => writeAppState(state))
}
