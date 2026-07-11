import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  captureLocalChanges,
  createDetachedWorktree,
  listSelectableRefs,
  refreshGitRefs,
  resolveGitRef,
} from './git-worktrees'

const roots: string[] = []

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
}

function fixture(): { root: string; remote: string; repo: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cranberri git ü '))
  roots.push(root)
  const remote = path.join(root, 'origin remote.git')
  const repo = path.join(root, 'local clone')
  fs.mkdirSync(remote)
  git(remote, 'init', '--bare')
  git(root, 'clone', remote, repo)
  git(repo, 'switch', '-c', 'main')
  git(repo, 'config', 'user.name', 'Cranberri Test')
  git(repo, 'config', 'user.email', 'test@cranberri.local')
  fs.writeFileSync(path.join(repo, 'tracked.txt'), 'base\n')
  git(repo, 'add', '.')
  git(repo, 'commit', '-m', 'initial')
  git(repo, 'push', '-u', 'origin', 'main')
  return { root, remote, repo }
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe('Git worktree operations', () => {
  it('refreshes each remote independently and keeps local refs after a partial failure', async () => {
    const { repo } = fixture()
    git(repo, 'remote', 'add', 'offline', path.join(path.dirname(repo), 'missing.git'))

    const refresh = await refreshGitRefs(repo)
    const refs = await listSelectableRefs(repo)

    expect(refresh.refreshedRemotes).toEqual(['origin'])
    expect(refresh.failedRemotes).toEqual(['offline'])
    expect(refresh.usedLocalFallback).toBe(true)
    expect(refs.some((ref) => ref.name === 'main' && ref.kind === 'local')).toBe(true)
    expect(refs.some((ref) => ref.name === 'origin/main' && ref.kind === 'remote')).toBe(true)
  })

  it('resolves local, remote, and tag refs to exact commits', async () => {
    const { repo } = fixture()
    git(repo, 'tag', 'v1')
    const head = git(repo, 'rev-parse', 'HEAD')

    await expect(resolveGitRef(repo, 'main')).resolves.toBe(head)
    await expect(resolveGitRef(repo, 'origin/main')).resolves.toBe(head)
    await expect(resolveGitRef(repo, 'v1')).resolves.toBe(head)
  })

  it('creates a detached worktree at the resolved SHA in a path with spaces', async () => {
    const { root, repo } = fixture()
    const sha = git(repo, 'rev-parse', 'HEAD')
    const target = path.join(root, 'managed root', 'task checkout')

    await createDetachedWorktree(repo, target, sha)

    expect(git(target, 'rev-parse', 'HEAD')).toBe(sha)
    expect(git(target, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('HEAD')
  })

  it('copies staged, unstaged, binary, and untracked changes without mutating Local', async () => {
    const { root, repo } = fixture()
    const sha = git(repo, 'rev-parse', 'HEAD')
    const target = path.join(root, 'managed', 'copy changes')
    fs.writeFileSync(path.join(repo, 'tracked.txt'), 'staged\n')
    git(repo, 'add', 'tracked.txt')
    fs.appendFileSync(path.join(repo, 'tracked.txt'), 'unstaged\n')
    fs.writeFileSync(path.join(repo, 'binary.bin'), Buffer.from([0, 1, 2, 255]))
    git(repo, 'add', 'binary.bin')
    fs.writeFileSync(path.join(repo, 'untracked.txt'), 'untracked\n')
    const beforeStatus = git(repo, 'status', '--porcelain=v1')
    const changes = await captureLocalChanges(repo, sha)

    await createDetachedWorktree(repo, target, sha, { localChanges: changes })

    expect(fs.readFileSync(path.join(target, 'tracked.txt'), 'utf8')).toBe('staged\nunstaged\n')
    expect(fs.readFileSync(path.join(target, 'binary.bin'))).toEqual(Buffer.from([0, 1, 2, 255]))
    expect(fs.readFileSync(path.join(target, 'untracked.txt'), 'utf8')).toBe('untracked\n')
    expect(git(repo, 'status', '--porcelain=v1')).toBe(beforeStatus)
    expect(git(target, 'diff', '--cached', '--name-only')).toContain('tracked.txt')
    expect(git(target, 'diff', '--name-only')).toContain('tracked.txt')
  })

  it('refuses untracked symlinks that could escape the source checkout', async () => {
    const { repo } = fixture()
    fs.symlinkSync('/tmp', path.join(repo, 'escape'))
    await expect(captureLocalChanges(repo, git(repo, 'rev-parse', 'HEAD'))).rejects.toThrow('symlink')
  })

  it('rolls back Git registration when applying captured changes fails', async () => {
    const { root, repo } = fixture()
    const sha = git(repo, 'rev-parse', 'HEAD')
    const target = path.join(root, 'managed', 'rollback')
    await expect(createDetachedWorktree(repo, target, sha, {
      localChanges: {
        baseSha: sha,
        stagedPatch: Buffer.from('not a patch'),
        unstagedPatch: Buffer.alloc(0),
        untrackedFiles: [],
      },
    })).rejects.toThrow()
    expect(fs.existsSync(target)).toBe(false)
    expect(git(repo, 'worktree', 'list', '--porcelain')).not.toContain(target)
  })
})
