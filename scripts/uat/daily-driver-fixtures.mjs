import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const FIXTURE_PREFIX = 'cranberri-daily-driver-uat-'
const ROOT_MARKER = '.cranberri-uat-root.json'
const FIXED_GIT_DATE = '2026-01-01T00:00:00Z'

function git(cwd, args, options = {}) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_DATE: FIXED_GIT_DATE,
      GIT_COMMITTER_DATE: FIXED_GIT_DATE,
    },
    ...options,
  }).trim()
}

function writeFile(filePath, contents) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, contents)
}

function commitAll(repoPath, message) {
  git(repoPath, ['add', '.'])
  git(repoPath, [
    '-c', 'user.name=Cranberri UAT',
    '-c', 'user.email=uat@example.invalid',
    'commit', '--quiet', '-m', message,
  ])
  return git(repoPath, ['rev-parse', 'HEAD'])
}

function realTempRoot() {
  return fs.realpathSync(os.tmpdir())
}

function assertTempBase(tempRoot) {
  const resolved = fs.realpathSync(tempRoot)
  const temp = realTempRoot()
  if (resolved !== temp && !resolved.startsWith(`${temp}${path.sep}`)) {
    throw new Error(`Daily-driver fixtures must be created under the OS temp root: ${temp}`)
  }
  return resolved
}

function assertGuardedUatRoot(root, expectedKind) {
  const resolved = fs.realpathSync(root)
  const temp = realTempRoot()
  if (!resolved.startsWith(`${temp}${path.sep}`)) {
    throw new Error(`Refusing to clean a path outside the OS temp root: ${resolved}`)
  }
  const markerPath = path.join(resolved, ROOT_MARKER)
  if (!fs.existsSync(markerPath)) throw new Error(`Refusing to clean an unmarked UAT root: ${resolved}`)
  const marker = JSON.parse(fs.readFileSync(markerPath, 'utf8'))
  if (marker.kind !== expectedKind || marker.root !== resolved) {
    throw new Error(`Refusing to clean a UAT root with an invalid marker: ${resolved}`)
  }
  return resolved
}

function stableFixtureSha(descriptor) {
  return createHash('sha256').update(JSON.stringify(descriptor)).digest('hex')
}

