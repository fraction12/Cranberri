import { ipcMain } from 'electron'
import { execFile } from 'node:child_process'
import { Octokit } from '@octokit/rest'
import simpleGit from 'simple-git'
import type { GitHubPanelData, GitHubPanelItem, GitHubPanelKind } from '@/shared/git'
import { getRegisteredRepoPaths } from './repos'
import { validateRepoPath } from './repoSecurity'
import { withGuiToolPath } from './guiToolPath'

interface GitHubRepoRef {
  owner: string
  repo: string
  webUrl: string
}

interface GitHubApiClient {
  repos: {
    get: (params: { owner: string; repo: string }) => Promise<{ data: Record<string, unknown> }>
    listBranches: (params: { owner: string; repo: string; per_page: number }) => Promise<{ data: Array<Record<string, unknown>> }>
    listCommits: (params: { owner: string; repo: string; per_page: number }) => Promise<{ data: Array<Record<string, unknown>> }>
    listReleases: (params: { owner: string; repo: string; per_page: number }) => Promise<{ data: Array<Record<string, unknown>> }>
  }
  pulls: {
    list: (params: { owner: string; repo: string; state: 'all'; per_page: number }) => Promise<{ data: Array<Record<string, unknown>> }>
  }
  issues: {
    listForRepo: (params: { owner: string; repo: string; state: 'all'; per_page: number }) => Promise<{ data: Array<Record<string, unknown>> }>
  }
  actions: {
    listWorkflowRunsForRepo: (params: { owner: string; repo: string; per_page: number }) => Promise<{ data: { workflow_runs?: Array<Record<string, unknown>> } }>
  }
}

function execGh(repoPath: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('gh', args, { cwd: repoPath, timeout: 20_000, maxBuffer: 2_000_000, env: withGuiToolPath() }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr.trim() || error.message))
        return
      }
      resolve(stdout)
    })
  })
}

export function getGitHubToken(env: NodeJS.ProcessEnv = process.env): string | null {
  return env.GITHUB_TOKEN || env.GH_TOKEN || null
}

export function parseGitHubRemote(remoteUrl: string | null | undefined): GitHubRepoRef | null {
  if (!remoteUrl) return null
  const match = remoteUrl.trim().match(/github\.com[:/]([^/]+)\/(.+?)(?:\.git)?$/)
  if (!match) return null
  const [, owner, repo] = match
  return { owner, repo, webUrl: `https://github.com/${owner}/${repo}` }
}

async function readGitHubRepoRef(repoPath: string): Promise<GitHubRepoRef | null> {
  const git = simpleGit(repoPath)
  const remotes = await git.getRemotes(true)
  const origin = remotes.find((remote) => remote.name === 'origin') ?? remotes[0]
  return parseGitHubRemote(origin?.refs?.push || origin?.refs?.fetch || null)
}

function parseJsonList(output: string): unknown[] {
  const parsed = JSON.parse(output || '[]')
  return Array.isArray(parsed) ? parsed : []
}

function valueString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function valueNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined
}

