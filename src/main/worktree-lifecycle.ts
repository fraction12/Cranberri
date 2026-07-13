import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { LifecycleOperation, LifecycleOperationReceipt } from '../shared/tasks'
import type { WorktreeSnapshotDescriptor } from '../shared/worktree-snapshots'
import type { ManagedWorktree } from '../shared/worktrees'
import {
  applyLocalChanges,
  branchCheckoutPath,
  branchExists,
  canonicalGitCommonDir,
  branchHasUnpushedCommits,
  captureLocalChanges,
  checkoutBranch,
  createDetachedWorktree,
  createPrivateTaskRef,
  gitStatusPorcelain,
  hasPublicCommitReference,
  listGitWorktrees,
  localChangesEqual,
  removeGitWorktree as removeGitWorktreeDefault,
  resolveGitRef,
} from './git-worktrees'
import { hasRunningProcessesForPath } from './processRegistry'
import { authorizeExistingPath, authorizeManagedPath } from './repoSecurity'
import type { TaskStore } from './task-store'
import type { WorktreeSnapshotStore } from './worktree-snapshot-store'

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
  removeGitWorktree(repositoryPath: string, worktreePath: string): Promise<void>
}

interface BaseOwnershipManifest {
  worktreeId: string
  projectId: string
  taskId: string
  checkoutPath: string
  gitCommonDir: string
  createdAt: number
}

interface CreatedOwnershipManifest extends BaseOwnershipManifest {
  version: 1
}

interface RestoredOwnershipManifest extends BaseOwnershipManifest {
  version: 2
  restoreOperationId: string
  ownershipToken: string
}

type OwnershipManifest = CreatedOwnershipManifest | RestoredOwnershipManifest

interface PrepareArchiveRequest {
  operationId: string
  worktreeId: string
  snapshotStore: WorktreeSnapshotStore
}

interface PreparedArchive {
  snapshot: WorktreeSnapshotDescriptor
  headSha: string
  privateRef: string
  sourceGuard: string
}

interface RemovePreparedArchiveRequest extends PrepareArchiveRequest {
  repositoryPath: string
  snapshot: WorktreeSnapshotDescriptor
}

interface RemovedPreparedArchive {
  headSha: string
  privateRef: string
  quarantinePath: string
}

type RestorePreparedArchiveRequest = RemovePreparedArchiveRequest

interface RestoredPreparedArchive {
  checkoutPath: string
  branchAttached: boolean
  fallbackReason: string | null
}

type PurgeOwnedArtifactsRequest = RemovePreparedArchiveRequest

function runGitBuffer(cwd: string, args: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    execFile('git', ['-C', cwd, ...args], { encoding: null, maxBuffer: 70 * 1024 * 1024 }, (error, stdout) => {
      if (error) reject(error)
      else resolve(stdout)
    })
  })
}

async function runGit(cwd: string, args: string[]): Promise<string> {
  return (await runGitBuffer(cwd, args)).toString('utf8').trim()
}

function flushDirectory(directoryPath: string): void {
  const descriptor = fs.openSync(directoryPath, fs.constants.O_RDONLY)
  try {
    fs.fsyncSync(descriptor)
  } finally {
    fs.closeSync(descriptor)
  }
}

