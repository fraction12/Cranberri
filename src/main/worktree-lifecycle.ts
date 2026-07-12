import fs from 'node:fs'
import path from 'node:path'
import type { ManagedWorktree } from '../shared/worktrees'
import {
  canonicalGitCommonDir,
  branchHasUnpushedCommits,
  captureLocalChanges,
  createDetachedWorktree,
  createPrivateTaskRef,
  gitStatusPorcelain,
  hasPublicCommitReference,
  listGitWorktrees,
  removeGitWorktree,
  resolveGitRef,
} from './git-worktrees'
import { hasRunningProcessesForPath } from './processRegistry'
import { authorizeExistingPath, authorizeManagedPath } from './repoSecurity'
import type { TaskStore } from './task-store'

const DAY_MS = 86_400_000

interface CreateRequest {
  projectId: string
  projectName: string
  taskId: string
  taskName: string
  localCheckoutPath: string
  managedRoot: string
  baseRef: string
  cap: number
  includeLocalChanges?: boolean
}

interface LifecycleDependencies {
  hasRunningProcesses(path: string): Promise<boolean>
  trashResidual(path: string): Promise<void>
  writeOwnershipManifest(manifestPath: string, manifest: OwnershipManifest): void
}

interface OwnershipManifest {
  version: 1
  worktreeId: string
  projectId: string
  taskId: string
  checkoutPath: string
  gitCommonDir: string
  createdAt: number
}

function slug(value: string): string {
  const normalized = value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
  return normalized.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'item'
}

function idSuffix(value: string): string {
  return value.replace(/[^A-Za-z0-9]/g, '').slice(0, 8).toLowerCase() || crypto.randomUUID().slice(0, 8)
}

function writeManifest(manifestPath: string, manifest: OwnershipManifest): void {
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true, mode: 0o700 })
  const temporary = `${manifestPath}.${process.pid}.tmp`
  fs.writeFileSync(temporary, JSON.stringify(manifest, null, 2), { mode: 0o600 })
  fs.renameSync(temporary, manifestPath)
}

export class WorktreeLifecycle {
  private mutations: Promise<void> = Promise.resolve()
  private readonly dependencies: LifecycleDependencies

  constructor(private readonly store: TaskStore, dependencies: Partial<LifecycleDependencies> = {}) {
    this.dependencies = {
      hasRunningProcesses: dependencies.hasRunningProcesses ?? hasRunningProcessesForPath,
      trashResidual: dependencies.trashResidual ?? (async (residualPath) => {
        const { shell } = await import('electron')
        await shell.trashItem(residualPath)
      }),
      writeOwnershipManifest: dependencies.writeOwnershipManifest ?? writeManifest,
    }
  }

  create(request: CreateRequest): Promise<ManagedWorktree> {
    return this.serialize(() => this.createInternal(request))
  }

  remove(worktreeId: string): Promise<ManagedWorktree> {
    return this.serialize(() => this.removeInternal(worktreeId))
  }

  archive(worktreeId: string, now = Date.now()): Promise<ManagedWorktree> {
    return this.serialize(() => this.updateRecord(worktreeId, (record) => ({
      ...record,
      lifecycle: 'archived',
      archivedAt: record.archivedAt ?? now,
      updatedAt: now,
    })))
  }

  restore(
    worktreeId: string,
    localCheckoutPath: string,
    runEnvironment: (worktree: ManagedWorktree, revision: string) => Promise<void> = async () => undefined,
  ): Promise<ManagedWorktree> {
    return this.serialize(async () => {
      const record = this.store.read().managedWorktrees.find((item) => item.id === worktreeId)
      if (!record) throw new Error('Managed worktree not found')
      if (record.lifecycle !== 'removed') {
        if (!fs.existsSync(record.path)) throw new Error('Archived worktree path is unavailable')
        return this.updateRecord(worktreeId, (current) => ({
          ...current, lifecycle: 'active', archivedAt: null, cleanupReason: null, updatedAt: Date.now(),
        }))
      }
      if (!record.privateRef || !record.archiveHeadSha) throw new Error('Removed worktree has no restorable private ref')
      const sha = await resolveGitRef(localCheckoutPath, record.privateRef)
      if (sha !== record.archiveHeadSha) throw new Error('Private archive ref no longer matches the recorded HEAD')
      await createDetachedWorktree(localCheckoutPath, record.path, sha)
      try {
        writeManifest(record.manifestPath, {
          version: 1,
          worktreeId: record.id,
          projectId: record.projectId,
          taskId: record.taskId ?? '',
          checkoutPath: record.path,
          gitCommonDir: record.gitCommonDir,
          createdAt: record.createdAt,
        })
        const restored = await this.updateRecord(worktreeId, (current) => ({
          ...current,
          lifecycle: 'active',
          headSha: sha,
          archivedAt: null,
          cleanupReason: null,
          updatedAt: Date.now(),
        }))
        if (record.environmentRevision) await runEnvironment(restored, record.environmentRevision)
        return this.updateRecord(worktreeId, (current) => ({
          ...current,
          lifecycle: 'active',
          headSha: sha,
          archivedAt: null,
          cleanupReason: null,
          updatedAt: Date.now(),
        }))
      } catch (error) {
        await this.updateRecord(worktreeId, (current) => ({
          ...current,
          lifecycle: 'needsAttention',
          cleanupReason: error instanceof Error ? error.message : 'Worktree restoration failed',
          updatedAt: Date.now(),
        }))
        throw error
      }
    })
  }

