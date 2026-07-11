import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => ({ userDataPath: '' }))
vi.mock('electron', () => ({ app: { getPath: () => electron.userDataPath }, dialog: { showOpenDialog: vi.fn() }, ipcMain: { handle: vi.fn() } }))
import { readProjectRegistry } from './repos'

const tempDirs: string[] = []
function git(cwd: string, ...args: string[]): string { return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim() }
beforeEach(() => { electron.userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'cranberri-projects-')); tempDirs.push(electron.userDataPath) })
afterEach(() => { for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }) })

describe('project registry migration', () => {
  it('migrates a legacy repo without changing its id', () => {
    const repoPath = path.join(electron.userDataPath, 'repo')
    fs.mkdirSync(repoPath); git(repoPath, 'init', '-b', 'main')
    fs.writeFileSync(path.join(electron.userDataPath, 'repos.json'), JSON.stringify({ repos: [{ id: 'legacy-project', name: 'Cranberri', path: repoPath }], activeRepoId: 'legacy-project' }))
    const registry = readProjectRegistry()
    expect(registry.activeProjectId).toBe('legacy-project')
    expect(registry.projects[0]).toMatchObject({ id: 'legacy-project', name: 'Cranberri', pinnedLocalBranch: 'main' })
    expect(registry.checkouts[0]).toMatchObject({ projectId: 'legacy-project', kind: 'local', canonicalPath: fs.realpathSync(repoPath) })
    expect(registry.projects[0].localCheckoutId).toBe(registry.checkouts[0].id)
  })

  it('recognizes a linked worktree through its canonical common directory', () => {
    const repoPath = path.join(electron.userDataPath, 'repo'); const linkedPath = path.join(electron.userDataPath, 'linked')
    fs.mkdirSync(repoPath); git(repoPath, 'init', '-b', 'main'); fs.writeFileSync(path.join(repoPath, 'file.txt'), 'one'); git(repoPath, 'add', '.'); git(repoPath, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'init'); git(repoPath, 'worktree', 'add', '-b', 'linked', linkedPath)
    fs.writeFileSync(path.join(electron.userDataPath, 'repos.json'), JSON.stringify({ repos: [{ id: 'linked-project', name: 'Linked', path: linkedPath }], activeRepoId: 'linked-project' }))
    const registry = readProjectRegistry(); const expectedCommonDir = fs.realpathSync(path.join(repoPath, '.git'))
    expect(registry.projects[0].gitCommonDir).toBe(expectedCommonDir); expect(registry.checkouts[0].gitCommonDir).toBe(expectedCommonDir)
  })

  it('fails closed and preserves corrupt source bytes', () => {
    const target = path.join(electron.userDataPath, 'repos.json'); const bytes = '{ definitely not json'; fs.writeFileSync(target, bytes)
    expect(() => readProjectRegistry()).toThrow(/project registry/i); expect(fs.readFileSync(target, 'utf8')).toBe(bytes)
  })
})
