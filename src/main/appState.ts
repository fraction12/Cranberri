import { app, ipcMain } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { DEFAULT_APP_STATE, type CranberriAppState } from '../shared/appState'
import { readProjectRegistry } from './repos'

const browserSchema = z.object({
  url: z.string().default('about:blank'),
  title: z.string().optional(),
  profileId: z.string().default('default'),
  viewportMode: z.enum(['responsive', 'mobile', 'tablet', 'desktop']).optional(),
  devServerProcessId: z.string().optional(),
})

const windowSchema = z.object({
  id: z.string(),
  type: z.enum(['chat', 'terminal', 'browser']),
  title: z.string(),
  projectId: z.string().optional(),
  taskId: z.string().nullable().optional(),
  checkoutId: z.string().optional(),
  sessionTarget: z.enum(['local', 'worktree']).optional(),
  browser: browserSchema.optional(),
})

const workspaceSchema = z.object({
  windows: z.array(windowSchema),
  activeWindowId: z.string().nullable(),
})

const pinSchema = z.object({
  id: z.string(),
  title: z.string().optional(),
  archived: z.boolean().optional(),
  updatedAt: z.number().nullable().optional(),
})

const legacySchema = z.object({
  version: z.literal(1),
  expandedRepoIds: z.record(z.string(), z.boolean()).default({}),
  workspacesByRepoId: z.record(z.string(), workspaceSchema).default({}),
  pinnedCodexSessionIdsByRepoPath: z.record(z.string(), z.array(z.string())).default({}),
  pinnedCodexSessionsByRepoPath: z
    .record(z.string(), z.array(pinSchema))
    .default({}),
})

const currentSchema = z.object({
  version: z.literal(2),
  expandedProjectIds: z.record(z.string(), z.boolean()),
  workspacesByProjectId: z.record(z.string(), workspaceSchema),
  pinnedCodexSessionsByProjectId: z.record(z.string(), z.array(pinSchema)),
  expandedRepoIds: z.record(z.string(), z.boolean()),
  workspacesByRepoId: z.record(z.string(), workspaceSchema),
  pinnedCodexSessionIdsByRepoPath: z.record(z.string(), z.array(z.string())),
  pinnedCodexSessionsByRepoPath: z.record(z.string(), z.array(pinSchema)),
})

type MigrationProject = {
  id: string
  localPath: string
  localCheckoutId: string
}

export function parseAppState(
  value: unknown,
  context: { projects: MigrationProject[] } = { projects: [] },
): CranberriAppState {
  const current = currentSchema.safeParse(value)
  if (current.success) return current.data

  const legacy = legacySchema.parse(value)
  const records = { ...legacy.pinnedCodexSessionsByRepoPath }
  for (const [repoPath, ids] of Object.entries(legacy.pinnedCodexSessionIdsByRepoPath)) {
    const existing = records[repoPath] ?? []
    const seen = new Set(existing.map((item) => item.id))
    records[repoPath] = [
      ...existing,
      ...ids.filter((id) => !seen.has(id)).map((id) => ({ id })),
    ]
  }

  const projects = new Map(context.projects.map((project) => [project.id, project]))
  const pins: CranberriAppState['pinnedCodexSessionsByProjectId'] = {}
  for (const project of context.projects) {
    if (records[project.localPath]) pins[project.id] = records[project.localPath]
  }

  const workspaces = Object.fromEntries(
    Object.entries(legacy.workspacesByRepoId).map(([id, workspace]) => {
      const project = projects.get(id)
      return [
        id,
        {
          ...workspace,
          windows: workspace.windows.map((window) =>
            project
              ? {
                  ...window,
                  projectId: id,
                  taskId: null,
                  checkoutId: project.localCheckoutId,
                  sessionTarget: 'local' as const,
                }
              : window,
          ),
        },
      ]
    }),
  )

  return {
    version: 2,
    expandedProjectIds: legacy.expandedRepoIds,
    workspacesByProjectId: workspaces,
    pinnedCodexSessionsByProjectId: pins,
    expandedRepoIds: legacy.expandedRepoIds,
    workspacesByRepoId: workspaces,
    pinnedCodexSessionIdsByRepoPath: legacy.pinnedCodexSessionIdsByRepoPath,
    pinnedCodexSessionsByRepoPath: records,
  }
}

function targetPath(): string {
  return path.join(app.getPath('userData'), 'app-state.json')
}

function migrationContext(): { projects: MigrationProject[] } {
  const registry = readProjectRegistry()
  const checkouts = new Map(registry.checkouts.map((item) => [item.id, item]))
  return {
    projects: registry.projects.map((project) => ({
      id: project.id,
      localPath: checkouts.get(project.localCheckoutId)?.canonicalPath ?? '',
      localCheckoutId: project.localCheckoutId,
    })),
  }
}

function read(): CranberriAppState {
  const target = targetPath()
  if (!fs.existsSync(target)) return DEFAULT_APP_STATE

  const bytes = fs.readFileSync(target, 'utf8')
  try {
    return parseAppState(JSON.parse(bytes), migrationContext())
  } catch (error) {
    throw new Error('Cannot read app state', { cause: error })
  }
}

function write(state: CranberriAppState): CranberriAppState {
  const parsed = parseAppState(state)
  const target = targetPath()
  const temporary = `${target}.${process.pid}.tmp`
  fs.mkdirSync(path.dirname(target), { recursive: true })

  try {
    fs.writeFileSync(temporary, JSON.stringify(parsed, null, 2))
    fs.renameSync(temporary, target)
    return parsed
  } catch (error) {
    fs.rmSync(temporary, { force: true })
    throw error
  }
}

export function initAppStateIpc(): void {
  ipcMain.handle('app-state:read', () => read())
  ipcMain.handle('app-state:write', (_, state: CranberriAppState) => write(state))
}
