import simpleGit from 'simple-git'
import { ipcMain } from 'electron'
import fs from 'node:fs'
import { z } from 'zod'
import type { GitCommitMessageDraft, GitHubRepoSummary } from '@/shared/git'
import { getRegisteredRepoPaths } from './repos'
import { resolveRepoFilePath, validateRepoPath, validateRepoRelativePath } from './repoSecurity'
import { buildCommitMessageDraftPrompt, commitRepo, parseGeneratedCommitMessage } from './gitCommit'
import { getCodexClient } from './codex/ipc'
import { authorizeExecutionFile, resolveExecutionContext } from './execution-context'
import { executionFileRequestSchema, executionRequestSchema } from '../shared/execution'

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

async function readGitHubSummary(repoPath: string): Promise<GitHubRepoSummary> {
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
}

export type Diff = z.infer<typeof diffSchema>
export type DiffResult = Diff

async function readStatus(repoPath: string): Promise<GitFileStatus[]> {
  const status = await simpleGit(repoPath).status()
  const files: GitFileStatus[] = []
  const add = (filePath: string, fileStatus: GitFileStatus['status']) => {
    if (!files.some((file) => file.path === filePath)) files.push({ path: filePath, status: fileStatus })
  }
  for (const filePath of status.created) add(filePath, 'added')
  for (const filePath of status.modified) add(filePath, 'modified')
  for (const filePath of status.deleted) add(filePath, 'deleted')
  for (const filePath of status.renamed.map((item) => item.to)) add(filePath, 'renamed')
  for (const filePath of status.not_added) add(filePath, 'untracked')
  for (const filePath of status.conflicted) add(filePath, 'conflict')
  for (const filePath of status.staged) add(filePath, 'staged')
  return fileStatusSchema.array().parse(files)
}

async function readFiles(repoPath: string): Promise<FileTreeNode[]> {
  const git = simpleGit(repoPath)
  const [tracked, untracked] = await Promise.all([
    git.raw(['ls-files']),
    git.raw(['ls-files', '--others', '--exclude-standard']),
  ])
  const all = new Set([...tracked.split('\n').filter(Boolean), ...untracked.split('\n').filter(Boolean)])
  const root: FileTreeNode[] = []
  const dirs = new Map<string, FileTreeNode>()
  const getDir = (dirPath: string): FileTreeNode => {
    const existing = dirs.get(dirPath)
    if (existing) return existing
    const node: FileTreeNode = { path: dirPath, type: 'dir', children: [] }
    dirs.set(dirPath, node)
    return node
  }
  for (const fullPath of all) {
    const parts = fullPath.split('/')
    let dirPath = ''
    for (let index = 0; index < parts.length - 1; index += 1) {
      dirPath = dirPath ? `${dirPath}/${parts[index]}` : parts[index]
      const parent = dirPath.includes('/') ? getDir(dirPath.slice(0, dirPath.lastIndexOf('/'))) : null
      const dir = getDir(dirPath)
      if (parent && !parent.children.includes(dir)) parent.children.push(dir)
      else if (!parent && !root.includes(dir)) root.push(dir)
    }
    const file = { path: fullPath, type: 'file' as const, children: [] }
    const parentPath = parts.length > 1 ? parts.slice(0, -1).join('/') : ''
    if (parentPath) getDir(parentPath).children.push(file)
    else root.push(file)
  }
  return root
}

