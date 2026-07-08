import { app, ipcMain } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { DEFAULT_APP_STATE, type CranberriAppState } from '../shared/appState'

const workspaceWindowSchema = z.object({
  id: z.string(),
  type: z.enum(['chat', 'terminal', 'browser']),
  title: z.string(),
  browser: z.object({
    url: z.string().default('about:blank'),
    title: z.string().optional(),
    profileId: z.string().default('default'),
    viewportMode: z.enum(['responsive', 'mobile', 'tablet', 'desktop']).optional(),
    devServerProcessId: z.string().optional(),
  }).optional(),
})

const repoWorkspaceSchema = z.object({
  windows: z.array(workspaceWindowSchema),
  activeWindowId: z.string().nullable(),
})

const pinnedCodexSessionRecordSchema = z.object({
  id: z.string(),
  title: z.string().optional(),
  archived: z.boolean().optional(),
  updatedAt: z.number().nullable().optional(),
})

const appStateSchema = z.object({
  version: z.literal(1),
  expandedRepoIds: z.record(z.string(), z.boolean()).default({}),
  workspacesByRepoId: z.record(z.string(), repoWorkspaceSchema).default({}),
  pinnedCodexSessionIdsByRepoPath: z.record(z.string(), z.array(z.string())).default({}),
  pinnedCodexSessionsByRepoPath: z.record(z.string(), z.array(pinnedCodexSessionRecordSchema)).default({}),
}).transform((state) => {
  const pinnedCodexSessionsByRepoPath = { ...state.pinnedCodexSessionsByRepoPath }
  for (const [repoPath, ids] of Object.entries(state.pinnedCodexSessionIdsByRepoPath)) {
    const existing = pinnedCodexSessionsByRepoPath[repoPath] ?? []
    const existingIds = new Set(existing.map((record) => record.id))
    const migrated = ids.filter((id) => !existingIds.has(id)).map((id) => ({ id }))
    if (existing.length || migrated.length) pinnedCodexSessionsByRepoPath[repoPath] = [...existing, ...migrated]
  }
  return { ...state, pinnedCodexSessionsByRepoPath }
})

function appStatePath(): string {
  return path.join(app.getPath('userData'), 'app-state.json')
}

export function parseAppState(value: unknown): CranberriAppState {
  return appStateSchema.parse(value)
}

function readAppState(): CranberriAppState {
  try {
    const raw = fs.readFileSync(appStatePath(), 'utf8')
    return parseAppState(JSON.parse(raw))
  } catch {
    return DEFAULT_APP_STATE
  }
}

function writeAppState(state: CranberriAppState): CranberriAppState {
  const parsed = parseAppState(state)
  fs.mkdirSync(path.dirname(appStatePath()), { recursive: true })
  fs.writeFileSync(appStatePath(), JSON.stringify(parsed, null, 2))
  return parsed
}

export function initAppStateIpc(): void {
  ipcMain.handle('app-state:read', () => readAppState())
  ipcMain.handle('app-state:write', (_, state: CranberriAppState) => writeAppState(state))
}
