import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const GIT_OUTPUT_LIMIT = 32 * 1024 * 1024
const LOCAL_COPY_LIMIT = 64 * 1024 * 1024

export interface GitRef {
  name: string
  fullName: string
  sha: string
  kind: 'local' | 'remote' | 'tag'
}

export interface RefRefreshResult {
  refreshedRemotes: string[]
  failedRemotes: string[]
  usedLocalFallback: boolean
}

export interface LocalChanges {
  baseSha: string
  stagedPatch: Buffer
  unstagedPatch: Buffer
  untrackedFiles: Array<{ relativePath: string; contents: Buffer; mode: number }>
}

export interface GitWorktreeEntry {
  path: string
  head: string | null
  branch: string | null
  detached: boolean
  locked: boolean
  prunable: boolean
}

interface GitResult {
  stdout: string
  stderr: string
}

async function runGit(cwd: string, args: string[], options: { encoding?: BufferEncoding | 'buffer' } = {}): Promise<GitResult | { stdout: Buffer; stderr: Buffer }> {
  const encoding = options.encoding === 'buffer' ? null : (options.encoding ?? 'utf8')
  const result = await execFileAsync('git', args, {
    cwd,
    encoding,
    maxBuffer: GIT_OUTPUT_LIMIT,
    env: { ...process.env, LC_ALL: 'C', GIT_TERMINAL_PROMPT: '0' },
  })
  return { stdout: result.stdout, stderr: result.stderr } as GitResult | { stdout: Buffer; stderr: Buffer }
}

async function gitText(cwd: string, args: string[]): Promise<string> {
  return ((await runGit(cwd, args)) as GitResult).stdout.trim()
}

async function gitBuffer(cwd: string, args: string[]): Promise<Buffer> {
  return ((await runGit(cwd, args, { encoding: 'buffer' })) as { stdout: Buffer }).stdout
}

export async function canonicalGitCommonDir(checkoutPath: string): Promise<string> {
  const commonDir = await gitText(checkoutPath, ['rev-parse', '--path-format=absolute', '--git-common-dir'])
  return fs.realpathSync(commonDir)
}

export async function refreshGitRefs(checkoutPath: string): Promise<RefRefreshResult> {
  const remotes = (await gitText(checkoutPath, ['remote'])).split('\n').filter(Boolean)
  const results = await Promise.all(remotes.map(async (remote) => {
    try {
      await runGit(checkoutPath, ['fetch', '--prune', remote])
      return { remote, ok: true }
    } catch {
      return { remote, ok: false }
    }
  }))
  const refreshedRemotes = results.filter((result) => result.ok).map((result) => result.remote)
  const failedRemotes = results.filter((result) => !result.ok).map((result) => result.remote)
  return { refreshedRemotes, failedRemotes, usedLocalFallback: failedRemotes.length > 0 }
}

export async function listSelectableRefs(checkoutPath: string): Promise<GitRef[]> {
  const output = await gitText(checkoutPath, [
    'for-each-ref',
    '--format=%(refname)',
    'refs/heads', 'refs/remotes', 'refs/tags',
  ])
  if (!output) return []
  const refs: GitRef[] = []
  for (const line of output.split('\n')) {
    const fullName = line
    if (!fullName || fullName.endsWith('/HEAD')) continue
    const kind = fullName.startsWith('refs/heads/') ? 'local'
      : fullName.startsWith('refs/remotes/') ? 'remote'
        : 'tag'
    const prefix = kind === 'local' ? 'refs/heads/' : kind === 'remote' ? 'refs/remotes/' : 'refs/tags/'
    try {
      const sha = await resolveGitRef(checkoutPath, fullName)
      refs.push({ name: fullName.slice(prefix.length), fullName, sha, kind })
    } catch {
      // Non-commit tags are intentionally not selectable.
    }
  }
  return refs.sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name))
}

export async function resolveGitRef(checkoutPath: string, ref: string): Promise<string> {
  if (!ref || ref.startsWith('-') || /[\0\n\r]/.test(ref)) throw new Error('Invalid Git ref')
  return gitText(checkoutPath, ['rev-parse', '--verify', `${ref}^{commit}`])
}

function parseNullList(output: Buffer): string[] {
  return output.toString('utf8').split('\0').filter(Boolean)
}

