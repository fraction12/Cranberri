import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import {
  MAX_WORKTREE_SNAPSHOT_BYTES,
  WORKTREE_SNAPSHOT_VERSION,
  decodeWorktreeSnapshot,
  encodeWorktreeSnapshot,
  snapshotDigest,
  type WorktreeSnapshot,
  type WorktreeSnapshotDescriptor,
  worktreeSnapshotDescriptorSchema,
} from '../shared/worktree-snapshots'
import {
  canonicalGitCommonDir,
  captureLocalChanges,
  createDetachedWorktree,
  createGitHeadArchive,
  hasDurablePublicCommitReference,
  importGitHeadArchive,
  localChangesEqual,
  removeGitWorktree,
  resolveGitRef,
  verifyGitHeadArchive,
  verifyLocalChangesRoundTrip,
} from './git-worktrees'

export interface CaptureWorktreeSnapshotInput {
  snapshotId: string
  taskId: string
  worktreeId: string
  checkoutPath: string
  gitCommonDir: string
  expectedHeadSha: string
  branch: string | null
  privateRef: string
  environmentRevision: string | null
}

export type SnapshotDurabilityPoint =
  | 'beforeTemporaryFileFlush'
  | 'afterTemporaryFileFlush'
  | 'afterPublish'
  | 'afterDirectoryFlush'

interface WorktreeSnapshotStoreOptions {
  faultInjector?: (point: SnapshotDurabilityPoint) => void
  now?: () => number
}

function assertArtifactId(artifactId: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(artifactId)) throw new Error('Invalid snapshot artifact ID')
}

function flushDirectory(directoryPath: string): void {
  const descriptor = fs.openSync(directoryPath, fs.constants.O_RDONLY)
  try {
    fs.fsyncSync(descriptor)
  } finally {
    fs.closeSync(descriptor)
  }
}

function readOwnerOnlyFile(filePath: string): Buffer {
  let descriptor: number | undefined
  try {
    descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW)
    const before = fs.fstatSync(descriptor)
    if (!before.isFile()) throw new Error('Snapshot artifact is not a regular file')
    if ((before.mode & 0o077) !== 0) throw new Error('Snapshot artifact permissions are not owner-only')
    if (before.size > MAX_WORKTREE_SNAPSHOT_BYTES) throw new Error('Worktree snapshot exceeds the 64 MiB limit')
    const contents = fs.readFileSync(descriptor)
    const after = fs.fstatSync(descriptor)
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size
      || before.mtimeMs !== after.mtimeMs || contents.length !== after.size) {
      throw new Error('Snapshot artifact changed while it was being read')
    }
    return contents
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor)
  }
}

export class WorktreeSnapshotStore {
  constructor(
    private readonly rootPath: string,
    private readonly options: WorktreeSnapshotStoreOptions = {},
  ) {}

  pathFor(artifactId: string): string {
    assertArtifactId(artifactId)
    return path.join(path.resolve(this.rootPath), `${artifactId}.snapshot.json`)
  }

  recoverDescriptor(
    artifactId: string,
    expectedOwner: { taskId: string; worktreeId: string },
  ): WorktreeSnapshotDescriptor {
    const artifactPath = this.pathFor(artifactId)
    const artifact = readOwnerOnlyFile(artifactPath)
    const snapshot = decodeWorktreeSnapshot(artifact)
    if (snapshot.artifactId !== artifactId || snapshot.taskId !== expectedOwner.taskId
      || snapshot.worktreeId !== expectedOwner.worktreeId) {
      throw new Error('Published snapshot ownership does not match lifecycle authority')
    }
    const descriptor = worktreeSnapshotDescriptorSchema.parse({
      version: WORKTREE_SNAPSHOT_VERSION,
      artifactId,
      taskId: snapshot.taskId,
      worktreeId: snapshot.worktreeId,
      artifactPath,
      artifactBytes: artifact.length,
      artifactDigestSha256: snapshotDigest(artifact),
      headSha: snapshot.source.headSha,
      bundleIncluded: snapshot.headArchive !== null,
    })
    this.load(descriptor)
    return descriptor
  }

