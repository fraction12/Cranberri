import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  assertWorktreeSnapshotSize,
  encodeWorktreeSnapshot,
  snapshotDigest,
  WORKTREE_SNAPSHOT_LIMIT_BYTES,
} from '../shared/worktree-snapshots'
import {
  canonicalGitCommonDir,
  captureLocalChanges,
  createPrivateTaskRef,
  localChangesEqual,
} from './git-worktrees'
import { WorktreeSnapshotStore, type CaptureWorktreeSnapshotInput } from './worktree-snapshot-store'

const roots: string[] = []

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
}

function fixture(): { root: string; remote: string; repo: string; head: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cranberri-snapshot-'))
  roots.push(root)
  const remote = path.join(root, 'origin.git')
  const repo = path.join(root, 'source')
  fs.mkdirSync(remote)
  git(remote, 'init', '--bare')
  git(root, 'clone', remote, repo)
  git(repo, 'switch', '-c', 'main')
  git(repo, 'config', 'user.name', 'Cranberri Test')
  git(repo, 'config', 'user.email', 'test@cranberri.local')
  fs.writeFileSync(path.join(repo, '.gitignore'), 'ignored.txt\n')
  fs.writeFileSync(path.join(repo, 'binary.bin'), Buffer.from([0, 1, 2, 3]))
  fs.writeFileSync(path.join(repo, 'script.sh'), '#!/bin/sh\necho base\n', { mode: 0o644 })
  git(repo, 'add', '.')
  git(repo, 'commit', '-m', 'initial')
  git(repo, 'push', '-u', 'origin', 'main')
  return { root, remote, repo, head: git(repo, 'rev-parse', 'HEAD') }
}

