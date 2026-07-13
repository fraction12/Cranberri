import { execFileSync } from 'node:child_process'
import { app, dialog, ipcMain } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import {
  projectRegistrySchema,
  setPinnedLocalBranchRequestSchema,
  type Checkout,
  type Project,
  type ProjectRegistry,
  type ProjectRegistryView,
  type SetPinnedLocalBranchRequest,
} from '../shared/projects'

const legacyReposSchema = z.object({
  repos: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      path: z.string(),
    }),
  ),
  activeRepoId: z.string().nullable(),
})

function registryPath(): string {
  return path.join(app.getPath('userData'), 'repos.json')
}

function atomicWrite(target: string, value: unknown): void {
  const temporary = `${target}.${process.pid}.tmp`
  fs.mkdirSync(path.dirname(target), { recursive: true })

  try {
    fs.writeFileSync(temporary, JSON.stringify(value, null, 2))
    fs.renameSync(temporary, target)
  } catch (error) {
    fs.rmSync(temporary, { force: true })
    throw error
  }
}

function stableId(prefix: string, projectId: string): string {
  return `${prefix}-${projectId}`
}

export function inspectGitCheckout(checkoutPath: string): {
  canonicalPath: string
  gitCommonDir: string
  branch: string | null
} {
  const canonicalPath = fs.realpathSync(checkoutPath)
  const commonOutput = execFileSync(
    'git',
    ['rev-parse', '--path-format=absolute', '--git-common-dir'],
    { cwd: canonicalPath, encoding: 'utf8' },
  ).trim()
  const gitCommonDir = fs.realpathSync(path.resolve(canonicalPath, commonOutput))

  let branch: string | null
  try {
    branch =
      execFileSync('git', ['symbolic-ref', '--quiet', '--short', 'HEAD'], {
        cwd: canonicalPath,
        encoding: 'utf8',
      }).trim() || null
  } catch {
    branch = null
  }

  return { canonicalPath, gitCommonDir, branch }
}

function migrateLegacy(raw: unknown): ProjectRegistry {
  const legacy = legacyReposSchema.parse(raw)
  const projects: Project[] = []
  const checkouts: Checkout[] = []
  const commonDirs = new Set<string>()

  for (const repo of legacy.repos) {
    let inspection: ReturnType<typeof inspectGitCheckout>
    try {
      inspection = inspectGitCheckout(repo.path)
    } catch (error) {
      throw new Error(
        `Cannot migrate project registry: Local checkout unavailable for ${repo.name}`,
        { cause: error },
      )
    }

    if (commonDirs.has(inspection.gitCommonDir)) {
      throw new Error(
        `Cannot migrate project registry: duplicate Git common directory ${inspection.gitCommonDir}`,
      )
    }
    commonDirs.add(inspection.gitCommonDir)

    const checkoutId = stableId('local', repo.id)
    const controlTaskId = stableId('control', repo.id)
    checkouts.push({
      id: checkoutId,
      projectId: repo.id,
      kind: 'local',
      canonicalPath: inspection.canonicalPath,
      gitCommonDir: inspection.gitCommonDir,
      ownership: 'user',
      available: true,
    })
    projects.push({
      id: repo.id,
      name: repo.name,
      gitCommonDir: inspection.gitCommonDir,
      localCheckoutId: checkoutId,
      pinnedLocalBranch: inspection.branch,
      defaultEnvironmentId: null,
      controlTaskId,
      localLeaseTaskId: null,
    })
  }

  return {
    version: 1,
    projects,
    checkouts,
    activeProjectId: legacy.activeRepoId,
  }
}

export function readProjectRegistry(): ProjectRegistry {
  const target = registryPath()
  if (!fs.existsSync(target)) {
    return { version: 1, projects: [], checkouts: [], activeProjectId: null }
  }

  let raw: unknown
  try {
    raw = JSON.parse(fs.readFileSync(target, 'utf8'))
  } catch (error) {
    throw new Error('Cannot read project registry: corrupt JSON', { cause: error })
  }

  const current = projectRegistrySchema.safeParse(raw)
  if (current.success) return current.data

  try {
    const migrated = migrateLegacy(raw)
    atomicWrite(target, migrated)
    return migrated
  } catch (error) {
    throw new Error('Cannot migrate project registry', { cause: error })
  }
}

export function writeProjectRegistry(registry: ProjectRegistry): ProjectRegistry {
  const parsed = projectRegistrySchema.parse(registry)
  atomicWrite(registryPath(), parsed)
  return parsed
}