  async capture(input: CaptureWorktreeSnapshotInput): Promise<WorktreeSnapshotDescriptor> {
    assertArtifactId(input.snapshotId)
    const expectedCommonDir = fs.realpathSync(input.gitCommonDir)
    if (await canonicalGitCommonDir(input.checkoutPath) !== expectedCommonDir) {
      throw new Error('Snapshot source Git common directory does not match ownership metadata')
    }
    if (await resolveGitRef(input.checkoutPath, 'HEAD') !== input.expectedHeadSha) {
      throw new Error('Snapshot source HEAD changed before capture')
    }
    if (await resolveGitRef(input.checkoutPath, input.privateRef) !== input.expectedHeadSha) {
      throw new Error('Snapshot private ref does not match archived HEAD')
    }

    const changes = await captureLocalChanges(input.checkoutPath, input.expectedHeadSha)
    const headArchive = await hasDurablePublicCommitReference(input.checkoutPath, input.expectedHeadSha)
      ? null
      : {
          format: 'git-bundle-v1' as const,
          ref: input.privateRef,
          contents: await createGitHeadArchive(input.checkoutPath, input.privateRef, input.expectedHeadSha),
        }
    const snapshot: WorktreeSnapshot = {
      artifactId: input.snapshotId,
      taskId: input.taskId,
      worktreeId: input.worktreeId,
      capturedAt: (this.options.now ?? Date.now)(),
      source: {
        gitCommonDir: expectedCommonDir,
        headSha: input.expectedHeadSha,
        branch: input.branch,
        privateRef: input.privateRef,
        environmentRevision: input.environmentRevision,
      },
      changes,
      headArchive,
    }
    const descriptor = this.publish(snapshot)
    const published = this.load(descriptor)
    if (published.headArchive) {
      await verifyGitHeadArchive(input.checkoutPath, published.headArchive.contents, published.headArchive.ref, published.source.headSha)
    }
    await verifyLocalChangesRoundTrip(input.checkoutPath, published.changes)

    const sourceAfterValidation = await captureLocalChanges(input.checkoutPath, input.expectedHeadSha)
    if (!localChangesEqual(published.changes, sourceAfterValidation)) {
      throw new Error('Snapshot source changed during independent verification')
    }
    if (await canonicalGitCommonDir(input.checkoutPath) !== expectedCommonDir
      || await resolveGitRef(input.checkoutPath, 'HEAD') !== input.expectedHeadSha
      || await resolveGitRef(input.checkoutPath, input.privateRef) !== input.expectedHeadSha) {
      throw new Error('Snapshot Git ownership changed during independent verification')
    }
    return descriptor
  }

  load(descriptor: WorktreeSnapshotDescriptor): WorktreeSnapshot {
    const parsed = worktreeSnapshotDescriptorSchema.parse(descriptor)
    const expectedPath = this.pathFor(parsed.artifactId)
    if (path.resolve(parsed.artifactPath) !== expectedPath) throw new Error('Snapshot artifact path is outside its owner store')
    const artifact = readOwnerOnlyFile(expectedPath)
    if (artifact.length !== parsed.artifactBytes || snapshotDigest(artifact) !== parsed.artifactDigestSha256) {
      throw new Error('Snapshot artifact digest or size mismatch')
    }
    const snapshot = decodeWorktreeSnapshot(artifact)
    if (snapshot.artifactId !== parsed.artifactId || snapshot.taskId !== parsed.taskId
      || snapshot.worktreeId !== parsed.worktreeId || snapshot.source.headSha !== parsed.headSha
      || (snapshot.headArchive !== null) !== parsed.bundleIncluded) {
      throw new Error('Snapshot artifact ownership does not match its descriptor')
    }
    return snapshot
  }