function digest(contents: Buffer | string): string {
  return createHash('sha256').update(contents).digest('hex')
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
  const descriptor = fs.openSync(temporary, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY, 0o600)
  try {
    fs.writeFileSync(descriptor, JSON.stringify(manifest, null, 2))
    fs.fsyncSync(descriptor)
  } finally {
    fs.closeSync(descriptor)
  }
  fs.renameSync(temporary, manifestPath)
  flushDirectory(path.dirname(manifestPath))
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
      removeGitWorktree: dependencies.removeGitWorktree ?? removeGitWorktreeDefault,
    }
  }

  create(request: CreateRequest): Promise<ManagedWorktree> {
    return this.serialize(() => this.createInternal(request))
  }

  remove(worktreeId: string): Promise<ManagedWorktree> {
    return this.serialize(() => this.removeInternal(worktreeId))
  }

  prepareArchive(request: PrepareArchiveRequest): Promise<PreparedArchive> {
    return this.serialize(() => this.prepareArchiveInternal(request))
  }

  removePreparedArchive(request: RemovePreparedArchiveRequest): Promise<RemovedPreparedArchive> {
    return this.serialize(() => this.removePreparedArchiveInternal(request))
  }

  restorePreparedArchive(request: RestorePreparedArchiveRequest): Promise<RestoredPreparedArchive> {
    return this.serialize(() => this.restorePreparedArchiveInternal(request))
  }

  retireRestoredSnapshot(request: RestorePreparedArchiveRequest): Promise<void> {
    return this.serialize(() => this.retireRestoredSnapshotInternal(request))
  }

  purgeOwnedArtifacts(request: PurgeOwnedArtifactsRequest): Promise<void> {
    return this.serialize(() => this.purgeOwnedArtifactsInternal(request))
  }

  purgeArchiveQuarantine(operationId: string, worktreeId: string): Promise<void> {
    return this.serialize(() => this.purgeArchiveQuarantineInternal(operationId, worktreeId))
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

  private async prepareArchiveInternal(request: PrepareArchiveRequest): Promise<PreparedArchive> {
    const { operation, record } = this.authority(request.operationId, 'archive', request.worktreeId)
    if (!operation.artifactId) throw new Error('Archive operation has no preallocated artifact')
    const existingDescriptor = this.snapshotDescriptorFromReceipts(operation)
    if (existingDescriptor) {
      const snapshot = request.snapshotStore.load(existingDescriptor)
      this.assertSnapshotAuthority(operation, record, existingDescriptor)
      return {
        snapshot: existingDescriptor,
        headSha: snapshot.source.headSha,
        privateRef: snapshot.source.privateRef,
        sourceGuard: this.receiptDetail(operation, 'sourceGuardsVerified', 'guardDigest') ?? existingDescriptor.artifactDigestSha256,
      }
    }

    const owned = await this.verifyOwnedSource(record)
    if (owned.entry.locked) throw new Error('Managed worktree is locked')
    if (await this.dependencies.hasRunningProcesses(owned.checkoutPath)) {
      throw new Error('Managed worktree has running processes')
    }
    const headSha = await resolveGitRef(owned.checkoutPath, 'HEAD')
    await this.appendReceipt(operation, 'artifactAllocated', 'artifactPreallocated', 'artifact', {
      artifactId: operation.artifactId,
    })
    await this.appendReceipt(operation, 'artifactAllocated', 'sourceLockPlanned', 'source-lock', {
      sourcePath: owned.checkoutPath,
    })
    await runGit(owned.checkoutPath, ['worktree', 'lock', `--reason=cranberri:${operation.id}`, owned.checkoutPath])
    await this.appendReceipt(operation, 'artifactAllocated', 'sourceLockAcquired', 'source-lock', {
      sourcePath: owned.checkoutPath,
    })

    try {
      const privateRef = `refs/cranberri/tasks/${operation.taskId}`
      const currentPrivateHead = await this.tryResolveRef(owned.checkoutPath, privateRef)
      if (currentPrivateHead && currentPrivateHead !== headSha) {
        throw new Error('Existing private task ref does not match archive HEAD')
      }
      await this.appendReceipt(operation, 'artifactAllocated', 'privateRefAnchorPlanned', 'private-ref', {
        privateRef,
        headSha,
      })
      if (!currentPrivateHead) await createPrivateTaskRef(owned.checkoutPath, operation.taskId, headSha)
      await this.appendReceipt(operation, 'artifactAllocated', 'privateRefAnchored', 'private-ref', {
        privateRef,
        headSha,
      })

      const descriptor = await request.snapshotStore.capture({
        snapshotId: operation.artifactId,
        taskId: operation.taskId,
        worktreeId: record.id,
        checkoutPath: owned.checkoutPath,
        gitCommonDir: record.gitCommonDir,
        expectedHeadSha: headSha,
        branch: owned.entry.branch,
        privateRef,
        environmentRevision: record.environmentRevision ?? null,
      })
      const descriptorDetails = {
        artifactId: descriptor.artifactId,
        artifactPath: descriptor.artifactPath,
        artifactBytes: descriptor.artifactBytes,
        digest: descriptor.artifactDigestSha256,
        headSha: descriptor.headSha,
        bundleIncluded: descriptor.bundleIncluded,
        privateRef,
      }
      await this.appendReceipt(operation, 'snapshotPublished', 'snapshotPublished', 'snapshot', descriptorDetails)
      request.snapshotStore.load(descriptor)
      await this.appendReceipt(operation, 'snapshotVerified', 'snapshotVerified', 'snapshot', descriptorDetails)
      const sourceGuard = digest(`${descriptor.headSha}\0${descriptor.artifactDigestSha256}`)
      await this.appendReceipt(operation, 'snapshotVerified', 'sourceGuardsVerified', 'captured', {
        sourcePath: owned.checkoutPath,
        headSha,
        guardDigest: sourceGuard,
      })
      return { snapshot: descriptor, headSha, privateRef, sourceGuard }
    } catch (error) {
      try {
        await runGit(owned.checkoutPath, ['worktree', 'unlock', owned.checkoutPath])
        await this.appendReceipt(operation, 'artifactAllocated', 'sourceLockReleased', 'capture-failed', {
          sourcePath: owned.checkoutPath,
        })
      } catch {
        // The durable lock-acquired receipt lets startup reconciliation handle an uncertain unlock.
      }
      throw error
    }
  }

  private async removePreparedArchiveInternal(request: RemovePreparedArchiveRequest): Promise<RemovedPreparedArchive> {
    const { operation, record } = this.authority(request.operationId, 'archive', request.worktreeId)
    this.assertSnapshotAuthority(operation, record, request.snapshot)
    const snapshot = request.snapshotStore.load(request.snapshot)
    const quarantinePath = this.quarantinePath(record, operation.id)
    const unregistered = operation.receipts.some((receipt) => receipt.subphase === 'worktreeUnregistered')
    if (!fs.existsSync(record.path)) {
      if (!unregistered) throw new Error('Managed worktree disappeared before removal was durably observed')
      return { headSha: snapshot.source.headSha, privateRef: snapshot.source.privateRef, quarantinePath }
    }

    const ownsLock = operation.receipts.some((receipt) => receipt.subphase === 'sourceLockAcquired')
      && !operation.receipts.some((receipt) => receipt.subphase === 'sourceLockReleased')
    const owned = await this.verifyOwnedSource(record)
    if (owned.entry.locked && !ownsLock) throw new Error('Managed worktree is locked')
    if (await canonicalGitCommonDir(request.repositoryPath) !== owned.gitCommonDir) {
      throw new Error('Archive repository does not match managed worktree ownership')
    }
    if (await this.dependencies.hasRunningProcesses(owned.checkoutPath)) {
      throw new Error('Managed worktree has running processes')
    }
    await this.assertSourceMatchesSnapshot(owned.checkoutPath, snapshot)
    await this.appendReceipt(operation, 'sourceNormalization', 'sourceGuardsVerified', 'pre-normalization', {
      sourcePath: owned.checkoutPath,
      headSha: snapshot.source.headSha,
      guardDigest: digest(`${request.snapshot.artifactDigestSha256}\0pre-normalization`),
    })
    await this.appendReceipt(operation, 'sourceNormalization', 'sourceNormalizationPlanned', 'normalization', {
      sourcePath: owned.checkoutPath,
      quarantinePath,
    })

    let sourceMutated = false
    try {
      const currentPaths = await this.untrackedAndIgnoredPaths(owned.checkoutPath)
      const receiptPaths = operation.receipts
        .filter((receipt) => receipt.subphase === 'sourceEntryMovePlanned')
        .flatMap((receipt) => receipt.details?.relativePath ? [receipt.details.relativePath] : [])
      const relativePaths = [...new Set([...currentPaths, ...receiptPaths])].sort()
      const capturedFiles = new Map(snapshot.changes.untrackedFiles.map((file) => [file.relativePath, file]))
      fs.mkdirSync(quarantinePath, { recursive: true, mode: 0o700 })
      fs.chmodSync(quarantinePath, 0o700)

      for (const relativePath of relativePaths) {
        const sourcePath = this.containedPath(owned.checkoutPath, relativePath)
        const destinationPath = this.containedPath(quarantinePath, relativePath)
        const sourceExists = fs.existsSync(sourcePath)
        const destinationExists = fs.existsSync(destinationPath)
        if (!sourceExists && !destinationExists) throw new Error(`Archive source entry disappeared: ${relativePath}`)
        const contents = this.readStableRegularFile(sourceExists ? sourcePath : destinationPath, relativePath)
        const expected = capturedFiles.get(relativePath)
        if (expected && !contents.equals(expected.contents)) {
          throw new Error(`Captured untracked file changed before quarantine: ${relativePath}`)
        }
        const fileDigest = digest(contents)
        const receiptKey = digest(relativePath).slice(0, 24)
        await this.appendReceipt(operation, 'sourceNormalization', 'sourceEntryMovePlanned', receiptKey, {
          sourcePath,
          destinationPath,
          quarantinePath,
          relativePath,
          fileDigest,
        })
        if (sourceExists) {
          if (destinationExists) throw new Error(`Archive quarantine destination already exists: ${relativePath}`)
          fs.mkdirSync(path.dirname(destinationPath), { recursive: true, mode: 0o700 })
          fs.renameSync(sourcePath, destinationPath)
          flushDirectory(path.dirname(sourcePath))
          flushDirectory(path.dirname(destinationPath))
          sourceMutated = true
        }
        if (digest(this.readStableRegularFile(destinationPath, relativePath)) !== fileDigest) {
          throw new Error(`Quarantined file changed during move: ${relativePath}`)
        }
        await this.appendReceipt(operation, 'sourceNormalization', 'sourceEntryQuarantined', receiptKey, {
          sourcePath,
          destinationPath,
          quarantinePath,
          relativePath,
          fileDigest,
        })
      }

      if ((await this.untrackedAndIgnoredPaths(owned.checkoutPath)).length !== 0) {
        throw new Error('Worktree files changed during archive normalization')
      }
      const [stagedPatch, unstagedPatch] = await Promise.all([
        runGitBuffer(owned.checkoutPath, ['diff', '--binary', '--cached', snapshot.source.headSha]),
        runGitBuffer(owned.checkoutPath, ['diff', '--binary']),
      ])
      if (!stagedPatch.equals(snapshot.changes.stagedPatch) || !unstagedPatch.equals(snapshot.changes.unstagedPatch)) {
        throw new Error('Tracked worktree state changed before archive normalization')
      }
      await this.appendReceipt(operation, 'sourceNormalization', 'trackedResetPlanned', 'tracked-reset', {
        sourcePath: owned.checkoutPath,
        headSha: snapshot.source.headSha,
      })
      await runGit(owned.checkoutPath, ['reset', '--hard', snapshot.source.headSha])
      sourceMutated = true
      await this.appendReceipt(operation, 'sourceNormalization', 'trackedReset', 'tracked-reset', {
        sourcePath: owned.checkoutPath,
        headSha: snapshot.source.headSha,
      })
      await this.appendReceipt(operation, 'sourceNormalization', 'sourceNormalized', 'normalization', {
        sourcePath: owned.checkoutPath,
        quarantinePath,
      })

      if (await this.dependencies.hasRunningProcesses(owned.checkoutPath)) {
        throw new Error('Managed worktree has a running process after normalization')
      }
      await this.appendReceipt(operation, 'worktreeRemoval', 'worktreeRemovalPlanned', 'remove', {
        sourcePath: owned.checkoutPath,
        headSha: snapshot.source.headSha,
      })
      if (owned.entry.locked && ownsLock) {
        await runGit(owned.checkoutPath, ['worktree', 'unlock', owned.checkoutPath])
        await this.appendReceipt(operation, 'worktreeRemoval', 'sourceLockReleased', 'remove', {
          sourcePath: owned.checkoutPath,
        })
      }
      if (await this.dependencies.hasRunningProcesses(owned.checkoutPath)) {
        throw new Error('Managed worktree has a running process before removal')
      }
      if (await resolveGitRef(owned.checkoutPath, 'HEAD') !== snapshot.source.headSha
        || await gitStatusPorcelain(owned.checkoutPath)) {
        throw new Error('Managed worktree changed before removal')
      }
      await this.dependencies.removeGitWorktree(request.repositoryPath, owned.checkoutPath)
      if (fs.existsSync(owned.checkoutPath)) {
        throw new Error('Git unregistered the worktree but left archive source residue')
      }
      await this.appendReceipt(operation, 'worktreeRemoval', 'worktreeUnregistered', 'remove', {
        sourcePath: owned.checkoutPath,
        headSha: snapshot.source.headSha,
      })
      return { headSha: snapshot.source.headSha, privateRef: snapshot.source.privateRef, quarantinePath }
    } catch (error) {
      if (sourceMutated && fs.existsSync(owned.checkoutPath)) {
        try {
          await this.reconstructSource(operation, owned.checkoutPath, quarantinePath, snapshot)
        } catch (reconstructionError) {
          const reason = reconstructionError instanceof Error ? `: ${reconstructionError.message}` : ''
          throw new Error(`Archive removal failed and exact source reconstruction could not be verified${reason}`, {
            cause: reconstructionError,
          })
        }
      }
      throw error
    }
  }

  private async restorePreparedArchiveInternal(request: RestorePreparedArchiveRequest): Promise<RestoredPreparedArchive> {
    const { operation, record } = this.authority(request.operationId, 'restore', request.worktreeId)
    this.assertSnapshotAuthority(operation, record, request.snapshot)
    const reservation = operation.restoreReservation
    if (!reservation) throw new Error('Restore operation has no destination reservation')
    if (path.resolve(reservation.path) !== path.resolve(record.path)
      || fs.realpathSync(reservation.gitCommonDir) !== fs.realpathSync(record.gitCommonDir)) {
      throw new Error('Restore reservation does not match managed worktree ownership')
    }
    const snapshot = request.snapshotStore.load(request.snapshot)
    if (reservation.privateRef !== snapshot.source.privateRef) {
      throw new Error('Restore reservation private ref does not match snapshot')
    }
    if (await canonicalGitCommonDir(request.repositoryPath) !== fs.realpathSync(record.gitCommonDir)) {
      throw new Error('Restore repository does not match managed worktree ownership')
    }
    const targetPath = authorizeManagedPath(fs.realpathSync(record.recordedRoot), reservation.path)
    await this.appendReceipt(operation, 'restoreReserved', 'restoreDestinationReserved', 'reservation', {
      destinationPath: targetPath,
      ownershipToken: reservation.ownershipToken,
      privateRef: reservation.privateRef,
    })

    if (fs.existsSync(targetPath)) {
      const registered = (await listGitWorktrees(request.repositoryPath)).some((entry) => {
        try { return fs.realpathSync(entry.path) === fs.realpathSync(targetPath) } catch { return false }
      })
      if (!registered) throw new Error('Reserved restore destination is occupied by an unowned path')
      const checkoutCreated = operation.receipts.some((receipt) => (
        receipt.subphase === 'checkoutCreated'
        && path.resolve(receipt.details?.checkoutPath ?? '') === path.resolve(targetPath)
      ))
      const manifest = fs.existsSync(record.manifestPath) ? this.readManifest(record.manifestPath) : null
      const manifestMatches = manifest?.version === 2
        && manifest.restoreOperationId === operation.id
        && manifest.ownershipToken === reservation.ownershipToken
      if (!checkoutCreated && !manifestMatches) {
        throw new Error('Reserved restore destination is occupied by an unowned worktree')
      }
      await this.assertSourceMatchesSnapshot(targetPath, snapshot)
    } else {
      await this.appendReceipt(operation, 'restoreCheckout', 'restoreCheckoutPlanned', 'checkout', {
        destinationPath: targetPath,
        headSha: snapshot.source.headSha,
      })
      await request.snapshotStore.restore(request.snapshot, request.repositoryPath, targetPath)
      await this.appendReceipt(operation, 'restoreCheckout', 'checkoutCreated', 'checkout', {
        checkoutPath: targetPath,
        headSha: snapshot.source.headSha,
      })
    }

    let branchAttached = false
    let fallbackReason: string | null = null
    if (snapshot.source.branch) {
      if (!await branchExists(request.repositoryPath, snapshot.source.branch)) {
        fallbackReason = 'Archived branch no longer exists'
      } else if (await resolveGitRef(request.repositoryPath, `refs/heads/${snapshot.source.branch}`) !== snapshot.source.headSha) {
        fallbackReason = 'Archived branch moved after archive'
      } else {
        const checkoutPath = await branchCheckoutPath(request.repositoryPath, snapshot.source.branch)
        if (checkoutPath && path.resolve(checkoutPath) !== path.resolve(targetPath)) {
          fallbackReason = 'Archived branch is checked out elsewhere'
        } else {
          const currentBranch = (await listGitWorktrees(request.repositoryPath)).find((entry) => {
            try { return fs.realpathSync(entry.path) === fs.realpathSync(targetPath) } catch { return false }
          })?.branch
          if (currentBranch !== snapshot.source.branch) await checkoutBranch(targetPath, snapshot.source.branch)
          branchAttached = true
          await this.appendReceipt(operation, 'restoreCheckout', 'branchAttached', 'branch', {
            checkoutPath: targetPath,
            branch: snapshot.source.branch,
            headSha: snapshot.source.headSha,
          })
        }
      }
    }

    this.dependencies.writeOwnershipManifest(record.manifestPath, {
      version: 2,
      worktreeId: record.id,
      projectId: record.projectId,
      taskId: operation.taskId,
      checkoutPath: targetPath,
      gitCommonDir: record.gitCommonDir,
      createdAt: record.createdAt,
      restoreOperationId: operation.id,
      ownershipToken: reservation.ownershipToken,
    })
    await this.appendReceipt(operation, 'restoreCheckout', 'ownershipManifestPublished', 'manifest', {
      manifestPath: record.manifestPath,
      ownershipToken: reservation.ownershipToken,
    })
    await this.assertSourceMatchesSnapshot(targetPath, snapshot)
    await this.verifyOwnedSource(record)
    await this.appendReceipt(operation, 'restoreVerification', 'checkoutVerified', 'checkout', {
      checkoutPath: targetPath,
      headSha: snapshot.source.headSha,
      ...(fallbackReason ? { fallbackReason } : {}),
    })
    return { checkoutPath: targetPath, branchAttached, fallbackReason }
  }

  private async purgeArchiveQuarantineInternal(operationId: string, worktreeId: string): Promise<void> {
    const { operation, record } = this.authority(operationId, 'archive', worktreeId)
    if (!operation.receipts.some((receipt) => receipt.subphase === 'worktreeUnregistered')) {
      throw new Error('Archive quarantine cannot be purged before worktree removal is observed')
    }
    const quarantinePath = this.quarantinePath(record, operation.id)
    if (fs.existsSync(quarantinePath)) {
      const authorized = authorizeExistingPath(fs.realpathSync(record.recordedRoot), quarantinePath)
      fs.rmSync(authorized, { recursive: true })
      flushDirectory(path.dirname(authorized))
    }
    await this.appendReceipt(operation, 'archived', 'quarantinePurged', 'archive-quarantine', { quarantinePath })
  }

  private async retireRestoredSnapshotInternal(request: RestorePreparedArchiveRequest): Promise<void> {
    const { operation, record } = this.authority(request.operationId, 'restore', request.worktreeId)
    this.assertSnapshotAuthority(operation, record, request.snapshot)
    if (!operation.receipts.some((receipt) => receipt.subphase === 'taskCommitted')) {
      throw new Error('Restored snapshot cannot be retired before the task commit is durable')
    }

    const owned = await this.verifyOwnedSource(record)
    if (await resolveGitRef(owned.checkoutPath, 'HEAD') !== request.snapshot.headSha) {
      throw new Error('Restored worktree HEAD changed before snapshot retirement')
    }
    const privateRef = record.privateRef
    if (!privateRef) throw new Error('Restored worktree is missing its private archive ref')
    const privateHead = await this.tryResolveRef(request.repositoryPath, privateRef)
    if (privateHead && privateHead !== request.snapshot.headSha) {
      throw new Error('Private ref changed before restored snapshot retirement')
    }

    if (!operation.receipts.some((receipt) => receipt.subphase === 'snapshotPurged')) {
      const snapshot = request.snapshotStore.load(request.snapshot)
      if (snapshot.source.privateRef !== privateRef) {
        throw new Error('Restored snapshot private ref does not match worktree authority')
      }
      await this.assertSourceMatchesSnapshot(owned.checkoutPath, snapshot)
      request.snapshotStore.purge(request.snapshot, { taskId: operation.taskId, worktreeId: record.id })
      await this.appendReceipt(operation, 'restored', 'snapshotPurged', 'restored-snapshot', {
        artifactId: request.snapshot.artifactId,
        artifactPath: request.snapshot.artifactPath,
      })
    }

    if (privateHead) {
      await runGit(request.repositoryPath, ['update-ref', '-d', privateRef, request.snapshot.headSha])
    }
    await this.appendReceipt(operation, 'restored', 'privateRefPurged', 'restored-private-ref', {
      privateRef,
      headSha: request.snapshot.headSha,
    })
  }

  private async purgeOwnedArtifactsInternal(request: PurgeOwnedArtifactsRequest): Promise<void> {
    const { operation, record } = this.authority(request.operationId, 'delete', request.worktreeId)
    this.assertSnapshotAuthority(operation, record, request.snapshot)
    const selectors = operation.purgeSelectors
    if (!selectors) throw new Error('Delete operation has no durable purge selectors')
    const quarantinePath = path.resolve(selectors.quarantinePaths[0] ?? '')
    const quarantineRoot = path.join(fs.realpathSync(record.recordedRoot), '.cranberri', 'quarantine')
    const quarantineRelative = path.relative(quarantineRoot, quarantinePath)
    if (!quarantineRelative || quarantineRelative.startsWith('..') || path.isAbsolute(quarantineRelative)) {
      throw new Error('Purge quarantine selector is outside owned artifact storage')
    }
    const privateRef = selectors.privateRefs[0] ?? ''
    const exactSelectors = selectors.taskIds.length === 1 && selectors.taskIds[0] === operation.taskId
      && selectors.worktreeIds.length === 1 && selectors.worktreeIds[0] === record.id
      && selectors.artifactIds.length === 1 && selectors.artifactIds[0] === request.snapshot.artifactId
      && selectors.privateRefs.length === 1 && /^refs\/cranberri\/tasks\/[A-Za-z0-9._-]+$/.test(privateRef)
      && selectors.quarantinePaths.length === 1
      && selectors.snapshotPaths.length === 1 && path.resolve(selectors.snapshotPaths[0] ?? '') === path.resolve(request.snapshot.artifactPath)
      && selectors.ownershipManifestPaths.length === 1
      && path.resolve(selectors.ownershipManifestPaths[0] ?? '') === path.resolve(record.manifestPath)
    if (!exactSelectors) throw new Error('Purge selectors do not match owned worktree artifacts')

    if (fs.existsSync(request.snapshot.artifactPath)) {
      const snapshot = request.snapshotStore.load(request.snapshot)
      if (snapshot.source.privateRef !== privateRef) throw new Error('Purge private ref does not match snapshot ownership')
      request.snapshotStore.purge(request.snapshot, { taskId: operation.taskId, worktreeId: record.id })
    }
    await this.appendReceipt(operation, 'purging', 'snapshotPurged', 'snapshot', {
      artifactId: request.snapshot.artifactId,
      artifactPath: request.snapshot.artifactPath,
    })

    const privateHead = await this.tryResolveRef(request.repositoryPath, privateRef)
    if (privateHead && privateHead !== request.snapshot.headSha) {
      throw new Error('Private ref changed before owned artifact purge')
    }
    if (privateHead) await runGit(request.repositoryPath, ['update-ref', '-d', privateRef, request.snapshot.headSha])
    await this.appendReceipt(operation, 'purging', 'privateRefPurged', 'private-ref', {
      privateRef,
      headSha: request.snapshot.headSha,
    })

    if (fs.existsSync(quarantinePath)) {
      const authorized = authorizeExistingPath(fs.realpathSync(record.recordedRoot), quarantinePath)
      fs.rmSync(authorized, { recursive: true })
      flushDirectory(path.dirname(authorized))
    }
    await this.appendReceipt(operation, 'purging', 'quarantinePurged', 'quarantine', { quarantinePath })

    if (fs.existsSync(record.manifestPath)) {
      const manifestPath = authorizeExistingPath(fs.realpathSync(record.recordedRoot), record.manifestPath)
      const manifest = this.readManifest(manifestPath)
      if (manifest.worktreeId !== record.id || manifest.taskId !== operation.taskId) {
        throw new Error('Ownership manifest changed before purge')
      }
      fs.rmSync(manifestPath)
      flushDirectory(path.dirname(manifestPath))
    }
    await this.appendReceipt(operation, 'purging', 'ownershipManifestPurged', 'manifest', {
      manifestPath: record.manifestPath,
    })
  }

  private authority(
    operationId: string,
    kind: LifecycleOperation['kind'],
    worktreeId: string,
  ): { operation: LifecycleOperation; record: ManagedWorktree } {
    const state = this.store.read()
    const operation = state.lifecycleOperations.find((candidate) => candidate.id === operationId)
    if (!operation || operation.kind !== kind || operation.worktreeId !== worktreeId) {
      throw new Error(`Missing durable ${kind} authority for managed worktree`)
    }
    const record = state.managedWorktrees.find((candidate) => candidate.id === worktreeId)
    if (!record || record.taskId !== operation.taskId) throw new Error('Lifecycle authority ownership does not match worktree')
    return { operation, record }
  }

  private async appendReceipt(
    operation: LifecycleOperation,
    phase: LifecycleOperationReceipt['phase'],
    subphase: LifecycleOperationReceipt['subphase'],
    key: string,
    details: NonNullable<LifecycleOperationReceipt['details']>,
  ): Promise<void> {
    const receiptId = `${operation.id}:${subphase}:${key}`
    const current = this.store.read().lifecycleOperations.find((candidate) => candidate.id === operation.id)
    if (current?.receipts.some((receipt) => receipt.receiptId === receiptId)) return
    await this.store.appendLifecycleReceipt(operation.id, {
      phase,
      subphase,
      recordedAt: Date.now(),
      receiptId,
      details,
    })
  }

  private snapshotDescriptorFromReceipts(operation: LifecycleOperation): WorktreeSnapshotDescriptor | null {
    const details = operation.receipts.find((receipt) => receipt.subphase === 'snapshotVerified')?.details
    if (!details?.artifactId || !details.artifactPath || details.artifactBytes === undefined || !details.digest
      || !details.headSha || details.bundleIncluded === undefined) return null
    return {
      version: 1,
      artifactId: details.artifactId,
      taskId: operation.taskId,
      worktreeId: operation.worktreeId ?? '',
      artifactPath: details.artifactPath,
      artifactBytes: details.artifactBytes,
      artifactDigestSha256: details.digest,
      headSha: details.headSha,
      bundleIncluded: details.bundleIncluded,
    }
  }

  private receiptDetail(
    operation: LifecycleOperation,
    subphase: LifecycleOperationReceipt['subphase'],
    key: keyof NonNullable<LifecycleOperationReceipt['details']>,
  ): string | undefined {
    const value = operation.receipts.find((receipt) => receipt.subphase === subphase)?.details?.[key]
    return typeof value === 'string' ? value : undefined
  }

  private assertSnapshotAuthority(
    operation: LifecycleOperation,
    record: ManagedWorktree,
    descriptor: WorktreeSnapshotDescriptor,
  ): void {
    if (operation.artifactId !== descriptor.artifactId || descriptor.taskId !== operation.taskId
      || descriptor.worktreeId !== record.id) {
      throw new Error('Snapshot descriptor does not match durable lifecycle authority')
    }
  }

  private async verifyOwnedSource(record: ManagedWorktree): Promise<{
    checkoutPath: string
    gitCommonDir: string
    entry: Awaited<ReturnType<typeof listGitWorktrees>>[number]
  }> {
    const root = fs.realpathSync(record.recordedRoot)
    const checkoutPath = authorizeExistingPath(root, record.path)
    const manifestPath = authorizeExistingPath(root, record.manifestPath)
    const manifest = this.readManifest(manifestPath)
    if (manifest.worktreeId !== record.id || manifest.projectId !== record.projectId || manifest.taskId !== record.taskId
      || fs.realpathSync(manifest.checkoutPath) !== checkoutPath
      || fs.realpathSync(manifest.gitCommonDir) !== fs.realpathSync(record.gitCommonDir)) {
      throw new Error('Managed worktree ownership verification failed')
    }
    const gitCommonDir = fs.realpathSync(record.gitCommonDir)
    if (await canonicalGitCommonDir(checkoutPath) !== gitCommonDir) {
      throw new Error('Managed worktree Git ownership mismatch')
    }
    const entry = (await listGitWorktrees(checkoutPath)).find((candidate) => {
      try { return fs.realpathSync(candidate.path) === checkoutPath } catch { return false }
    })
    if (!entry) throw new Error('Managed worktree is not registered with Git')
    return { checkoutPath, gitCommonDir, entry }
  }

  private readManifest(manifestPath: string): OwnershipManifest {
    const value = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as Record<string, unknown>
    if ((value.version !== 1 && value.version !== 2) || !value.worktreeId || !value.projectId || value.taskId === undefined
      || !value.checkoutPath || !value.gitCommonDir || typeof value.createdAt !== 'number') {
      throw new Error('Managed worktree ownership manifest is invalid')
    }
    if (value.version === 2 && (!value.restoreOperationId || !value.ownershipToken)) {
      throw new Error('Managed worktree restore ownership manifest is invalid')
    }
    return value as unknown as OwnershipManifest
  }

  private async assertSourceMatchesSnapshot(
    checkoutPath: string,
    snapshot: ReturnType<WorktreeSnapshotStore['load']>,
  ): Promise<void> {
    if (await resolveGitRef(checkoutPath, 'HEAD') !== snapshot.source.headSha) {
      throw new Error('Managed worktree HEAD changed after snapshot verification')
    }
    if (await resolveGitRef(checkoutPath, snapshot.source.privateRef) !== snapshot.source.headSha) {
      throw new Error('Managed worktree private ref changed after snapshot verification')
    }
    const current = await captureLocalChanges(checkoutPath, snapshot.source.headSha)
    if (!localChangesEqual(current, snapshot.changes)) {
      const mismatch = [
        !current.stagedPatch.equals(snapshot.changes.stagedPatch) ? 'staged patch' : null,
        !current.unstagedPatch.equals(snapshot.changes.unstagedPatch) ? 'unstaged patch' : null,
        current.untrackedFiles.length !== snapshot.changes.untrackedFiles.length ? 'untracked file count' : null,
      ].filter(Boolean).join(', ')
      throw new Error(`Managed worktree changed after snapshot verification${mismatch ? ` (${mismatch})` : ''}`)
    }
  }

  private quarantinePath(record: ManagedWorktree, operationId: string): string {
    return authorizeManagedPath(
      fs.realpathSync(record.recordedRoot),
      path.join(record.recordedRoot, '.cranberri', 'quarantine', operationId),
    )
  }

  private containedPath(rootPath: string, relativePath: string): string {
    const candidate = path.resolve(rootPath, relativePath)
    const relative = path.relative(path.resolve(rootPath), candidate)
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || relative.includes('\\')) {
      throw new Error('Archive path escapes its owned root')
    }
    return candidate
  }

  private readStableRegularFile(filePath: string, relativePath: string): Buffer {
    let descriptor: number | undefined
    try {
      const before = fs.lstatSync(filePath)
      if (!before.isFile() || before.isSymbolicLink()) throw new Error(`Cannot quarantine unsafe path: ${relativePath}`)
      descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW)
      const opened = fs.fstatSync(descriptor)
      const contents = fs.readFileSync(descriptor)
      const after = fs.fstatSync(descriptor)
      if (!opened.isFile() || opened.dev !== after.dev || opened.ino !== after.ino || opened.size !== after.size
        || opened.mtimeMs !== after.mtimeMs || contents.length !== after.size) {
        throw new Error(`Archive source changed while reading: ${relativePath}`)
      }
      return contents
    } finally {
      if (descriptor !== undefined) fs.closeSync(descriptor)
    }
  }

  private async untrackedAndIgnoredPaths(checkoutPath: string): Promise<string[]> {
    const [untracked, ignored] = await Promise.all([
      runGitBuffer(checkoutPath, ['ls-files', '-z', '--others', '--exclude-standard']),
      runGitBuffer(checkoutPath, ['ls-files', '-z', '--others', '--ignored', '--exclude-standard']),
    ])
    const parse = (output: Buffer): string[] => output.toString('utf8').split('\0').filter(Boolean)
    return [...new Set([...parse(untracked), ...parse(ignored)])].sort()
  }

  private async reconstructSource(
    operation: LifecycleOperation,
    checkoutPath: string,
    quarantinePath: string,
    snapshot: ReturnType<WorktreeSnapshotStore['load']>,
  ): Promise<void> {
    await runGit(checkoutPath, ['reset', '--hard', snapshot.source.headSha])
    const currentOperation = this.store.read().lifecycleOperations.find((candidate) => candidate.id === operation.id)
    if (!currentOperation) throw new Error('Lifecycle operation disappeared during source reconstruction')
    const relativePaths = currentOperation.receipts
      .filter((receipt) => receipt.subphase === 'sourceEntryMovePlanned')
      .flatMap((receipt) => receipt.details?.relativePath ? [receipt.details.relativePath] : [])
    for (const relativePath of [...new Set(relativePaths)].sort()) {
      const sourcePath = this.containedPath(checkoutPath, relativePath)
      const quarantinedPath = this.containedPath(quarantinePath, relativePath)
      if (!fs.existsSync(quarantinedPath)) continue
      const quarantined = this.readStableRegularFile(quarantinedPath, relativePath)
      if (fs.existsSync(sourcePath)) {
        if (!this.readStableRegularFile(sourcePath, relativePath).equals(quarantined)) {
          throw new Error(`Cannot reconstruct changed source entry: ${relativePath}`)
        }
        fs.rmSync(quarantinedPath)
      } else {
        fs.mkdirSync(path.dirname(sourcePath), { recursive: true })
        fs.renameSync(quarantinedPath, sourcePath)
      }
    }
    await applyLocalChanges(checkoutPath, { ...snapshot.changes, untrackedFiles: [] })
    await this.assertSourceMatchesSnapshot(checkoutPath, snapshot)
    await this.appendReceipt(operation, 'sourceNormalization', 'sourceReconstructed', 'reconstruction', {
      sourcePath: checkoutPath,
      quarantinePath,
      headSha: snapshot.source.headSha,
    })
  }

  private async tryResolveRef(checkoutPath: string, ref: string): Promise<string | null> {
    try {
      return await resolveGitRef(checkoutPath, ref)
    } catch {
      return null
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

    await removeGitWorktreeDefault(checkoutPath, checkoutPath)
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