export function projectRegistryView(registry: ProjectRegistry): ProjectRegistryView {
  const checkoutById = new Map(
    registry.checkouts.map((checkout) => [checkout.id, checkout]),
  )

  return {
    ...registry,
    repos: registry.projects.map((project) => ({
      ...project,
      path: checkoutById.get(project.localCheckoutId)?.canonicalPath ?? '',
    })),
    activeRepoId: registry.activeProjectId,
  }
}

export function setPinnedLocalBranch(request: SetPinnedLocalBranchRequest): ProjectRegistryView {
  const parsed = setPinnedLocalBranchRequestSchema.parse(request)
  const state = readProjectRegistry()
  const project = state.projects.find((candidate) => candidate.id === parsed.projectId)
  if (!project) throw new Error('Project not found')
  const checkout = state.checkouts.find((candidate) => candidate.id === project.localCheckoutId)
  if (!checkout?.available) throw new Error('Local checkout unavailable')

  try {
    execFileSync('git', ['check-ref-format', '--branch', parsed.branch], { cwd: checkout.canonicalPath, stdio: 'ignore' })
  } catch {
    throw new Error(`Invalid local branch: ${parsed.branch}`)
  }
  try {
    execFileSync('git', ['show-ref', '--verify', '--quiet', `refs/heads/${parsed.branch}`], { cwd: checkout.canonicalPath, stdio: 'ignore' })
  } catch {
    throw new Error(`Local branch not found: ${parsed.branch}`)
  }

  if (project.pinnedLocalBranch === parsed.branch) return projectRegistryView(state)
  return projectRegistryView(writeProjectRegistry({
    ...state,
    projects: state.projects.map((candidate) => candidate.id === project.id
      ? { ...candidate, pinnedLocalBranch: parsed.branch }
      : candidate),
  }))
}

export function getRegisteredRepoPaths(): string[] {
  return readProjectRegistry()
    .checkouts.filter((checkout) => checkout.available)
    .map((checkout) => checkout.canonicalPath)
}

export function getRepoName(repoPath: string): string {
  return path.basename(repoPath)
}

export function initRepoIpc(): void {
  ipcMain.handle('repos:list', () => projectRegistryView(readProjectRegistry()))

  ipcMain.handle('repos:add', async (_, repoPath: string) => {
    const inspection = inspectGitCheckout(repoPath)
    const state = readProjectRegistry()
    if (state.projects.some((project) => project.gitCommonDir === inspection.gitCommonDir)) {
      return projectRegistryView(state)
    }

    const id = crypto.randomUUID()
    const checkoutId = stableId('local', id)
    const controlTaskId = stableId('control', id)
    const project: Project = {
      id,
      name: getRepoName(inspection.canonicalPath),
      gitCommonDir: inspection.gitCommonDir,
      localCheckoutId: checkoutId,
      pinnedLocalBranch: inspection.branch,
      defaultEnvironmentId: null,
      controlTaskId,
      localLeaseTaskId: null,
    }
    const checkout: Checkout = {
      id: checkoutId,
      projectId: id,
      kind: 'local',
      canonicalPath: inspection.canonicalPath,
      gitCommonDir: inspection.gitCommonDir,
      ownership: 'user',
      available: true,
    }

    return projectRegistryView(
      writeProjectRegistry({
        ...state,
        projects: [...state.projects, project],
        checkouts: [...state.checkouts, checkout],
        activeProjectId: state.activeProjectId ?? id,
      }),
    )
  })

  ipcMain.handle('repos:remove', (_, id: string) => {
    const state = readProjectRegistry()
    const projects = state.projects.filter((project) => project.id !== id)
    return projectRegistryView(
      writeProjectRegistry({
        ...state,
        projects,
        checkouts: state.checkouts.filter((checkout) => checkout.projectId !== id),
        activeProjectId:
          state.activeProjectId === id ? (projects[0]?.id ?? null) : state.activeProjectId,
      }),
    )
  })

  ipcMain.handle('repos:set-active', (_, id: string) => {
    const state = readProjectRegistry()
    if (!state.projects.some((project) => project.id === id)) {
      throw new Error('Project not found')
    }
    return projectRegistryView(writeProjectRegistry({ ...state, activeProjectId: id }))
  })

  ipcMain.handle('repos:set-pinned-branch', (_, raw: unknown) => {
    return setPinnedLocalBranch(setPinnedLocalBranchRequestSchema.parse(raw))
  })

  ipcMain.handle('repos:pick-directory', async () => {
    if (process.env.CRANBERRI_FAKE_REPO_DIRECTORY) {
      return process.env.CRANBERRI_FAKE_REPO_DIRECTORY
    }
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: 'Select a git repository',
    })
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })
}