export function initGitIpc(): void {
  ipcMain.handle('git:status', async (_, repoPath: string) => {
    const safeRepoPath = validateRepoPath(repoPath, getRegisteredRepoPaths())
    return readStatus(safeRepoPath)
  })

  ipcMain.handle('git:files', async (_, repoPath: string) => {
    const safeRepoPath = validateRepoPath(repoPath, getRegisteredRepoPaths())
    return readFiles(safeRepoPath)
  })

  ipcMain.handle('git:diff', async (_, repoPath: string) => {
    const safeRepoPath = validateRepoPath(repoPath, getRegisteredRepoPaths())
    const git = simpleGit(safeRepoPath)
    const raw = await git.diff()
    return parseGitDiff(raw)
  })

  ipcMain.handle('git:diff-file', async (_, repoPath: string, filePath: string) => {
    const safeRepoPath = validateRepoPath(repoPath, getRegisteredRepoPaths())
    const safeFilePath = validateRepoRelativePath(safeRepoPath, filePath)
    const git = simpleGit(safeRepoPath)
    const raw = await git.diff(['--', safeFilePath])
    return parseGitDiff(raw)
  })

  ipcMain.handle('git:raw-content', async (_, repoPath: string, filePath: string, ref: 'HEAD' | 'WORKING') => {
    const safeRepoPath = validateRepoPath(repoPath, getRegisteredRepoPaths())
    const safeFilePath = validateRepoRelativePath(safeRepoPath, filePath)
    const git = simpleGit(safeRepoPath)
    if (ref === 'WORKING') {
      return fs.promises.readFile(resolveRepoFilePath(safeRepoPath, safeFilePath), 'utf8').catch(() => '')
    }
    return git.show(['HEAD:' + safeFilePath]).catch(() => '')
  })

  ipcMain.handle('git:github-summary', async (_, repoPath: string): Promise<GitHubRepoSummary> => {
    const safeRepoPath = validateRepoPath(repoPath, getRegisteredRepoPaths())
    return readGitHubSummary(safeRepoPath)
  })

  ipcMain.handle('git:commit', async (_, repoPath: string, title: string, summary: string) => {
    const safeRepoPath = validateRepoPath(repoPath, getRegisteredRepoPaths())
    return commitRepo(safeRepoPath, title, summary)
  })

  ipcMain.handle('git:commit-message:draft', async (_, repoPath: string): Promise<GitCommitMessageDraft> => {
    const safeRepoPath = validateRepoPath(repoPath, getRegisteredRepoPaths())
    const git = simpleGit(safeRepoPath)
    const status = await git.status()
    const statusSummary = [
      ...status.created.map((file) => `A ${file}`),
      ...status.modified.map((file) => `M ${file}`),
      ...status.deleted.map((file) => `D ${file}`),
      ...status.renamed.map((file) => `R ${file.from} -> ${file.to}`),
      ...status.not_added.map((file) => `?? ${file}`),
      ...status.conflicted.map((file) => `UU ${file}`),
      ...status.staged.map((file) => `STAGED ${file}`),
    ].join('\n')
    if (!statusSummary.trim()) throw new Error('No changes to draft a commit message for')

    const [stagedDiff, unstagedDiff] = await Promise.all([
      git.diff(['--cached']),
      git.diff(),
    ])
    const client = await getCodexClient()
    if (!('runOneShot' in client)) throw new Error('Codex client cannot draft commit messages')
    const output = await client.runOneShot(safeRepoPath, buildCommitMessageDraftPrompt({ statusSummary, stagedDiff, unstagedDiff }), undefined, 120_000)
    return parseGeneratedCommitMessage(output)
  })

  ipcMain.handle('git:task:status', async (_, request: unknown) => readStatus(resolveExecutionContext(executionRequestSchema.parse(request).taskId).cwd))
  ipcMain.handle('git:task:files', async (_, request: unknown) => readFiles(resolveExecutionContext(executionRequestSchema.parse(request).taskId).cwd))
  ipcMain.handle('git:task:diff', async (_, request: unknown) => parseGitDiff(await simpleGit(resolveExecutionContext(executionRequestSchema.parse(request).taskId).cwd).diff()))
  ipcMain.handle('git:task:github-summary', async (_, request: unknown) => {
    const context = resolveExecutionContext(executionRequestSchema.parse(request).taskId)
    return readGitHubSummary(context.cwd)
  })
  ipcMain.handle('git:task:diff-file', async (_, request: unknown) => {
    const parsed = executionFileRequestSchema.parse(request)
    const context = resolveExecutionContext(parsed.taskId)
    authorizeExecutionFile(context, parsed.filePath)
    return parseGitDiff(await simpleGit(context.cwd).diff(['--', parsed.filePath]))
  })
  ipcMain.handle('git:task:raw-content', async (_, request: unknown, ref: 'HEAD' | 'WORKING') => {
    const parsed = executionFileRequestSchema.parse(request)
    const context = resolveExecutionContext(parsed.taskId)
    const absolutePath = authorizeExecutionFile(context, parsed.filePath)
    return ref === 'WORKING'
      ? fs.promises.readFile(absolutePath, 'utf8').catch(() => '')
      : simpleGit(context.cwd).show([`HEAD:${parsed.filePath}`]).catch(() => '')
  })
  ipcMain.handle('git:task:commit', async (_, request: unknown, title: string, summary: string) => {
    const context = resolveExecutionContext(executionRequestSchema.parse(request).taskId)
    return commitRepo(context.cwd, title, summary)
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
