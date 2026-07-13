import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import {
  MAX_WORKTREE_SNAPSHOT_BYTES,
  assertSnapshotRelativePath,
  type SnapshotLocalChanges,
} from '../shared/worktree-snapshots'

const execFileAsync = promisify(execFile)
const GIT_OUTPUT_LIMIT = MAX_WORKTREE_SNAPSHOT_BYTES + (1024 * 1024)
const LOCAL_COPY_LIMIT = MAX_WORKTREE_SNAPSHOT_BYTES

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

export type LocalChanges = SnapshotLocalChanges

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

interface IndexEntry {
  mode: string
  objectId: string
  stage: number
  relativePath: string
}

function parseIndexEntries(output: Buffer): IndexEntry[] {
  return parseNullList(output).map((entry) => {
    const tab = entry.indexOf('\t')
    const metadata = entry.slice(0, tab).split(' ')
    if (tab < 0 || metadata.length !== 3) throw new Error('Cannot inspect Git index state safely')
    return {
      mode: metadata[0],
      objectId: metadata[1],
      stage: Number(metadata[2]),
      relativePath: entry.slice(tab + 1),
    }
  })
}

function isPopulatedDirectory(candidate: string): boolean {
  if (!fs.existsSync(candidate)) return false
  const stat = fs.lstatSync(candidate)
  return !stat.isDirectory() || fs.readdirSync(candidate).length > 0
}

async function assertCapturableIndex(checkoutPath: string): Promise<void> {
  try {
    if (await gitText(checkoutPath, ['config', '--bool', 'core.sparseCheckout']) === 'true') {
      throw new Error('Sparse checkouts cannot be snapshotted safely')
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('Sparse checkouts')) throw error
  }

  const entries = parseIndexEntries(await gitBuffer(checkoutPath, ['ls-files', '--stage', '-z']))
  for (const entry of entries) {
    assertSnapshotRelativePath(entry.relativePath)
    if (entry.stage !== 0) throw new Error(`Cannot snapshot an unmerged index conflict: ${entry.relativePath}`)
    if (/^0+$/.test(entry.objectId)) throw new Error(`Cannot snapshot intent-to-add index state: ${entry.relativePath}`)
    if (entry.mode === '120000') throw new Error(`Cannot snapshot tracked symlink: ${entry.relativePath}`)
    if (!['100644', '100755', '160000'].includes(entry.mode)) {
      throw new Error(`Cannot snapshot unsupported index file type: ${entry.relativePath}`)
    }
    if (entry.mode === '160000' && isPopulatedDirectory(path.resolve(checkoutPath, entry.relativePath))) {
      throw new Error(`Cannot snapshot populated submodule: ${entry.relativePath}`)
    }
  }

  const debugIndex = await gitBuffer(checkoutPath, ['ls-files', '--debug', '-z'])
  const flags = [...debugIndex.toString('utf8').matchAll(/\bflags: ([0-9a-fA-F]+)/g)]
  for (const match of flags) {
    const value = BigInt(`0x${match[1]}`)
    if (value === 0n) continue
    if ((value & 0x20000000n) !== 0n) throw new Error('Cannot snapshot intent-to-add index state')
    throw new Error('Cannot snapshot unsupported Git index flags')
  }
}

async function assertSupportedWorkingTreeTypes(checkoutPath: string): Promise<void> {
  const ignoredEntries = parseNullList(await gitBuffer(checkoutPath, [
    'ls-files', '--others', '--ignored', '--exclude-standard', '--directory', '-z',
  ]))
  const ignoredFiles = new Set(ignoredEntries.filter((entry) => !entry.endsWith('/')))
  const ignoredDirectories = ignoredEntries.filter((entry) => entry.endsWith('/'))
  const root = path.resolve(checkoutPath)

  const visit = (directory: string, prefix: string): void => {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true })
    } catch (error) {
      throw new Error(`Cannot read worktree directory: ${prefix || '.'}`, { cause: error })
    }
    for (const entry of entries) {
      if (!prefix && entry.name === '.git') continue
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name
      assertSnapshotRelativePath(relativePath)
      const candidate = path.join(root, ...relativePath.split('/'))
      const stat = fs.lstatSync(candidate)
      const ignored = ignoredFiles.has(relativePath)
        || ignoredDirectories.some((entry) => relativePath === entry.slice(0, -1) || relativePath.startsWith(entry))
      if (stat.isSymbolicLink()) {
        throw new Error(`Cannot snapshot symlink: ${relativePath}`)
      } else if (!stat.isFile() && !stat.isDirectory()) {
        throw new Error(`Cannot snapshot non-regular path: ${relativePath}`)
      } else if (stat.isDirectory() && !ignored) {
        visit(candidate, relativePath)
      }
    }
  }

  visit(root, '')
}

