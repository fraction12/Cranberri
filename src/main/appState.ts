import { app, ipcMain } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import {
  DEFAULT_APP_STATE,
  type CranberriAppState,
  type RepoWorkspaceState,
} from '../shared/appState'
import { readProjectRegistry } from './repos'

const browserSchema = z.object({
  url: z.string().default('about:blank'),
  title: z.string().optional(),
  profileId: z.string().default('default'),
  viewportMode: z.enum(['responsive', 'mobile', 'tablet', 'desktop']).optional(),
  devServerProcessId: z.string().optional(),
})

const legacyWindowSchema = z.object({
  id: z.string(),
  type: z.enum(['chat', 'terminal', 'browser']),
  title: z.string(),
  projectId: z.string().optional(),
  taskId: z.string().nullable().optional(),
  checkoutId: z.string().optional(),
  sessionTarget: z.enum(['local', 'worktree']).optional(),
  browser: browserSchema.optional(),
})

const windowSchema = legacyWindowSchema.extend({
  threadId: z.string().min(1).optional(),
  bindingRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
})

const legacyWorkspaceSchema = z.object({
  windows: z.array(legacyWindowSchema),
  activeWindowId: z.string().nullable(),
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

const v1Schema = z.object({
  version: z.literal(1),
  expandedRepoIds: z.record(z.string(), z.boolean()).default({}),
  workspacesByRepoId: z.record(z.string(), legacyWorkspaceSchema).default({}),
  pinnedCodexSessionIdsByRepoPath: z.record(z.string(), z.array(z.string())).default({}),
  pinnedCodexSessionsByRepoPath: z.record(z.string(), z.array(pinSchema)).default({}),
})

const v2Schema = z.object({
  version: z.literal(2),
  expandedProjectIds: z.record(z.string(), z.boolean()),
  workspacesByProjectId: z.record(z.string(), legacyWorkspaceSchema),
  pinnedCodexSessionsByProjectId: z.record(z.string(), z.array(pinSchema)),
  expandedRepoIds: z.record(z.string(), z.boolean()),
  workspacesByRepoId: z.record(z.string(), legacyWorkspaceSchema),
  pinnedCodexSessionIdsByRepoPath: z.record(z.string(), z.array(z.string())),
  pinnedCodexSessionsByRepoPath: z.record(z.string(), z.array(pinSchema)),
})

const v3Schema = z.object({
  version: z.literal(3),
  expandedProjectIds: z.record(z.string(), z.boolean()),
  workspacesByProjectId: z.record(z.string(), workspaceSchema),
  pinnedCodexSessionsByProjectId: z.record(z.string(), z.array(pinSchema)),
}).strict()

type MigrationProject = {
  id: string
  localPath: string
  localCheckoutId: string
}

type MigrationContext = { projects: MigrationProject[] }

export type AppStateReadResult = {
  state: CranberriAppState
  source: 'primary' | 'backup' | 'default'
}

function migratedThreadId(window: z.infer<typeof legacyWindowSchema>): string | undefined {
  if (window.type !== 'chat') return undefined
  return /^session-(\S+)$/.exec(window.id)?.[1]
}

function migrateWorkspace(
  workspace: z.infer<typeof legacyWorkspaceSchema>,
  binding?: Pick<MigrationProject, 'id' | 'localCheckoutId'>,
): RepoWorkspaceState {
  return {
    ...workspace,
    windows: workspace.windows.map((window) => ({
      ...window,
      ...(binding
        ? {
            projectId: binding.id,
            taskId: null,
            checkoutId: binding.localCheckoutId,
            sessionTarget: 'local' as const,
          }
        : {}),
      ...(migratedThreadId(window) ? { threadId: migratedThreadId(window) } : {}),
      bindingRevision: 0,
    })),
  }
}

function migrateV1(
  legacy: z.infer<typeof v1Schema>,
  context: MigrationContext,
): CranberriAppState {
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
  const pinnedCodexSessionsByProjectId: CranberriAppState['pinnedCodexSessionsByProjectId'] = {}
  for (const project of context.projects) {
    if (project.localPath && records[project.localPath]) {
      pinnedCodexSessionsByProjectId[project.id] = records[project.localPath]
    }
  }

  const workspacesByProjectId = Object.fromEntries(
    Object.entries(legacy.workspacesByRepoId).map(([projectId, workspace]) => [
      projectId,
      migrateWorkspace(workspace, projects.get(projectId)),
    ]),
  )

  return {
    version: 3,
    expandedProjectIds: legacy.expandedRepoIds,
    workspacesByProjectId,
    pinnedCodexSessionsByProjectId,
  }
}

function migrateV2(current: z.infer<typeof v2Schema>): CranberriAppState {
  return {
    version: 3,
    expandedProjectIds: current.expandedProjectIds,
    workspacesByProjectId: Object.fromEntries(
      Object.entries(current.workspacesByProjectId).map(([projectId, workspace]) => [
        projectId,
        migrateWorkspace(workspace),
      ]),
    ),
    pinnedCodexSessionsByProjectId: current.pinnedCodexSessionsByProjectId,
  }
}

export function parseAppState(
  value: unknown,
  context: MigrationContext = { projects: [] },
): CranberriAppState {
  const version = z.object({ version: z.number() }).parse(value).version
  if (version === 3) return v3Schema.parse(value)
  if (version === 2) return migrateV2(v2Schema.parse(value))
  return migrateV1(v1Schema.parse(value), context)
}

export function incrementBindingRevision(revision: number): number {
  if (!Number.isSafeInteger(revision) || revision < 0 || revision >= Number.MAX_SAFE_INTEGER) {
    throw new Error('Cannot increment binding revision')
  }
  return revision + 1
}

export function appStateBackupPath(target: string): string {
  return `${target}.last-good`
}

function readCandidate(filePath: string, context: MigrationContext): CranberriAppState {
  return parseAppState(JSON.parse(fs.readFileSync(filePath, 'utf8')), context)
}

export function readAppStateFile(
  target: string,
  context: MigrationContext = { projects: [] },
): AppStateReadResult {
  const backup = appStateBackupPath(target)
  if (!fs.existsSync(target) && !fs.existsSync(backup)) {
    return { state: DEFAULT_APP_STATE, source: 'default' }
  }

  let primaryError: unknown
  if (fs.existsSync(target)) {
    try {
      return { state: readCandidate(target, context), source: 'primary' }
    } catch (error) {
      primaryError = error
    }
  }

  if (fs.existsSync(backup)) {
    try {
      return { state: readCandidate(backup, context), source: 'backup' }
    } catch (backupError) {
      throw new Error('Cannot read app state primary or backup', {
        cause: backupError,
      })
    }
  }

  throw new Error('Cannot read app state primary or backup', { cause: primaryError })
}

function isValidPersistedState(bytes: string): boolean {
  try {
    parseAppState(JSON.parse(bytes))
    return true
  } catch {
    return false
  }
}

export function writeAppStateFile(target: string, state: CranberriAppState): CranberriAppState {
  const parsed = parseAppState(state)
  const nonce = `${process.pid}.${Date.now()}`
  const temporary = `${target}.${nonce}.tmp`
  const backup = appStateBackupPath(target)
  const backupTemporary = `${backup}.${nonce}.tmp`
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(temporary, JSON.stringify(parsed, null, 2))

  if (fs.existsSync(target)) {
    const previous = fs.readFileSync(target, 'utf8')
    if (isValidPersistedState(previous)) {
      fs.writeFileSync(backupTemporary, previous)
      fs.renameSync(backupTemporary, backup)
    }
  }

  fs.renameSync(temporary, target)
  return parsed
}

function targetPath(): string {
  return path.join(app.getPath('userData'), 'app-state.json')
}

function migrationContext(): MigrationContext {
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
  return readAppStateFile(targetPath(), migrationContext()).state
}

function write(state: CranberriAppState): CranberriAppState {
  return writeAppStateFile(targetPath(), state)
}

export function initAppStateIpc(): void {
  ipcMain.handle('app-state:read', () => read())
  ipcMain.handle('app-state:write', (_, state: CranberriAppState) => write(state))
}