async function captureInput(
  repo: string,
  head: string,
  ids: { artifactId: string; taskId: string; worktreeId: string },
): Promise<CaptureWorktreeSnapshotInput> {
  const privateRef = await createPrivateTaskRef(repo, ids.taskId, head)
  return {
    snapshotId: ids.artifactId,
    taskId: ids.taskId,
    worktreeId: ids.worktreeId,
    checkoutPath: repo,
    gitCommonDir: await canonicalGitCommonDir(repo),
    expectedHeadSha: head,
    branch: 'main',
    privateRef,
    environmentRevision: 'environment-v1',
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe('WorktreeSnapshotStore', () => {
  it('publishes owner-only state and round-trips exact Git layers without mutating the source', async () => {
    const { root, repo, head } = fixture()
    fs.writeFileSync(path.join(repo, 'binary.bin'), Buffer.from([4, 5, 0, 255]))
    git(repo, 'add', 'binary.bin')
    fs.writeFileSync(path.join(repo, 'binary.bin'), Buffer.from([9, 8, 0, 254]))
    fs.chmodSync(path.join(repo, 'script.sh'), 0o755)
    fs.mkdirSync(path.join(repo, 'nested', 'cafe'), { recursive: true })
    fs.writeFileSync(path.join(repo, 'nested', 'cafe', '雪.txt'), 'snow\n', { mode: 0o744 })
    fs.writeFileSync(path.join(repo, 'ignored.txt'), 'not archived\n')
    const beforeStatus = git(repo, 'status', '--porcelain=v1')
    const expected = await captureLocalChanges(repo, head)
    const store = new WorktreeSnapshotStore(path.join(root, 'snapshots'))

    const descriptor = await store.capture(await captureInput(repo, head, {
      artifactId: 'snapshot-one', taskId: 'task-one', worktreeId: 'worktree-one',
    }))
    const restorePath = path.join(root, 'restored')
    await store.restore(descriptor, repo, restorePath)

    expect(git(repo, 'status', '--porcelain=v1')).toBe(beforeStatus)
    expect(localChangesEqual(await captureLocalChanges(restorePath, head), expected)).toBe(true)
    expect(fs.readFileSync(path.join(restorePath, 'binary.bin'))).toEqual(Buffer.from([9, 8, 0, 254]))
    expect(fs.statSync(path.join(restorePath, 'script.sh')).mode & 0o777).toBe(0o755)
    expect(fs.statSync(path.join(restorePath, 'nested', 'cafe', '雪.txt')).mode & 0o777).toBe(0o744)
    expect(fs.existsSync(path.join(restorePath, 'ignored.txt'))).toBe(false)
    expect(store.load(descriptor).headArchive).toBeNull()
    expect(fs.statSync(path.dirname(descriptor.artifactPath)).mode & 0o777).toBe(0o700)
    expect(fs.statSync(descriptor.artifactPath).mode & 0o777).toBe(0o600)
  })

  it('restores an unpushed HEAD from its verified Git bundle after all refs and loose objects are pruned', async () => {
    const { root, repo } = fixture()
    fs.writeFileSync(path.join(repo, 'unique.txt'), 'unique commit\n')
    git(repo, 'add', 'unique.txt')
    git(repo, 'commit', '-m', 'unique unpushed commit')
    const head = git(repo, 'rev-parse', 'HEAD')
    git(repo, 'tag', 'local-only')
    fs.writeFileSync(path.join(repo, 'untracked.txt'), 'local state\n')
    const store = new WorktreeSnapshotStore(path.join(root, 'snapshots'))
    const input = await captureInput(repo, head, {
      artifactId: 'snapshot-bundle', taskId: 'task-bundle', worktreeId: 'worktree-bundle',
    })
    const descriptor = await store.capture(input)
    expect(store.load(descriptor).headArchive?.contents.length).toBeGreaterThan(0)

    git(repo, 'reset', '--hard', 'origin/main')
    git(repo, 'update-ref', '-d', input.privateRef)
    git(repo, 'tag', '-d', 'local-only')
    git(repo, 'reflog', 'expire', '--expire=now', '--all')
    git(repo, 'gc', '--prune=now')
    expect(() => git(repo, 'cat-file', '-e', `${head}^{commit}`)).toThrow()

    const restored = path.join(root, 'bundle-restored')
    await store.restore(descriptor, repo, restored)

    expect(git(restored, 'rev-parse', 'HEAD')).toBe(head)
    expect(fs.readFileSync(path.join(restored, 'unique.txt'), 'utf8')).toBe('unique commit\n')
    expect(fs.readFileSync(path.join(restored, 'untracked.txt'), 'utf8')).toBe('local state\n')
  })

  it('rejects artifact tampering, private-ref mismatches, and validly encoded patches that cannot apply', async () => {
    const { root, repo, head } = fixture()
    const store = new WorktreeSnapshotStore(path.join(root, 'snapshots'))
    const input = await captureInput(repo, head, {
      artifactId: 'snapshot-tamper', taskId: 'task-tamper', worktreeId: 'worktree-tamper',
    })
    const descriptor = await store.capture(input)
    const artifactPath = descriptor.artifactPath
    const artifact = fs.readFileSync(artifactPath)
    artifact[artifact.length - 2] = artifact[artifact.length - 2]! ^ 1
    fs.writeFileSync(artifactPath, artifact)
    expect(() => store.load(descriptor)).toThrow(/digest|snapshot/i)

    fs.writeFileSync(path.join(repo, 'later.txt'), 'later\n')
    git(repo, 'add', 'later.txt')
    git(repo, 'commit', '-m', 'later')
    const laterHead = git(repo, 'rev-parse', 'HEAD')
    git(repo, 'reset', '--hard', head)
    git(repo, 'update-ref', input.privateRef, laterHead)
    await expect(store.capture({ ...input, snapshotId: 'snapshot-mismatch' })).rejects.toThrow(/private ref/i)
    git(repo, 'update-ref', input.privateRef, head)

    const valid = await store.capture({ ...input, snapshotId: 'snapshot-invalid-patch' })
    const invalidSnapshot = store.load(valid)
    invalidSnapshot.artifactId = 'snapshot-invalid-encoded'
    invalidSnapshot.changes.stagedPatch = Buffer.from('not a patch')
    const invalidArtifact = encodeWorktreeSnapshot(invalidSnapshot)
    const invalidPath = path.join(path.dirname(valid.artifactPath), 'snapshot-invalid-encoded.snapshot.json')
    fs.writeFileSync(invalidPath, invalidArtifact, { mode: 0o600 })
    const invalidDescriptor = {
      ...valid,
      artifactId: 'snapshot-invalid-encoded',
      artifactPath: invalidPath,
      artifactDigestSha256: snapshotDigest(invalidArtifact),
      artifactBytes: invalidArtifact.length,
    }
    await expect(store.restore(invalidDescriptor, repo, path.join(root, 'invalid-restore'))).rejects.toThrow()
    expect(git(repo, 'worktree', 'list', '--porcelain')).not.toContain('invalid-restore')
  })

  it('retains interrupted generations and refuses cross-task purge', async () => {
    const { root, repo, head } = fixture()
    const input = await captureInput(repo, head, {
      artifactId: 'snapshot-interrupted', taskId: 'task-owner', worktreeId: 'worktree-owner',
    })
    const snapshotRoot = path.join(root, 'snapshots')
    const beforeFlush = new WorktreeSnapshotStore(snapshotRoot)
    const fsync = vi.spyOn(fs, 'fsyncSync').mockImplementationOnce(() => {
      throw new Error('interrupted before flush')
    })
    await expect(beforeFlush.capture({ ...input, snapshotId: 'snapshot-before-flush' })).rejects.toThrow('interrupted before flush')
    fsync.mockRestore()
    expect(fs.existsSync(path.join(snapshotRoot, 'snapshot-before-flush.snapshot.json'))).toBe(false)

    const interrupted = new WorktreeSnapshotStore(snapshotRoot, {
      faultInjector: (point) => {
        if (point === 'afterTemporaryFileFlush') throw new Error('interrupted after flush')
      },
    })
    await expect(interrupted.capture(input)).rejects.toThrow('interrupted after flush')
    expect(fs.existsSync(path.join(snapshotRoot, `${input.snapshotId}.snapshot.json`))).toBe(false)
    expect(fs.readdirSync(snapshotRoot).some((name) => name.endsWith('.tmp'))).toBe(true)

    for (const point of ['afterPublish', 'afterDirectoryFlush'] as const) {
      const interruptedAfterPublish = new WorktreeSnapshotStore(snapshotRoot, {
        faultInjector: (candidate) => {
          if (candidate === point) throw new Error(`interrupted ${point}`)
        },
      })
      const snapshotId = `snapshot-${point}`
      await expect(interruptedAfterPublish.capture({ ...input, snapshotId })).rejects.toThrow(`interrupted ${point}`)
      expect(fs.existsSync(path.join(snapshotRoot, `${snapshotId}.snapshot.json`))).toBe(true)
    }

    const store = new WorktreeSnapshotStore(snapshotRoot)
    const descriptor = await store.capture({ ...input, snapshotId: 'snapshot-owned' })
    expect(() => store.purge(descriptor, {
      taskId: 'task-other', worktreeId: descriptor.worktreeId,
    })).toThrow(/owner|ownership/i)
    expect(fs.existsSync(descriptor.artifactPath)).toBe(true)
    store.purge(descriptor, { taskId: descriptor.taskId, worktreeId: descriptor.worktreeId })
    expect(fs.existsSync(descriptor.artifactPath)).toBe(false)
  })

  it('enforces the exact 64 MiB artifact boundary', () => {
    expect(() => assertWorktreeSnapshotSize(WORKTREE_SNAPSHOT_LIMIT_BYTES)).not.toThrow()
    expect(() => assertWorktreeSnapshotSize(WORKTREE_SNAPSHOT_LIMIT_BYTES + 1)).toThrow(/64 MiB|limit/i)
  })
})