function readRegularUntrackedFile(absolutePath: string, relativePath: string): { contents: Buffer; mode: number } {
  let descriptor: number | undefined
  try {
    const before = fs.lstatSync(absolutePath)
    if (before.isSymbolicLink()) throw new Error(`Cannot include untracked symlink: ${relativePath}`)
    if (!before.isFile()) throw new Error(`Cannot include non-regular untracked path: ${relativePath}`)
    if ((before.mode & 0o444) === 0) throw new Error(`Cannot read untracked file: ${relativePath}`)
    descriptor = fs.openSync(absolutePath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW)
    const opened = fs.fstatSync(descriptor)
    if (!opened.isFile()) throw new Error(`Cannot include non-regular untracked path: ${relativePath}`)
    const contents = fs.readFileSync(descriptor)
    const after = fs.fstatSync(descriptor)
    if (opened.dev !== after.dev || opened.ino !== after.ino || opened.size !== after.size
      || opened.mtimeMs !== after.mtimeMs || contents.length !== after.size) {
      throw new Error(`Untracked file changed during snapshot capture: ${relativePath}`)
    }
    return { contents, mode: opened.mode & 0o777 }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Cannot ')) throw error
    throw new Error(`Cannot read untracked file: ${relativePath}`, { cause: error })
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor)
  }
}