export async function captureLocalChanges(localPath: string, expectedHeadSha: string): Promise<LocalChanges> {
  const head = await resolveGitRef(localPath, 'HEAD')
  if (head !== expectedHeadSha) throw new Error('Include local changes requires the selected base to match Local HEAD')
  const [stagedPatch, unstagedPatch, untrackedOutput] = await Promise.all([
    gitBuffer(localPath, ['diff', '--binary', '--cached', expectedHeadSha]),
    gitBuffer(localPath, ['diff', '--binary']),
    gitBuffer(localPath, ['ls-files', '-z', '--others', '--exclude-standard']),
  ])
  const untrackedFiles: LocalChanges['untrackedFiles'] = []
  let totalBytes = stagedPatch.length + unstagedPatch.length
  for (const relativePath of parseNullList(untrackedOutput)) {
    const absolutePath = path.resolve(localPath, relativePath)
    const relative = path.relative(path.resolve(localPath), absolutePath)
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Untracked path escapes Local checkout')
    const stat = fs.lstatSync(absolutePath)
    if (stat.isSymbolicLink()) throw new Error(`Cannot include untracked symlink: ${relativePath}`)
    if (!stat.isFile()) throw new Error(`Cannot include non-regular untracked path: ${relativePath}`)
    totalBytes += stat.size
    if (totalBytes > LOCAL_COPY_LIMIT) throw new Error('Local changes exceed the safe copy limit')
    untrackedFiles.push({ relativePath, contents: fs.readFileSync(absolutePath), mode: stat.mode & 0o777 })
  }
  return { baseSha: expectedHeadSha, stagedPatch, unstagedPatch, untrackedFiles }
}

async function applyPatch(checkoutPath: string, patch: Buffer, staged: boolean): Promise<void> {
  if (patch.length === 0) return
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cranberri-patch-'))
  const patchPath = path.join(temporaryRoot, 'changes.patch')
  try {
    fs.writeFileSync(patchPath, patch, { mode: 0o600 })
    await runGit(checkoutPath, ['apply', '--binary', ...(staged ? ['--index'] : []), patchPath])
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true })
  }
}

export async function createDetachedWorktree(
  localPath: string,
  targetPath: string,
  sha: string,
  options: { localChanges?: LocalChanges } = {},
): Promise<void> {
  if (fs.existsSync(targetPath)) throw new Error('Managed worktree path already exists')
  fs.mkdirSync(path.dirname(targetPath), { recursive: true })
  await runGit(localPath, ['worktree', 'add', '--detach', targetPath, sha])
  try {
    const changes = options.localChanges
    if (!changes) return
    if (changes.baseSha !== sha) throw new Error('Local changes do not match the selected base SHA')
    await applyPatch(targetPath, changes.stagedPatch, true)
    await applyPatch(targetPath, changes.unstagedPatch, false)
    for (const file of changes.untrackedFiles) {
      const destination = path.resolve(targetPath, file.relativePath)
      const relative = path.relative(path.resolve(targetPath), destination)
      if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Untracked path escapes managed worktree')
      fs.mkdirSync(path.dirname(destination), { recursive: true })
      fs.writeFileSync(destination, file.contents, { mode: file.mode })
    }
  } catch (error) {
    try { await runGit(localPath, ['worktree', 'remove', targetPath]) } catch { /* retained for reconciliation */ }
    throw error
  }
}

export async function listGitWorktrees(checkoutPath: string): Promise<GitWorktreeEntry[]> {
  const output = await gitText(checkoutPath, ['worktree', 'list', '--porcelain', '-z'])
  if (!output) return []
  return output.split('\0\0').filter(Boolean).map((record) => {
    const values = new Map<string, string>()
    const flags = new Set<string>()
    for (const line of record.split('\0')) {
      const separator = line.indexOf(' ')
      if (separator === -1) flags.add(line)
      else values.set(line.slice(0, separator), line.slice(separator + 1))
    }
    return {
      path: values.get('worktree') ?? '',
      head: values.get('HEAD') ?? null,
      branch: values.get('branch')?.replace(/^refs\/heads\//, '') ?? null,
      detached: flags.has('detached'),
      locked: values.has('locked') || flags.has('locked'),
      prunable: values.has('prunable') || flags.has('prunable'),
    }
  }).filter((entry) => entry.path)
}

export async function gitStatusPorcelain(checkoutPath: string): Promise<string> {
  return gitText(checkoutPath, ['status', '--porcelain=v2', '--untracked-files=normal'])
}

export async function hasPublicCommitReference(checkoutPath: string, sha: string): Promise<boolean> {
  const output = await gitText(checkoutPath, [
    'for-each-ref',
    '--format=%(refname)',
    '--contains', sha,
    'refs/heads', 'refs/remotes', 'refs/tags',
  ])
  return output.split('\n').some((ref) => ref && !ref.startsWith('refs/cranberri/'))
}

export async function branchHasUnpushedCommits(checkoutPath: string, branch: string): Promise<boolean> {
  let upstream: string
  try {
    upstream = await gitText(checkoutPath, ['rev-parse', '--abbrev-ref', `${branch}@{upstream}`])
  } catch {
    return true
  }
  const ahead = await gitText(checkoutPath, ['rev-list', '--count', `${upstream}..${branch}`])
  return Number(ahead) > 0
}

export async function createPrivateTaskRef(checkoutPath: string, taskId: string, sha: string): Promise<string> {
  if (!/^[A-Za-z0-9._-]+$/.test(taskId)) throw new Error('Invalid task ID for private ref')
  const privateRef = `refs/cranberri/tasks/${taskId}`
  await runGit(checkoutPath, ['update-ref', privateRef, sha])
  return privateRef
}

export async function removeGitWorktree(localPath: string, worktreePath: string): Promise<void> {
  await runGit(localPath, ['worktree', 'remove', worktreePath])
}