function mapGhItem(kind: GitHubPanelKind, item: Record<string, unknown>): GitHubPanelItem {
  if (kind === 'pulls' || kind === 'issues') {
    return {
      id: String(item.number ?? item.url ?? item.title ?? crypto.randomUUID()),
      title: `#${item.number ?? '?'} ${valueString(item.title) ?? 'Untitled'}`,
      subtitle: valueString(item.body)?.slice(0, 120),
      state: valueString(item.state),
      url: valueString(item.url),
      author: valueString((item.author as { login?: string } | undefined)?.login),
      createdAt: valueString(item.createdAt),
      updatedAt: valueString(item.updatedAt),
    }
  }
  if (kind === 'actions') {
    return {
      id: String(item.databaseId ?? item.url ?? item.name ?? crypto.randomUUID()),
      title: valueString(item.displayTitle) ?? valueString(item.name) ?? 'Workflow run',
      subtitle: valueString(item.headBranch) ?? valueString(item.workflowName),
      state: valueString(item.conclusion) ?? valueString(item.status),
      url: valueString(item.url),
      createdAt: valueString(item.createdAt),
      updatedAt: valueString(item.updatedAt),
      meta: { workflow: valueString(item.workflowName) ?? null, event: valueString(item.event) ?? null },
    }
  }
  if (kind === 'branches') {
    return {
      id: valueString(item.name) ?? crypto.randomUUID(),
      title: valueString(item.name) ?? 'branch',
      subtitle: valueString((item.commit as { sha?: string } | undefined)?.sha)?.slice(0, 12),
      state: item.protected ? 'protected' : undefined,
    }
  }
  if (kind === 'commits') {
    return {
      id: valueString(item.oid) ?? crypto.randomUUID(),
      title: valueString(item.messageHeadline) ?? 'Commit',
      subtitle: valueString(item.oid)?.slice(0, 12),
      url: valueString(item.url),
      author: valueString((item.author as { name?: string } | undefined)?.name),
      createdAt: valueString(item.committedDate),
    }
  }
  if (kind === 'releases') {
    return {
      id: valueString(item.tagName) ?? valueString(item.url) ?? crypto.randomUUID(),
      title: valueString(item.name) ?? valueString(item.tagName) ?? 'Release',
      subtitle: valueString(item.tagName),
      state: item.isDraft ? 'draft' : item.isPrerelease ? 'prerelease' : 'released',
      url: valueString(item.url),
      createdAt: valueString(item.createdAt),
    }
  }
  return {
    id: valueString(item.name) ?? 'repo',
    title: valueString(item.nameWithOwner) ?? valueString(item.name) ?? 'Repository',
    subtitle: valueString(item.description),
    state: item.isPrivate ? 'private' : 'public',
    url: valueString(item.url),
    meta: { stars: valueNumber(item.stargazerCount) ?? null, forks: valueNumber(item.forkCount) ?? null, issues: Array.isArray(item.issues) ? item.issues.length : null },
  }
}

function iso(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined
}

