import simpleGit from 'simple-git'
import { ipcMain } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import type { GitHubRepoSummary } from '@/shared/git'

const fileStatusSchema = z.object({
  path: z.string(),
  status: z.enum(['added', 'modified', 'deleted', 'renamed', 'untracked', 'conflict', 'staged', 'tracked']),
})

export type GitStatus = z.infer<typeof fileStatusSchema>
export type GitFileStatus = GitStatus

export interface FileTreeNode {
  path: string
  type: 'file' | 'dir'
  children: FileTreeNode[]
}

const diffSchema = z.object({
  files: z.array(z.object({
    from: z.string().optional(),
    to: z.string(),
    additions: z.number(),
    deletions: z.number(),
    chunks: z.array(z.object({
      oldStart: z.number(),
      oldLines: z.number(),
      newStart: z.number(),
      newLines: z.number(),
      changes: z.array(z.object({
        type: z.enum(['add', 'del', 'normal']),
        addLine: z.number().optional(),
        delLine: z.number().optional(),
        line: z.string(),
        ln1: z.number().optional(),
        ln2: z.number().optional(),
      })),
    })),
  })),
})

function githubWebUrl(remoteUrl: string | undefined): Pick<GitHubRepoSummary, 'webUrl' | 'owner' | 'repo' | 'isGitHub'> {
  if (!remoteUrl) return { webUrl: null, owner: null, repo: null, isGitHub: false }
  const match = remoteUrl.trim().match(/github\.com[:/]([^/]+)\/([^/.]+)(?:\.git)?$/)
  if (!match) return { webUrl: null, owner: null, repo: null, isGitHub: false }
  const [, owner, repo] = match
  return { webUrl: `https://github.com/${owner}/${repo}`, owner, repo, isGitHub: true }
}

export type Diff = z.infer<typeof diffSchema>
export type DiffResult = Diff

export function initGitIpc(): void {
  ipcMain.handle('git:status', async (_, repoPath: string) => {
    const git = simpleGit(repoPath)
    const status = await git.status()

    const files: GitFileStatus[] = []
    const add = (path: string, status: GitFileStatus['status']) => {
      if (!files.some((f) => f.path === path)) files.push({ path, status })
    }

    for (const path of status.created) add(path, 'added')
    for (const path of status.modified) add(path, 'modified')
    for (const path of status.deleted) add(path, 'deleted')
    for (const path of status.renamed.map((r) => r.to)) add(path, 'renamed')
    for (const path of status.not_added) add(path, 'untracked')
    for (const path of status.conflicted) add(path, 'conflict')
    for (const path of status.staged) {
      if (!files.some((f) => f.path === path)) add(path, 'staged')
    }

    return fileStatusSchema.array().parse(files)
  })

  ipcMain.handle('git:files', async (_, repoPath: string) => {
    const git = simpleGit(repoPath)
    const tracked = await git.raw(['ls-files'])
    const untracked = await git.raw(['ls-files', '--others', '--exclude-standard'])
    const all = new Set([
      ...tracked.split('\n').filter(Boolean),
      ...untracked.split('\n').filter(Boolean),
    ])

    const buildTree = (paths: string[]): FileTreeNode[] => {
      const root: FileTreeNode[] = []
      const dirs = new Map<string, FileTreeNode>()

      const getDir = (path: string) => {
        if (dirs.has(path)) return dirs.get(path)!
        const node: FileTreeNode = { path, type: 'dir', children: [] }
        dirs.set(path, node)
        return node
      }

      for (const fullPath of paths) {
        const parts = fullPath.split('/')
        let dirPath = ''
        for (let i = 0; i < parts.length - 1; i++) {
          dirPath = dirPath ? `${dirPath}/${parts[i]}` : parts[i]
          const parent = dirPath.includes('/') ? getDir(dirPath.slice(0, dirPath.lastIndexOf('/'))) : null
          const dir = getDir(dirPath)
          if (parent && !parent.children.includes(dir)) parent.children.push(dir)
          else if (!parent && !root.includes(dir)) root.push(dir)
        }
        const file: FileTreeNode = { path: fullPath, type: 'file', children: [] }
        const parentPath = parts.length > 1 ? parts.slice(0, -1).join('/') : ''
        if (parentPath) {
          getDir(parentPath).children.push(file)
        } else {
          root.push(file)
        }
      }

      return root
    }

    return buildTree([...all])
  })

  ipcMain.handle('git:diff', async (_, repoPath: string) => {
    const git = simpleGit(repoPath)
    const raw = await git.diff()
    return parseGitDiff(raw)
  })

  ipcMain.handle('git:diff-file', async (_, repoPath: string, filePath: string) => {
    const git = simpleGit(repoPath)
    const raw = await git.diff(['--', filePath])
    return parseGitDiff(raw)
  })

  ipcMain.handle('git:raw-content', async (_, repoPath: string, filePath: string, ref: 'HEAD' | 'WORKING') => {
    const git = simpleGit(repoPath)
    if (ref === 'WORKING') {
      return fs.promises.readFile(path.join(repoPath, filePath), 'utf8').catch(() => '')
    }
    return git.show(['HEAD:' + filePath]).catch(() => '')
  })

  ipcMain.handle('git:github-summary', async (_, repoPath: string): Promise<GitHubRepoSummary> => {
    const git = simpleGit(repoPath)
    const [remotes, status] = await Promise.all([
      git.getRemotes(true),
      git.status(),
    ])
    const origin = remotes.find((remote) => remote.name === 'origin') ?? remotes[0]
    const remoteUrl = origin?.refs?.push || origin?.refs?.fetch || null
    const parsed = githubWebUrl(remoteUrl ?? undefined)
    return {
      remoteUrl,
      webUrl: parsed.webUrl,
      owner: parsed.owner,
      repo: parsed.repo,
      branch: status.current || null,
      tracking: status.tracking || null,
      ahead: status.ahead,
      behind: status.behind,
      isGitHub: parsed.isGitHub,
    }
  })
}

async function parseGitDiff(raw: string): Promise<DiffResult> {
  if (!raw) return { files: [] }

  // parse-diff is CJS; dynamic import works in electron main
  const { default: parseDiff } = await import('parse-diff')
  const files = parseDiff(raw)

  return diffSchema.parse({
    files: files.map((f) => ({
      from: f.from,
      to: f.to,
      additions: f.additions,
      deletions: f.deletions,
      chunks: f.chunks.map((c) => ({
        oldStart: c.oldStart,
        oldLines: c.oldLines,
        newStart: c.newStart,
        newLines: c.newLines,
        changes: c.changes.map((change) => {
          if (change.type === 'add') {
            return { type: 'add', addLine: change.ln, line: change.content, ln2: change.ln }
          }
          if (change.type === 'del') {
            return { type: 'del', delLine: change.ln, line: change.content, ln1: change.ln }
          }
          return { type: 'normal', line: change.content, ln1: change.ln1, ln2: change.ln2 }
        }),
      })),
    })),
  })
}
