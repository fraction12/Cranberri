import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  applyLocalChanges,
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

  it('round-trips executable modes, nested Unicode paths, and excludes ignored files', async () => {
    const { root, repo } = fixture()
    const sha = git(repo, 'rev-parse', 'HEAD')
    const target = path.join(root, 'managed', 'mode and unicode')
    const executable = path.join(repo, 'script.sh')
    fs.writeFileSync(executable, '#!/bin/sh\necho base\n', { mode: 0o644 })
    git(repo, 'add', 'script.sh')
    git(repo, 'commit', '-m', 'add script')
    git(repo, 'push')
    const scriptHead = git(repo, 'rev-parse', 'HEAD')
    fs.chmodSync(executable, 0o755)
    fs.mkdirSync(path.join(repo, 'nested', 'café'), { recursive: true })
    fs.writeFileSync(path.join(repo, 'nested', 'café', '雪.txt'), 'snow\n', { mode: 0o744 })
    fs.writeFileSync(path.join(repo, '.gitignore'), 'ignored.txt\n')
    fs.writeFileSync(path.join(repo, 'ignored.txt'), 'secret\n')

    const changes = await captureLocalChanges(repo, scriptHead)
    await createDetachedWorktree(repo, target, scriptHead, { localChanges: changes })

    expect(sha).not.toBe(scriptHead)
    expect(fs.statSync(path.join(target, 'script.sh')).mode & 0o777).toBe(0o755)
    expect(fs.statSync(path.join(target, 'nested', 'café', '雪.txt')).mode & 0o777).toBe(0o744)
    expect(fs.readFileSync(path.join(target, 'nested', 'café', '雪.txt'), 'utf8')).toBe('snow\n')
    expect(fs.existsSync(path.join(target, 'ignored.txt'))).toBe(false)
  })

  it('refuses untracked symlinks that could escape the source checkout', async () => {
    const { repo } = fixture()
    fs.symlinkSync('/tmp', path.join(repo, 'escape'))
    await expect(captureLocalChanges(repo, git(repo, 'rev-parse', 'HEAD'))).rejects.toThrow('symlink')

    const ignored = fixture().repo
    fs.writeFileSync(path.join(ignored, '.gitignore'), 'ignored-link\n')
    fs.symlinkSync('/tmp', path.join(ignored, 'ignored-link'))
    await expect(captureLocalChanges(ignored, git(ignored, 'rev-parse', 'HEAD'))).rejects.toThrow('symlink')
  })

  it('refuses conflicts, intent-to-add, sparse indexes, and unsupported index flags', async () => {
    const conflict = fixture().repo
    const base = git(conflict, 'rev-parse', 'HEAD')
    const blobA = execFileSync('git', ['hash-object', '-w', '--stdin'], { cwd: conflict, encoding: 'utf8', input: 'left\n' }).trim()
    const blobB = execFileSync('git', ['hash-object', '-w', '--stdin'], { cwd: conflict, encoding: 'utf8', input: 'right\n' }).trim()
    execFileSync('git', ['update-index', '--index-info'], {
      cwd: conflict,
      input: `100644 ${blobA} 2\ttracked.txt\n100644 ${blobB} 3\ttracked.txt\n`,
    })
    await expect(captureLocalChanges(conflict, base)).rejects.toThrow(/conflict|unmerged/i)

    const intent = fixture().repo
    fs.writeFileSync(path.join(intent, 'intent.txt'), 'intent\n')
    git(intent, 'add', '-N', 'intent.txt')
    await expect(captureLocalChanges(intent, git(intent, 'rev-parse', 'HEAD'))).rejects.toThrow(/intent-to-add/i)

    const sparse = fixture().repo
    git(sparse, 'config', 'core.sparseCheckout', 'true')
    await expect(captureLocalChanges(sparse, git(sparse, 'rev-parse', 'HEAD'))).rejects.toThrow(/sparse/i)

    const flagged = fixture().repo
    git(flagged, 'update-index', '--assume-unchanged', 'tracked.txt')
    await expect(captureLocalChanges(flagged, git(flagged, 'rev-parse', 'HEAD'))).rejects.toThrow(/index flag/i)
  })

  it('refuses populated submodules and unreadable or special untracked files', async () => {
    const { root, repo } = fixture()
    const child = path.join(root, 'child')
    fs.mkdirSync(child)
    git(child, 'init')
    git(child, 'config', 'user.name', 'Cranberri Test')
    git(child, 'config', 'user.email', 'test@cranberri.local')
    fs.writeFileSync(path.join(child, 'child.txt'), 'child\n')
    git(child, 'add', '.')
    git(child, 'commit', '-m', 'child')
    git(repo, '-c', 'protocol.file.allow=always', 'submodule', 'add', child, 'vendor/child')
    git(repo, 'commit', '-m', 'submodule')
    await expect(captureLocalChanges(repo, git(repo, 'rev-parse', 'HEAD'))).rejects.toThrow(/submodule/i)

    const unreadable = fixture().repo
    const unreadablePath = path.join(unreadable, 'unreadable.txt')
    fs.writeFileSync(unreadablePath, 'private\n', { mode: 0o000 })
    await expect(captureLocalChanges(unreadable, git(unreadable, 'rev-parse', 'HEAD'))).rejects.toThrow(/read/i)
    fs.chmodSync(unreadablePath, 0o600)

    const special = fixture().repo
    execFileSync('mkfifo', [path.join(special, 'pipe')])
    await expect(captureLocalChanges(special, git(special, 'rev-parse', 'HEAD'))).rejects.toThrow(/regular/i)
  })

  it('rejects unsafe paths before applying captured state', async () => {
    const { repo } = fixture()
    const sha = git(repo, 'rev-parse', 'HEAD')
    await expect(applyLocalChanges(repo, {
      baseSha: sha,
      stagedPatch: Buffer.alloc(0),
      unstagedPatch: Buffer.alloc(0),
      untrackedFiles: [{ relativePath: '.git/config', contents: Buffer.from('unsafe'), mode: 0o600 }],
    })).rejects.toThrow(/unsafe|metadata/i)
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