  async restore(
    descriptor: WorktreeSnapshotDescriptor,
    repositoryPath: string,
    targetPath: string,
  ): Promise<void> {
    const snapshot = this.load(descriptor)
    if (await canonicalGitCommonDir(repositoryPath) !== snapshot.source.gitCommonDir) {
      throw new Error('Restore repository does not match snapshot Git ownership')
    }
    if (snapshot.headArchive) {
      await importGitHeadArchive(repositoryPath, snapshot.headArchive.contents, snapshot.headArchive.ref, snapshot.source.headSha)
    } else if (await resolveGitRef(repositoryPath, snapshot.source.privateRef) !== snapshot.source.headSha) {
      throw new Error('Snapshot private ref does not match archived HEAD')
    }

    let created = false
    try {
      await createDetachedWorktree(repositoryPath, targetPath, snapshot.source.headSha, { localChanges: snapshot.changes })
      created = true
      const reconstructed = await captureLocalChanges(targetPath, snapshot.source.headSha)
      if (!localChangesEqual(snapshot.changes, reconstructed)) throw new Error('Restored worktree does not match snapshot state')
    } catch (error) {
      if (created) {
        try {
          await removeGitWorktree(repositoryPath, targetPath)
        } catch (cleanupError) {
          throw new Error('Restore verification failed and its checkout could not be unregistered', { cause: cleanupError })
        }
      }
      throw error
    }
  }

  purge(
    descriptor: WorktreeSnapshotDescriptor,
    expectedOwner: { taskId: string; worktreeId: string },
  ): void {
    const snapshot = this.load(descriptor)
    if (descriptor.taskId !== expectedOwner.taskId || descriptor.worktreeId !== expectedOwner.worktreeId
      || snapshot.taskId !== expectedOwner.taskId || snapshot.worktreeId !== expectedOwner.worktreeId) {
      throw new Error('Snapshot artifact ownership does not match purge authority')
    }
    fs.rmSync(this.pathFor(descriptor.artifactId))
    flushDirectory(path.resolve(this.rootPath))
  }

  private publish(snapshot: WorktreeSnapshot): WorktreeSnapshotDescriptor {
    const artifact = encodeWorktreeSnapshot(snapshot)
    const root = this.ensureRoot()
    const targetPath = this.pathFor(snapshot.artifactId)
    if (fs.existsSync(targetPath)) throw new Error('Snapshot artifact already exists')
    const temporaryPath = path.join(root, `.${snapshot.artifactId}.${process.pid}.${randomUUID()}.tmp`)
    const file = fs.openSync(temporaryPath, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY, 0o600)
    let closed = false
    try {
      fs.writeFileSync(file, artifact)
      this.options.faultInjector?.('beforeTemporaryFileFlush')
      fs.fsyncSync(file)
      this.options.faultInjector?.('afterTemporaryFileFlush')
      fs.closeSync(file)
      closed = true
      fs.linkSync(temporaryPath, targetPath)
      fs.rmSync(temporaryPath)
      this.options.faultInjector?.('afterPublish')
      flushDirectory(root)
      this.options.faultInjector?.('afterDirectoryFlush')
    } catch (error) {
      if (!closed) {
        try { fs.closeSync(file) } catch { /* preserve the original failure */ }
      }
      // A flushed temporary generation is retained for startup reconciliation.
      throw error
    }
    return {
      version: WORKTREE_SNAPSHOT_VERSION,
      artifactId: snapshot.artifactId,
      taskId: snapshot.taskId,
      worktreeId: snapshot.worktreeId,
      artifactPath: targetPath,
      artifactBytes: artifact.length,
      artifactDigestSha256: snapshotDigest(artifact),
      headSha: snapshot.source.headSha,
      bundleIncluded: snapshot.headArchive !== null,
    }
  }

  private ensureRoot(): string {
    const root = path.resolve(this.rootPath)
    if (fs.existsSync(root) && fs.lstatSync(root).isSymbolicLink()) throw new Error('Snapshot root cannot be a symlink')
    fs.mkdirSync(root, { recursive: true, mode: 0o700 })
    if (!fs.statSync(root).isDirectory()) throw new Error('Snapshot root is not a directory')
    fs.chmodSync(root, 0o700)
    return root
  }
}