  removeByPath(worktreePath: string): Promise<ManagedWorktree> {
    const record = this.store.read().managedWorktrees.find((item) => path.resolve(item.path) === path.resolve(worktreePath))
    if (!record) return Promise.reject(new Error('Path is not managed by Cranberri'))
    return this.remove(record.id)
  }

  archiveAndRemove(worktreeId: string, options: { retentionDays: number; now?: number }): Promise<ManagedWorktree> {
    return this.serialize(async () => {
      const now = options.now ?? Date.now()
      const existing = this.store.read().managedWorktrees.find((item) => item.id === worktreeId)
      if (!existing) throw new Error('Managed worktree not found')
      const wasArchived = existing.lifecycle === 'archived' && existing.archivedAt !== null
      const record = await this.updateRecord(worktreeId, (current) => ({
        ...current,
        lifecycle: 'archived',
        archivedAt: current.archivedAt ?? now,
        updatedAt: now,
      }))
      if (
        !wasArchived ||
        now - (record.archivedAt ?? now) < options.retentionDays * DAY_MS
      ) {
        return record
      }
      return this.removeInternal(worktreeId)
    })
  }

  sweepRetention(options: { retentionDays: number; now?: number }): Promise<ManagedWorktree[]> {
    return this.serialize(async () => {
      const now = options.now ?? Date.now()
      const cutoff = now - options.retentionDays * DAY_MS
      const candidates = this.store.read().managedWorktrees
        .filter((item) => item.lifecycle === 'archived' && item.archivedAt !== null && item.archivedAt <= cutoff)
        .sort((left, right) => (left.archivedAt ?? left.updatedAt) - (right.archivedAt ?? right.updatedAt))
      const removed: ManagedWorktree[] = []
      for (const candidate of candidates) {
        try {
          removed.push(await this.removeInternal(candidate.id))
        } catch (error) {
          await this.updateRecord(candidate.id, (current) => ({
            ...current,
            lifecycle: 'cleanupBlocked',
            cleanupReason: error instanceof Error ? error.message : 'Retention cleanup safety check failed',
            updatedAt: now,
          }))
        }
      }
      return removed
    })
  }

  private async createInternal(request: CreateRequest): Promise<ManagedWorktree> {
    let state = this.store.read()
    const existing = state.managedWorktrees.find((item) => item.taskId === request.taskId && item.lifecycle !== 'removed')
    if (existing) throw new Error('Task already has a recorded managed worktree')
    let activeCount = state.managedWorktrees.filter((item) => item.lifecycle !== 'removed').length
    if (activeCount >= request.cap) {
      const candidates = state.managedWorktrees
        .filter((item) => item.lifecycle === 'archived')
        .sort((a, b) => (a.archivedAt ?? a.updatedAt) - (b.archivedAt ?? b.updatedAt))
      for (const candidate of candidates) {
        try {
          await this.removeInternal(candidate.id)
          activeCount -= 1
          if (activeCount < request.cap) break
        } catch (error) {
          await this.updateRecord(candidate.id, (current) => ({
            ...current,
            lifecycle: 'cleanupBlocked',
            cleanupReason: error instanceof Error ? error.message : 'Cleanup safety check failed',
            updatedAt: Date.now(),
          }))
        }
      }
      state = this.store.read()
      activeCount = state.managedWorktrees.filter((item) => item.lifecycle !== 'removed').length
      if (activeCount >= request.cap) throw new Error(`Managed worktree cap of ${request.cap} reached; all archived candidates are protected`)
    }

    fs.mkdirSync(request.managedRoot, { recursive: true, mode: 0o700 })
    const root = fs.realpathSync(request.managedRoot)
    const gitCommonDir = await canonicalGitCommonDir(request.localCheckoutPath)
    const baseSha = await resolveGitRef(request.localCheckoutPath, request.baseRef)
    const id = crypto.randomUUID()
    const projectDirectory = `${slug(request.projectName)}-${idSuffix(request.projectId)}`
    const taskDirectory = `${slug(request.taskName)}-${idSuffix(id)}`
    const checkoutPath = authorizeManagedPath(root, path.join(root, projectDirectory, taskDirectory))
    const manifestPath = authorizeManagedPath(root, path.join(root, '.cranberri', 'manifests', `${id}.json`))
    const now = Date.now()
    const record: ManagedWorktree = {
      id,
      projectId: request.projectId,
      checkoutId: crypto.randomUUID(),
      taskId: request.taskId,
      path: checkoutPath,
      recordedRoot: root,
      gitCommonDir,
      manifestPath,
      baseRef: request.baseRef,
      baseSha,
      branch: null,
      headSha: baseSha,
      archiveHeadSha: null,
      privateRef: null,
      lifecycle: 'provisioning',
      cleanupReason: null,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
    }
    const changes = request.includeLocalChanges ? await captureLocalChanges(request.localCheckoutPath, baseSha) : undefined

    await this.store.update((current) => ({
      ...current,
      managedWorktrees: [...current.managedWorktrees, record],
    }))
    try {
      await createDetachedWorktree(request.localCheckoutPath, checkoutPath, baseSha, { localChanges: changes })
      this.dependencies.writeOwnershipManifest(manifestPath, {
        version: 1,
        worktreeId: id,
        projectId: request.projectId,
        taskId: request.taskId,
        checkoutPath,
        gitCommonDir,
        createdAt: now,
      })
      const active = { ...record, lifecycle: 'active' as const, updatedAt: Date.now() }
      await this.store.update((current) => ({
        ...current,
        managedWorktrees: current.managedWorktrees.map((item) => item.id === id ? active : item),
      }))
      return active
    } catch (error) {
      await this.store.update((current) => ({
        ...current,
        managedWorktrees: current.managedWorktrees.map((item) => item.id === id ? {
          ...item,
          lifecycle: 'needsAttention' as const,
          cleanupReason: error instanceof Error ? error.message : 'Worktree provisioning was interrupted',
          updatedAt: Date.now(),
        } : item),
        interruptedOperations: current.interruptedOperations.some((operation) => operation.kind === 'create' && operation.worktreeId === id)
          ? current.interruptedOperations
          : [...current.interruptedOperations, { kind: 'create', worktreeId: id, path: checkoutPath, createdAt: now }],
      })).catch(() => undefined)
      throw error
    }
  }

