import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildRepoWatchEvent, closeRepoWatchSession, previewRepoFile, searchRepo, searchRepoFiles } from './search'

const tempDirs: string[] = []

function makeRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cranberri-search-'))
  tempDirs.push(dir)
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true })
  fs.mkdirSync(path.join(dir, '.git'), { recursive: true })
  fs.writeFileSync(path.join(dir, '.gitignore'), 'ignored.txt\n')
  fs.writeFileSync(path.join(dir, 'src', 'app.ts'), 'export const berry = "cranberri"\n')
  fs.writeFileSync(path.join(dir, 'src', 'CommandPalette.tsx'), 'export const commandPalette = true\n')
  fs.writeFileSync(path.join(dir, 'src', 'command-palette-helper.ts'), 'export const helper = true\n')
  fs.writeFileSync(path.join(dir, 'ignored.txt'), 'cranberri ignored\n')
  return dir
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { force: true, recursive: true })
  }
})

describe('searchRepo', () => {
  it('uses ripgrep with repo validation and respects ignore files', async () => {
    const repoPath = makeRepo()
    const result = await searchRepo(repoPath, { query: 'cranberri', maxResults: 20 }, [repoPath])

    expect(result.matches).toEqual([
      { path: 'src/app.ts', line: 1, column: 23, text: 'export const berry = "cranberri"' },
    ])
    expect(result.truncated).toBe(false)
  })

  it('refuses unregistered repo paths', async () => {
    const repoPath = makeRepo()
    await expect(searchRepo(repoPath, { query: 'cranberri' }, [])).rejects.toThrow('Repo is not registered')
  })

  it('truncates large result sets', async () => {
    const repoPath = makeRepo()
    fs.writeFileSync(path.join(repoPath, 'src', 'more.ts'), 'cranberri one\ncranberri two\n')

    const result = await searchRepo(repoPath, { query: 'cranberri', maxResults: 1 }, [repoPath])

    expect(result.matches).toHaveLength(1)
    expect(result.truncated).toBe(true)
  })
})

describe('searchRepoFiles', () => {
  it('ranks fuzzy filename matches while respecting ignored files', async () => {
    const repoPath = makeRepo()
    const result = await searchRepoFiles(repoPath, { query: 'commandpalette', maxResults: 10 }, [repoPath])

    expect(result.matches.map((match) => match.path)).toContain('src/CommandPalette.tsx')
    expect(result.matches.map((match) => match.path)).not.toContain('ignored.txt')
    expect(result.matches[0]).toMatchObject({
      path: 'src/CommandPalette.tsx',
      basename: 'CommandPalette.tsx',
      directory: 'src',
    })
    expect(result.truncated).toBe(false)
  })

  it('truncates large fuzzy filename result sets', async () => {
    const repoPath = makeRepo()
    fs.mkdirSync(path.join(repoPath, 'docs'), { recursive: true })
    fs.writeFileSync(path.join(repoPath, 'docs', 'command-notes.md'), '# commands\n')

    const result = await searchRepoFiles(repoPath, { query: 'command', maxResults: 1 }, [repoPath])

    expect(result.matches).toHaveLength(1)
    expect(result.truncated).toBe(true)
  })

  it('refuses unregistered repo paths', async () => {
    const repoPath = makeRepo()
    await expect(searchRepoFiles(repoPath, { query: 'command' }, [])).rejects.toThrow('Repo is not registered')
  })
})

describe('previewRepoFile', () => {
  it('previews bounded text files', async () => {
    const repoPath = makeRepo()
    const preview = await previewRepoFile(repoPath, 'src/app.ts', [repoPath], 12)

    expect(preview).toMatchObject({
      path: 'src/app.ts',
      text: 'export const',
      isBinary: false,
      truncated: true,
    })
  })

  it('does not return binary file content', async () => {
    const repoPath = makeRepo()
    fs.writeFileSync(path.join(repoPath, 'src', 'asset.bin'), Buffer.from([0, 159, 146, 150]))

    const preview = await previewRepoFile(repoPath, 'src/asset.bin', [repoPath])

    expect(preview.isBinary).toBe(true)
    expect(preview.text).toBe('')
  })

  it('refuses path traversal', async () => {
    const repoPath = makeRepo()
    await expect(previewRepoFile(repoPath, '../outside.txt', [repoPath])).rejects.toThrow('File path escapes repo')
  })
})

describe('buildRepoWatchEvent', () => {
  it('deduplicates watch events and preserves change metadata', () => {
    const event = buildRepoWatchEvent('/repo', [
      { type: 'change', path: 'src/app.ts' },
      { type: 'change', path: 'src/app.ts' },
      { type: 'unlink', path: 'src/old.ts' },
    ], false, 123)

    expect(event).toEqual({
      repoPath: '/repo',
      events: [
        { type: 'change', path: 'src/app.ts' },
        { type: 'unlink', path: 'src/old.ts' },
      ],
      truncated: false,
      changedAt: 123,
    })
  })

  it('bounds large watch event bursts', () => {
    const pending = Array.from({ length: 250 }, (_, index) => ({ type: 'add' as const, path: `src/${index}.ts` }))
    const event = buildRepoWatchEvent('/repo', pending, false, 123)

    expect(event.events).toHaveLength(200)
    expect(event.truncated).toBe(true)
  })
})

describe('closeRepoWatchSession', () => {
  it('starts watcher close without waiting for native filesystem teardown', () => {
    const close = vi.fn(() => new Promise<void>(() => {}))
    const timer = setTimeout(() => {}, 1000)
    const session = {
      watcher: { close },
      pending: [{ type: 'change' as const, path: 'src/app.ts' }],
      timer,
      truncated: true,
    }

    closeRepoWatchSession('/repo', session)

    expect(close).toHaveBeenCalledTimes(1)
    expect(session.timer).toBeNull()
    expect(session.pending).toEqual([])
    expect(session.truncated).toBe(false)
  })

  it('reports asynchronous watcher close failures', async () => {
    const error = new Error('fsevents close failed')
    const warn = vi.fn()

    closeRepoWatchSession('/repo', {
      watcher: { close: () => Promise.reject(error) },
      pending: [],
      timer: null,
      truncated: false,
    }, warn)

    await Promise.resolve()

    expect(warn).toHaveBeenCalledWith('[search] failed to close repo watcher for /repo:', error)
  })
})
