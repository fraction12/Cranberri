import type { GitHubPanelData, GitHubPanelItem, GitHubPanelKind, GitHubRepoSummary } from '@/shared/git'

const MAX_GITHUB_CONTEXT_CHARS = 12_000
const MAX_ITEM_BODY_CHARS = 900

export type LatestGitHubContextKind = 'panel' | 'item'

export interface LatestGitHubContext {
  kind: LatestGitHubContextKind
  label: string
  text: string
  repoPath: string
}

export function githubPanelChatContext(options: {
  repoPath: string
  summary: GitHubRepoSummary
  data?: GitHubPanelData | null
}): string {
  const { repoPath, summary, data } = options
  const header = githubSummaryLines(repoPath, summary)
  const panel = data ? [
    '',
    `Panel: ${data.kind}`,
    data.source ? `Source: ${data.source}${data.authenticated ? ' authenticated' : ''}` : null,
    `Fetched: ${new Date(data.fetchedAt).toISOString()}`,
    data.items.length ? 'Items:' : 'Items: none',
    ...data.items.slice(0, 12).map((item) => `- ${itemLine(item)}`),
  ].filter((line): line is string => Boolean(line)).join('\n') : ''

  return bounded([
    'GitHub context:',
    ...header,
    panel,
  ].filter(Boolean).join('\n'))
}

export function githubItemChatContext(options: {
  repoPath: string
  summary: GitHubRepoSummary
  kind: GitHubPanelKind
  item: GitHubPanelItem
}): string {
  const { repoPath, summary, kind, item } = options
  const lines = [
    'GitHub item context:',
    ...githubSummaryLines(repoPath, summary),
    '',
    `Kind: ${kind}`,
    `Title: ${item.title}`,
    item.state ? `State: ${item.state}` : null,
    item.subtitle ? `Summary: ${truncate(item.subtitle, MAX_ITEM_BODY_CHARS)}` : null,
    item.author ? `Author: ${item.author}` : null,
    item.createdAt ? `Created: ${item.createdAt}` : null,
    item.updatedAt ? `Updated: ${item.updatedAt}` : null,
    item.url ? `URL: ${item.url}` : null,
    item.meta && Object.keys(item.meta).length ? 'Metadata:' : null,
    ...(item.meta ? Object.entries(item.meta)
      .filter(([, value]) => value !== null && value !== undefined)
      .map(([key, value]) => `- ${key}: ${String(value)}`) : []),
  ].filter((line): line is string => Boolean(line))

  return bounded(lines.join('\n'))
}

function githubSummaryLines(repoPath: string, summary: GitHubRepoSummary): string[] {
  return [
    `Repo path: ${repoPath}`,
    summary.owner && summary.repo ? `GitHub repo: ${summary.owner}/${summary.repo}` : null,
    summary.webUrl ? `URL: ${summary.webUrl}` : null,
    summary.branch ? `Branch: ${summary.branch}` : null,
    summary.tracking ? `Tracking: ${summary.tracking}` : null,
    `Ahead/behind: ${summary.ahead}/${summary.behind}`,
  ].filter((line): line is string => Boolean(line))
}

function itemLine(item: GitHubPanelItem): string {
  return [
    item.title,
    item.state ? `[${item.state}]` : null,
    item.author ? `@${item.author}` : null,
    item.subtitle ? truncate(item.subtitle.replace(/\s+/g, ' ').trim(), 140) : null,
    item.url,
  ].filter(Boolean).join(' - ')
}

function truncate(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value
  const head = Math.floor(maxChars * 0.55)
  const tail = maxChars - head
  return `${value.slice(0, head).trimEnd()}\n[GitHub context field truncated: ${value.length - maxChars} chars omitted]\n${value.slice(-tail).trimStart()}`
}

function bounded(value: string): string {
  const text = value.trim()
  if (text.length <= MAX_GITHUB_CONTEXT_CHARS) return text
  return `${text.slice(-MAX_GITHUB_CONTEXT_CHARS).trimStart()}\n\n[GitHub context truncated: ${text.length - MAX_GITHUB_CONTEXT_CHARS} chars omitted from the beginning]`
}