  private async removeInternal(worktreeId: string): Promise<ManagedWorktree> {
    const record = this.store.read().managedWorktrees.find((item) => item.id === worktreeId)
    if (!record) throw new Error('Managed worktree not found')
    if (record.lifecycle === 'removed') return record
    const root = fs.realpathSync(record.recordedRoot)
    const checkoutPath = authorizeExistingPath(root, record.path)
    const manifestPath = authorizeExistingPath(root, record.manifestPath)
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as OwnershipManifest
    if (
      manifest.version !== 1 || manifest.worktreeId !== record.id || manifest.projectId !== record.projectId
      || manifest.taskId !== record.taskId || fs.realpathSync(manifest.checkoutPath) !== checkoutPath
      || fs.realpathSync(manifest.gitCommonDir) !== fs.realpathSync(record.gitCommonDir)
    ) throw new Error('Managed worktree ownership verification failed')
    if (await canonicalGitCommonDir(checkoutPath) !== fs.realpathSync(record.gitCommonDir)) {
      throw new Error('Managed worktree Git ownership mismatch')
    }
    const entry = (await listGitWorktrees(checkoutPath)).find((item) => {
      try { return fs.realpathSync(item.path) === checkoutPath } catch { return false }
    })
    if (!entry) throw new Error('Managed worktree is not registered with Git')
    if (entry.locked) throw new Error('Managed worktree is locked')
    if (await gitStatusPorcelain(checkoutPath)) throw new Error('Managed worktree is dirty, staged, or conflicted')
    if (await this.dependencies.hasRunningProcesses(checkoutPath)) throw new Error('Managed worktree has running processes')
    const headSha = await resolveGitRef(checkoutPath, 'HEAD')
    if (entry.branch && await branchHasUnpushedCommits(checkoutPath, entry.branch)) {
      throw new Error('Managed worktree has an unpushed branch')
    }
    if (!entry.branch && !await hasPublicCommitReference(checkoutPath, headSha)) {
      throw new Error('Managed worktree has a unique detached commit')
    }
    const privateRef = record.taskId ? await createPrivateTaskRef(checkoutPath, record.taskId, headSha) : null

    await removeGitWorktree(checkoutPath, checkoutPath)
    if (fs.existsSync(checkoutPath)) await this.dependencies.trashResidual(checkoutPath)
    if (fs.existsSync(checkoutPath)) throw new Error('Git unregistered the worktree but verified residue could not be moved to Trash')
    fs.rmSync(manifestPath)
    return this.updateRecord(worktreeId, (current) => ({
      ...current,
      lifecycle: 'removed',
      archiveHeadSha: headSha,
      headSha,
      privateRef,
      cleanupReason: null,
      updatedAt: Date.now(),
    }))
  }

  private updateRecord(worktreeId: string, updater: (record: ManagedWorktree) => ManagedWorktree): Promise<ManagedWorktree> {
    let updated: ManagedWorktree | undefined
    return this.store.update((state) => ({
      ...state,
      managedWorktrees: state.managedWorktrees.map((record) => {
        if (record.id !== worktreeId) return record
        updated = updater(record)
        return updated
      }),
    })).then(() => {
      if (!updated) throw new Error('Managed worktree not found')
      return updated
    })
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    let result!: T
    const queued = this.mutations.then(async () => { result = await operation() })
    this.mutations = queued.catch(() => undefined)
    return queued.then(() => result)
  }
}
