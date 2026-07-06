import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveRepoFilePath, validateRepoPath } from './repoSecurity'

const knownRepos = ['/tmp/cranberri-safe/repo', '/tmp/cranberri-other/repo'].map((repoPath) => path.resolve(repoPath))

describe('repo IPC security guards', () => {
  it('allows only repo paths from the saved repo registry', () => {
    expect(validateRepoPath('/tmp/cranberri-safe/repo', knownRepos)).toBe(path.resolve('/tmp/cranberri-safe/repo'))
    expect(() => validateRepoPath(os.homedir(), knownRepos)).toThrow('Repo is not registered')
  })

  it('rejects repo path aliases that resolve outside the saved registry entries', () => {
    expect(() => validateRepoPath('/tmp/cranberri-safe/repo/..', knownRepos)).toThrow('Repo is not registered')
  })

  it('resolves relative repo file paths inside the repo root', () => {
    expect(resolveRepoFilePath('/tmp/cranberri-safe/repo', 'src/main.ts')).toBe(path.resolve('/tmp/cranberri-safe/repo/src/main.ts'))
  })

  it('rejects absolute and traversal file paths before the renderer can read arbitrary local files', () => {
    expect(() => resolveRepoFilePath('/tmp/cranberri-safe/repo', '/etc/passwd')).toThrow('File path must be relative')
    expect(() => resolveRepoFilePath('/tmp/cranberri-safe/repo', '../secrets.txt')).toThrow('File path escapes repo')
    expect(() => resolveRepoFilePath('/tmp/cranberri-safe/repo', 'src/../../secrets.txt')).toThrow('File path escapes repo')
  })
})
