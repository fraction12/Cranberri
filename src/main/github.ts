import { ipcMain } from 'electron'
import { execFile } from 'node:child_process'
import type { GitHubPanelData, GitHubPanelItem, GitHubPanelKind } from '@/shared/git'

function execGh(repoPath: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('gh', args, { cwd: repoPath, timeout: 20_000, maxBuffer: 2_000_000 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr.trim() || error.message))
        return
      }
      resolve(stdout)
    })
  })
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

async function loadGitHubPanelData(repoPath: string, kind: GitHubPanelKind): Promise<GitHubPanelData> {
  const commands: Record<GitHubPanelKind, string[]> = {
    repo: ['repo', 'view', '--json', 'nameWithOwner,name,description,url,isPrivate,stargazerCount,forkCount,issues'],
    pulls: ['pr', 'list', '--state', 'all', '--limit', '20', '--json', 'number,title,state,url,author,createdAt,updatedAt,body'],
    issues: ['issue', 'list', '--state', 'all', '--limit', '20', '--json', 'number,title,state,url,author,createdAt,updatedAt,body,labels'],
    actions: ['run', 'list', '--limit', '20', '--json', 'databaseId,name,displayTitle,workflowName,status,conclusion,event,headBranch,createdAt,updatedAt,url'],
    branches: ['api', 'repos/{owner}/{repo}/branches', '--paginate'],
    commits: ['api', 'repos/{owner}/{repo}/commits', '--paginate', '-f', 'per_page=20'],
    releases: ['release', 'list', '--limit', '20', '--json', 'name,tagName,isDraft,isPrerelease,createdAt,url'],
  }
  const output = await execGh(repoPath, commands[kind])
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
  return { kind, items, fetchedAt: Date.now() }
}

export function initGitHubIpc(): void {
  ipcMain.handle('github:panel-data', async (_, repoPath: string, kind: GitHubPanelKind) => loadGitHubPanelData(repoPath, kind))
}