export async function captureLocalChanges(localPath: string, expectedHeadSha: string): Promise<LocalChanges> {
  const head = await resolveGitRef(localPath, 'HEAD')
  if (head !== expectedHeadSha) throw new Error('Include local changes requires the selected base to match Local HEAD')
  await assertCapturableIndex(localPath)
  await assertSupportedWorkingTreeTypes(localPath)
  const [stagedPatch, unstagedPatch, untrackedOutput] = await Promise.all([
    gitBuffer(localPath, ['diff', '--binary', '--cached', expectedHeadSha]),
    gitBuffer(localPath, ['diff', '--binary']),
    gitBuffer(localPath, ['ls-files', '-z', '--others', '--exclude-standard']),
  ])
  const untrackedFiles: LocalChanges['untrackedFiles'] = []
  let totalBytes = stagedPatch.length + unstagedPatch.length
  for (const relativePath of parseNullList(untrackedOutput)) {
    assertSnapshotRelativePath(relativePath)
    const absolutePath = path.resolve(localPath, relativePath)
    const relative = path.relative(path.resolve(localPath), absolutePath)
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Untracked path escapes Local checkout')
    const file = readRegularUntrackedFile(absolutePath, relativePath)
    totalBytes += file.contents.length
    if (totalBytes > LOCAL_COPY_LIMIT) throw new Error('Local changes exceed the safe copy limit')
    untrackedFiles.push({ relativePath, ...file })
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

export async function applyLocalChanges(checkoutPath: string, changes: LocalChanges): Promise<void> {
  const head = await resolveGitRef(checkoutPath, 'HEAD')
  if (head !== changes.baseSha) throw new Error('Transfer bundle does not match checkout HEAD')
  const paths = new Set<string>()
  for (const file of changes.untrackedFiles) {
    assertSnapshotRelativePath(file.relativePath)
    if (!Number.isInteger(file.mode) || file.mode < 0 || file.mode > 0o777) throw new Error(`Invalid untracked file mode: ${file.relativePath}`)
    if (paths.has(file.relativePath)) throw new Error(`Duplicate untracked file path: ${file.relativePath}`)
    paths.add(file.relativePath)
  }
  await applyPatch(checkoutPath, changes.stagedPatch, true)
  await applyPatch(checkoutPath, changes.unstagedPatch, false)
  for (const file of changes.untrackedFiles) {
    const destination = path.resolve(checkoutPath, file.relativePath)
    const relative = path.relative(path.resolve(checkoutPath), destination)
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Untracked path escapes checkout')
    if (fs.existsSync(destination)) throw new Error(`Transfer would overwrite untracked file: ${file.relativePath}`)
    fs.mkdirSync(path.dirname(destination), { recursive: true })
    fs.writeFileSync(destination, file.contents, { mode: file.mode })
    fs.chmodSync(destination, file.mode)
  }
}

export async function clearTransferredChanges(checkoutPath: string, changes: LocalChanges): Promise<void> {
  await runGit(checkoutPath, ['reset', '--hard', changes.baseSha])
  for (const file of changes.untrackedFiles) {
    const candidate = path.resolve(checkoutPath, file.relativePath)
    const relative = path.relative(path.resolve(checkoutPath), candidate)
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Untracked path escapes checkout')
    if (!fs.existsSync(candidate)) continue
    const stat = fs.lstatSync(candidate)
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Refusing to remove changed path: ${file.relativePath}`)
    if (!fs.readFileSync(candidate).equals(file.contents)) throw new Error(`Transferred file changed during handoff: ${file.relativePath}`)
    fs.rmSync(candidate)
  }
}

export async function checkoutBranch(checkoutPath: string, branch: string, createAt?: string): Promise<void> {
  if (!branch || branch.startsWith('-') || /[\0\n\r]/.test(branch)) throw new Error('Invalid branch name')
  if (createAt) await runGit(checkoutPath, ['switch', '-c', branch, createAt])
  else await runGit(checkoutPath, ['switch', branch])
}

export async function detachCheckout(checkoutPath: string, expectedSha: string): Promise<void> {
  const head = await resolveGitRef(checkoutPath, 'HEAD')
  if (head !== expectedSha) throw new Error('Checkout HEAD changed during handoff')
  await runGit(checkoutPath, ['switch', '--detach', expectedSha])
}

export async function branchExists(checkoutPath: string, branch: string): Promise<boolean> {
  try {
    await resolveGitRef(checkoutPath, `refs/heads/${branch}`)
    return true
  } catch {
    return false
  }
}

export async function createBranch(checkoutPath: string, branch: string, sha: string): Promise<void> {
  if (await branchExists(checkoutPath, branch)) throw new Error('Branch already exists')
  await runGit(checkoutPath, ['branch', branch, sha])
}

export async function branchCheckoutPath(checkoutPath: string, branch: string): Promise<string | null> {
  const entry = (await listGitWorktrees(checkoutPath)).find((item) => item.branch === branch)
  return entry?.path ?? null
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
    await applyLocalChanges(targetPath, changes)
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

export async function hasDurablePublicCommitReference(checkoutPath: string, sha: string): Promise<boolean> {
  const output = await gitText(checkoutPath, [
    'for-each-ref',
    '--format=%(refname)',
    '--contains', sha,
    'refs/remotes',
  ])
  return output.split('\n').some(Boolean)
}

function assertPrivateTaskRef(privateRef: string): void {
  if (!/^refs\/cranberri\/tasks\/[A-Za-z0-9._-]+$/.test(privateRef)) throw new Error('Invalid private task ref')
}

function flushFile(filePath: string): void {
  const descriptor = fs.openSync(filePath, fs.constants.O_RDONLY)
  try {
    fs.fsyncSync(descriptor)
  } finally {
    fs.closeSync(descriptor)
  }
}

async function withTemporaryBundle<T>(contents: Buffer, callback: (bundlePath: string) => Promise<T>): Promise<T> {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cranberri-git-bundle-'))
  const bundlePath = path.join(temporaryRoot, 'head.bundle')
  try {
    fs.writeFileSync(bundlePath, contents, { mode: 0o600 })
    fs.chmodSync(bundlePath, 0o600)
    flushFile(bundlePath)
    return await callback(bundlePath)
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true })
  }
}

async function assertGitBundle(checkoutPath: string, bundlePath: string, privateRef: string, expectedSha: string): Promise<void> {
  assertPrivateTaskRef(privateRef)
  await runGit(checkoutPath, ['bundle', 'verify', bundlePath])
  const heads = await gitText(checkoutPath, ['bundle', 'list-heads', bundlePath, privateRef])
  const [sha, ref, extra] = heads.split(/\s+/)
  if (sha !== expectedSha || ref !== privateRef || extra) throw new Error('Git bundle does not contain the expected private ref')
}

export async function createGitHeadArchive(
  checkoutPath: string,
  privateRef: string,
  expectedSha: string,
  maximumBytes = LOCAL_COPY_LIMIT,
): Promise<Buffer> {
  assertPrivateTaskRef(privateRef)
  if (await resolveGitRef(checkoutPath, privateRef) !== expectedSha) throw new Error('Private ref does not match archived HEAD')
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cranberri-git-bundle-'))
  const bundlePath = path.join(temporaryRoot, 'head.bundle')
  try {
    await runGit(checkoutPath, ['bundle', 'create', bundlePath, privateRef])
    fs.chmodSync(bundlePath, 0o600)
    flushFile(bundlePath)
    const stat = fs.statSync(bundlePath)
    if (stat.size > maximumBytes) throw new Error('Git bundle exceeds the snapshot size limit')
    await assertGitBundle(checkoutPath, bundlePath, privateRef, expectedSha)
    return fs.readFileSync(bundlePath)
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true })
  }
}

export async function verifyGitHeadArchive(
  checkoutPath: string,
  contents: Buffer,
  privateRef: string,
  expectedSha: string,
): Promise<void> {
  await withTemporaryBundle(contents, (bundlePath) => assertGitBundle(checkoutPath, bundlePath, privateRef, expectedSha))
}

export async function importGitHeadArchive(
  checkoutPath: string,
  contents: Buffer,
  privateRef: string,
  expectedSha: string,
): Promise<void> {
  await withTemporaryBundle(contents, async (bundlePath) => {
    await assertGitBundle(checkoutPath, bundlePath, privateRef, expectedSha)
    try {
      const current = await resolveGitRef(checkoutPath, privateRef)
      if (current !== expectedSha) throw new Error('Existing private ref does not match snapshot HEAD')
    } catch (error) {
      if (error instanceof Error && error.message.includes('does not match')) throw error
      await runGit(checkoutPath, ['fetch', bundlePath, `${privateRef}:${privateRef}`])
    }
    if (await resolveGitRef(checkoutPath, privateRef) !== expectedSha) throw new Error('Imported Git bundle does not match snapshot HEAD')
  })
}

export function localChangesEqual(left: LocalChanges, right: LocalChanges): boolean {
  return left.baseSha === right.baseSha
    && left.stagedPatch.equals(right.stagedPatch)
    && left.unstagedPatch.equals(right.unstagedPatch)
    && left.untrackedFiles.length === right.untrackedFiles.length
    && left.untrackedFiles.every((file, index) => {
      const other = right.untrackedFiles[index]
      return other !== undefined
        && file.relativePath === other.relativePath
        && file.mode === other.mode
        && file.contents.equals(other.contents)
    })
}

export async function verifyLocalChangesRoundTrip(repositoryPath: string, changes: LocalChanges): Promise<void> {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cranberri-snapshot-validation-'))
  const validationPath = path.join(temporaryRoot, 'checkout')
  let registered = false
  try {
    await createDetachedWorktree(repositoryPath, validationPath, changes.baseSha)
    registered = true
    await applyLocalChanges(validationPath, changes)
    const reconstructed = await captureLocalChanges(validationPath, changes.baseSha)
    if (!localChangesEqual(changes, reconstructed)) throw new Error('Snapshot validation checkout does not match captured state')
  } finally {
    if (registered) {
      await clearTransferredChanges(validationPath, changes)
      await removeGitWorktree(repositoryPath, validationPath)
    }
    if (!fs.existsSync(validationPath)) fs.rmSync(temporaryRoot, { recursive: true, force: true })
  }
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