export function createDailyDriverFixtures(options = {}) {
  const tempBase = assertTempBase(options.tempRoot ?? os.tmpdir())
  const root = fs.mkdtempSync(path.join(tempBase, FIXTURE_PREFIX))
  fs.writeFileSync(path.join(root, ROOT_MARKER), JSON.stringify({
    kind: 'daily-driver-fixtures',
    root,
  }, null, 2))

  try {
    const localRepoPath = path.join(root, 'repos', 'daily-driver-local')
    const worktreePath = path.join(root, 'worktrees', 'daily-driver-worktree')
    const handoffPath = path.join(root, 'worktrees', 'daily-driver-handoff')
    const dirtyPath = path.join(root, 'worktrees', 'daily-driver-dirty')
    const notGitPath = path.join(root, 'errors', 'not-a-git-repository')
    const missingCheckoutPath = path.join(root, 'errors', 'missing-checkout')
    const userDataPath = path.join(root, 'user-data')

    fs.mkdirSync(localRepoPath, { recursive: true })
    git(localRepoPath, ['init', '--quiet', '-b', 'main'])
    git(localRepoPath, ['remote', 'add', 'origin', 'https://github.com/example/cranberri-daily-driver-fixture.git'])
    writeFile(path.join(localRepoPath, 'README.md'), [
      '# Cranberri daily-driver fixture',
      '',
      'Synthetic content for installed-release UAT. No user repository data is included.',
      '',
    ].join('\n'))
    writeFile(path.join(localRepoPath, 'src', 'fixture.ts'), [
      "export const fixtureMarker = 'CRANBERRI_DAILY_DRIVER_UAT'",
      '',
    ].join('\n'))
    writeFile(path.join(localRepoPath, 'docs', 'fixture-notes.md'), '# Fixture notes\n\nStable baseline content.\n')
    const baseSha = commitAll(localRepoPath, 'chore: seed daily-driver fixture')

    fs.mkdirSync(path.dirname(worktreePath), { recursive: true })
    git(localRepoPath, ['worktree', 'add', '--quiet', '-b', 'uat/worktree', worktreePath, 'main'])
    writeFile(path.join(worktreePath, 'worktree-change.txt'), 'Synthetic managed worktree change.\n')
    const worktreeSha = commitAll(worktreePath, 'feat: add worktree fixture change')

    git(localRepoPath, ['worktree', 'add', '--quiet', '-b', 'uat/handoff', handoffPath, 'main'])
    writeFile(path.join(handoffPath, 'handoff-change.txt'), 'Synthetic unique commit for local handoff.\n')
    const handoffSha = commitAll(handoffPath, 'feat: add handoff fixture change')

    git(localRepoPath, ['worktree', 'add', '--quiet', '-b', 'uat/dirty', dirtyPath, 'main'])
    writeFile(path.join(dirtyPath, 'dirty-tracked.txt'), 'Committed version.\n')
    commitAll(dirtyPath, 'chore: seed dirty-state fixture')
    writeFile(path.join(dirtyPath, 'dirty-tracked.txt'), 'Uncommitted tracked change.\n')
    writeFile(path.join(dirtyPath, 'dirty-untracked.txt'), 'Untracked fixture change.\n')

    fs.mkdirSync(notGitPath, { recursive: true })
    writeFile(path.join(notGitPath, 'README.txt'), 'This directory intentionally has no .git metadata.\n')
    fs.mkdirSync(userDataPath, { recursive: true })
    fs.writeFileSync(path.join(userDataPath, 'repos.json'), JSON.stringify({
      repos: [{
        id: 'daily-driver-fixture-project',
        name: 'Cranberri Daily Driver Fixture',
        path: localRepoPath,
      }],
      activeRepoId: 'daily-driver-fixture-project',
    }, null, 2))

    const descriptor = {
      schemaVersion: 1,
      gitDate: FIXED_GIT_DATE,
      baseSha,
      cases: {
        local: { branch: 'main', headSha: baseSha },
        worktree: { branch: 'uat/worktree', headSha: worktreeSha },
        handoff: { branch: 'uat/handoff', headSha: handoffSha, uniqueCommits: 1 },
        dirty: {
          branch: 'uat/dirty',
          status: git(dirtyPath, ['status', '--porcelain']).split('\n').filter(Boolean).sort(),
        },
        error: { missingCheckout: true, notGitDirectory: true },
      },
    }
    const fixtureSha = stableFixtureSha(descriptor)
    const cases = {
      local: { repoPath: localRepoPath, branch: 'main', headSha: baseSha },
      worktree: { repoPath: worktreePath, branch: 'uat/worktree', headSha: worktreeSha },
      handoff: {
        repoPath: handoffPath,
        branch: 'uat/handoff',
        baseSha,
        headSha: handoffSha,
        uniqueCommits: 1,
      },
      dirty: {
        repoPath: dirtyPath,
        branch: 'uat/dirty',
        status: descriptor.cases.dirty.status,
      },
      error: { missingCheckoutPath, notGitPath },
    }
    const manifestPath = path.join(root, 'fixture-manifest.json')
    fs.writeFileSync(manifestPath, JSON.stringify({
      schemaVersion: 1,
      fixtureSha,
      root,
      userDataPath,
      manifestPath,
      cases,
    }, null, 2))

    return { schemaVersion: 1, fixtureSha, root, userDataPath, manifestPath, cases }
  } catch (error) {
    trashDailyDriverFixtures(root)
    throw error
  }
}

export function trashDailyDriverFixtures(root, options = {}) {
  const guardedRoot = assertGuardedUatRoot(root, 'daily-driver-fixtures')
  const execFile = options.execFile ?? execFileSync
  execFile('/usr/bin/trash', [guardedRoot], { encoding: 'utf8' })
}

function readOption(args, name) {
  const index = args.indexOf(name)
  if (index === -1) return undefined
  if (!args[index + 1]) throw new Error(`Missing value for ${name}`)
  return args[index + 1]
}

function runCli() {
  const [command = 'create', ...args] = process.argv.slice(2)
  if (command === 'create') {
    const fixture = createDailyDriverFixtures({ tempRoot: readOption(args, '--temp-root') })
    process.stdout.write(`${JSON.stringify(fixture, null, 2)}\n`)
    return
  }
  if (command === 'cleanup') {
    const root = readOption(args, '--root')
    if (!root) throw new Error('cleanup requires --root <fixture-root>')
    trashDailyDriverFixtures(root)
    process.stdout.write(`Moved fixture root to Trash: ${root}\n`)
    return
  }
  throw new Error(`Unknown fixture command: ${command}`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) runCli()