function numberState(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function userLogin(user: unknown): string | undefined {
  return valueString((user as { login?: string } | undefined)?.login)
}

function mapOctokitRepo(repoRef: GitHubRepoRef, item: Record<string, unknown>): GitHubPanelItem {
  return {
    id: String(item.id ?? repoRef.webUrl),
    title: valueString(item.full_name) ?? `${repoRef.owner}/${repoRef.repo}`,
    subtitle: valueString(item.description),
    state: item.private ? 'private' : 'public',
    url: valueString(item.html_url) ?? repoRef.webUrl,
    meta: {
      stars: numberState(item.stargazers_count) ?? null,
      forks: numberState(item.forks_count) ?? null,
      issues: numberState(item.open_issues_count) ?? null,
    },
  }
}

function mapOctokitIssueLike(item: Record<string, unknown>): GitHubPanelItem {
  return {
    id: String(item.id ?? item.node_id ?? item.html_url ?? item.number ?? crypto.randomUUID()),
    title: `#${item.number ?? '?'} ${valueString(item.title) ?? 'Untitled'}`,
    subtitle: valueString(item.body)?.slice(0, 120),
    state: valueString(item.state),
    url: valueString(item.html_url),
    author: userLogin(item.user),
    createdAt: iso(item.created_at),
    updatedAt: iso(item.updated_at),
  }
}

function mapOctokitAction(item: Record<string, unknown>): GitHubPanelItem {
  return {
    id: String(item.id ?? item.html_url ?? item.name ?? crypto.randomUUID()),
    title: valueString(item.display_title) ?? valueString(item.name) ?? 'Workflow run',
    subtitle: valueString(item.head_branch) ?? valueString(item.name),
    state: valueString(item.conclusion) ?? valueString(item.status),
    url: valueString(item.html_url),
    createdAt: iso(item.created_at),
    updatedAt: iso(item.updated_at),
    meta: { workflow: valueString(item.name) ?? null, event: valueString(item.event) ?? null },
  }
}

function mapOctokitCommit(item: Record<string, unknown>): GitHubPanelItem {
  const commit = item.commit as Record<string, unknown> | undefined
  const author = commit?.author as Record<string, unknown> | undefined
  return {
    id: valueString(item.sha) ?? crypto.randomUUID(),
    title: valueString(commit?.message)?.split('\n')[0] ?? 'Commit',
    subtitle: valueString(item.sha)?.slice(0, 12),
    url: valueString(item.html_url),
    author: valueString(author?.name),
    createdAt: iso(author?.date),
  }
}

function canLoadLocalGitHubPanelData(kind: GitHubPanelKind): boolean {
  return kind === 'branches' || kind === 'commits' || kind === 'releases'
}

function parseTabLine(line: string): string[] {
  return line.split('\t')
}

export async function loadLocalGitHubPanelData(repoPath: string, kind: GitHubPanelKind): Promise<GitHubPanelData> {
  const git = simpleGit(repoPath)
  let items: GitHubPanelItem[]

  if (kind === 'branches') {
    const output = await git.raw(['for-each-ref', '--format=%(refname:short)%09%(objectname:short)%09%(upstream:short)', 'refs/heads', 'refs/remotes'])
    items = output.split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map(parseTabLine)
      .filter(([name]) => Boolean(name) && !name.endsWith('/HEAD'))
      .slice(0, 30)
      .map(([name, sha, upstream]) => ({
        id: name,
        title: name,
        subtitle: sha,
        state: name.includes('/') ? 'remote' : 'local',
        meta: upstream ? { upstream } : undefined,
      }))
  } else if (kind === 'commits') {
    const output = await git.raw(['log', '--max-count=20', '--pretty=format:%H%x09%an%x09%aI%x09%s'])
    items = output.split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [sha, author, committedDate, ...messageParts] = parseTabLine(line)
        return {
          id: sha,
          title: messageParts.join('\t') || 'Commit',
          subtitle: sha.slice(0, 12),
          author,
          createdAt: committedDate,
        }
      })
  } else if (kind === 'releases') {
    const output = await git.raw(['tag', '--list', '--sort=-creatordate', '--format=%(refname:short)%09%(creatordate:iso8601)%09%(contents:subject)'])
    items = output.split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [tagName, createdAt, ...subjectParts] = parseTabLine(line)
        return {
          id: tagName,
          title: subjectParts.join('\t') || tagName,
          subtitle: tagName,
          state: 'tag',
          createdAt: createdAt || undefined,
        }
      })
      .slice(0, 30)
  } else {
    throw new Error(`Local git fallback is not available for ${kind}`)
  }

  return { kind, items, fetchedAt: Date.now(), source: 'git', authenticated: false }
}

export async function loadOctokitPanelDataForRepo(
  client: GitHubApiClient,
  repoRef: GitHubRepoRef,
  kind: GitHubPanelKind,
): Promise<GitHubPanelData> {
  const base = { owner: repoRef.owner, repo: repoRef.repo }
  let items: GitHubPanelItem[]

  if (kind === 'repo') {
    const { data } = await client.repos.get(base)
    items = [mapOctokitRepo(repoRef, data)]
  } else if (kind === 'pulls') {
    const { data } = await client.pulls.list({ ...base, state: 'all', per_page: 20 })
    items = data.map(mapOctokitIssueLike)
  } else if (kind === 'issues') {
    const { data } = await client.issues.listForRepo({ ...base, state: 'all', per_page: 20 })
    items = data.filter((item) => !item.pull_request).map(mapOctokitIssueLike)
  } else if (kind === 'actions') {
    const { data } = await client.actions.listWorkflowRunsForRepo({ ...base, per_page: 20 })
    items = (data.workflow_runs ?? []).map(mapOctokitAction)
  } else if (kind === 'branches') {
    const { data } = await client.repos.listBranches({ ...base, per_page: 30 })
    items = data.map((item) => ({
      id: valueString(item.name) ?? crypto.randomUUID(),
      title: valueString(item.name) ?? 'branch',
      subtitle: valueString((item.commit as { sha?: string } | undefined)?.sha)?.slice(0, 12),
      state: item.protected ? 'protected' : undefined,
    }))
  } else if (kind === 'commits') {
    const { data } = await client.repos.listCommits({ ...base, per_page: 20 })
    items = data.map(mapOctokitCommit)
  } else {
    const { data } = await client.repos.listReleases({ ...base, per_page: 20 })
    items = data.map((item) => ({
      id: valueString(item.tag_name) ?? valueString(item.html_url) ?? crypto.randomUUID(),
      title: valueString(item.name) ?? valueString(item.tag_name) ?? 'Release',
      subtitle: valueString(item.tag_name),
      state: item.draft ? 'draft' : item.prerelease ? 'prerelease' : 'released',
      url: valueString(item.html_url),
      createdAt: iso(item.created_at),
      updatedAt: iso(item.published_at),
    }))
  }

  return { kind, items, fetchedAt: Date.now(), source: 'octokit', authenticated: true }
}

async function loadGitHubPanelData(repoPath: string, kind: GitHubPanelKind): Promise<GitHubPanelData> {
  const safeRepoPath = validateRepoPath(repoPath, getRegisteredRepoPaths())
  const token = getGitHubToken()
  if (token) {
    const repoRef = await readGitHubRepoRef(safeRepoPath)
    if (repoRef) {
      try {
        return await loadOctokitPanelDataForRepo(new Octokit({ auth: token }) as GitHubApiClient, repoRef, kind)
      } catch {
        // Fall through to gh without surfacing token-auth details in app logs or UI.
      }
    }
  }

  if (!token && canLoadLocalGitHubPanelData(kind)) {
    return loadLocalGitHubPanelData(safeRepoPath, kind)
  }

  const commands: Record<GitHubPanelKind, string[]> = {
    repo: ['repo', 'view', '--json', 'nameWithOwner,name,description,url,isPrivate,stargazerCount,forkCount,issues'],
    pulls: ['pr', 'list', '--state', 'all', '--limit', '20', '--json', 'number,title,state,url,author,createdAt,updatedAt,body'],
    issues: ['issue', 'list', '--state', 'all', '--limit', '20', '--json', 'number,title,state,url,author,createdAt,updatedAt,body,labels'],
    actions: ['run', 'list', '--limit', '20', '--json', 'databaseId,name,displayTitle,workflowName,status,conclusion,event,headBranch,createdAt,updatedAt,url'],
    branches: ['api', 'repos/:owner/:repo/branches', '--paginate'],
    commits: ['api', 'repos/:owner/:repo/commits?per_page=20', '--paginate'],
    releases: ['release', 'list', '--limit', '20', '--json', 'name,tagName,isDraft,isPrerelease,createdAt,publishedAt'],
  }
  let output: string
  try {
    output = await execGh(safeRepoPath, commands[kind])
  } catch (error) {
    if (canLoadLocalGitHubPanelData(kind)) return loadLocalGitHubPanelData(safeRepoPath, kind)
    throw error
  }
  const raw = kind === 'repo' ? [JSON.parse(output)] : parseJsonList(output)
  const items = raw.slice(0, 30).map((entry) => {
    const item = entry as Record<string, unknown>
    if (kind === 'commits') {
      const commit = item.commit as Record<string, unknown> | undefined
      const author = commit?.author as Record<string, unknown> | undefined
      return mapGhItem(kind, {
        oid: item.sha,
        messageHeadline: valueString(commit?.message)?.split('\n')[0],
        url: item.html_url,
        author: { name: author?.name },
        committedDate: author?.date,
      })
    }
    return mapGhItem(kind, item)
  })
  return { kind, items, fetchedAt: Date.now(), source: 'gh', authenticated: false }
}

export function initGitHubIpc(): void {
  ipcMain.handle('github:panel-data', async (_, repoPath: string, kind: GitHubPanelKind) => loadGitHubPanelData(repoPath, kind))
}
