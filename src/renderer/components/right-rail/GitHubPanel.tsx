import { useEffect, useState, type ReactNode } from 'react'
import {
  CircleDot,
  ExternalLink,
  FileText,
  GitBranch,
  Github,
  GitPullRequest,
  MessageSquare,
  PlayCircle,
  UploadCloud,
} from 'lucide-react'
import type { GitHubPanelData, GitHubPanelKind, GitHubRepoSummary } from '@/shared/git'
import { createSendChatContextEvent } from '../chat/chat-context-events'
import { createGitHubContextCapturedEvent } from '../github-context-events'
import { githubItemChatContext, githubPanelChatContext } from '../github-chat-context'
import { githubPanelBadges } from './github-panel-model'

interface GitHubPanelProps {
  repoPath: string | null
}

const panelKinds: Array<{ kind: GitHubPanelKind; label: string; icon: ReactNode }> = [
  { kind: 'repo', label: 'Repo', icon: <Github className="h-3.5 w-3.5" /> },
  { kind: 'pulls', label: 'PRs', icon: <GitPullRequest className="h-3.5 w-3.5" /> },
  { kind: 'issues', label: 'Issues', icon: <CircleDot className="h-3.5 w-3.5" /> },
  { kind: 'actions', label: 'CI', icon: <PlayCircle className="h-3.5 w-3.5" /> },
  { kind: 'branches', label: 'Branches', icon: <GitBranch className="h-3.5 w-3.5" /> },
  { kind: 'commits', label: 'Commits', icon: <FileText className="h-3.5 w-3.5" /> },
  { kind: 'releases', label: 'Releases', icon: <UploadCloud className="h-3.5 w-3.5" /> },
]

const kindButtonClassName =
  'flex items-center gap-2 rounded-lg px-2 py-1.5 text-left transition'
const itemButtonClassName =
  'w-full rounded-md bg-app-bg p-2 text-left transition hover:bg-app-surface-2 disabled:cursor-default disabled:hover:bg-app-bg'

export function GitHubPanel({ repoPath }: GitHubPanelProps) {
  const [summary, setSummary] = useState<GitHubRepoSummary | null>(null)
  const [activeKind, setActiveKind] = useState<GitHubPanelKind>('repo')
  const [data, setData] = useState<GitHubPanelData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    if (!repoPath) {
      setSummary(null)
      setData(null)
      return
    }
    let cancelled = false
    window.cranberri.git.githubSummary(repoPath)
      .then((result) => {
        if (!cancelled) setSummary(result)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load GitHub repo')
      })
    return () => { cancelled = true }
  }, [repoPath])

  useEffect(() => {
    if (!repoPath || !summary?.isGitHub) return
    let cancelled = false
    setLoading(true)
    setError(null)
    window.cranberri.github.panelData(repoPath, activeKind)
      .then((result) => {
        if (!cancelled) setData(result)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load GitHub data')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [activeKind, reloadKey, repoPath, summary?.isGitHub])

  const open = (url?: string) => {
    if (url) void window.cranberri.openExternal(url)
  }
  const sendPanelContext = (panelData?: GitHubPanelData | null) => {
    if (!summary || !repoPath) return
    const text = githubPanelChatContext({ repoPath, summary, data: panelData })
    window.dispatchEvent(createGitHubContextCapturedEvent({
      kind: 'panel',
      label: panelData?.kind ?? 'repo',
      repoPath,
      text,
    }))
    window.dispatchEvent(createSendChatContextEvent({ text }))
  }
  const sendItemContext = (item: GitHubPanelData['items'][number]) => {
    if (!summary || !repoPath) return
    const text = githubItemChatContext({ repoPath, summary, kind: activeKind, item })
    window.dispatchEvent(createGitHubContextCapturedEvent({
      kind: 'item',
      label: item.title,
      repoPath,
      text,
    }))
    window.dispatchEvent(createSendChatContextEvent({ text }))
  }
  const dataBadges = githubPanelBadges(data)

  if (!repoPath) return <div className="p-3 text-sm text-app-text-muted">Select a repo for GitHub actions.</div>
  if (!summary) return <div className="p-3 text-xs text-app-text-muted">Reading GitHub remote...</div>
  if (!summary.isGitHub || !summary.webUrl) {
    return (
      <div className="p-3 text-sm text-app-text-muted">
        No GitHub remote detected for this repo.
        {summary.remoteUrl && (
          <div className="mt-2 truncate font-mono text-caption" title={summary.remoteUrl}>
            {summary.remoteUrl}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="h-[calc(100%-2rem)] overflow-y-auto p-3 text-xs">
      <RepoSummaryCard summary={summary} onOpen={open} onSendContext={() => sendPanelContext()} />

      <div className="mt-3 grid grid-cols-2 gap-1">
        {panelKinds.map((item) => (
          <button
            key={item.kind}
            type="button"
            onClick={() => setActiveKind(item.kind)}
            className={`${kindButtonClassName} ${
              activeKind === item.kind
                ? 'bg-app-surface-2 text-app-text'
                : 'bg-app-surface/70 text-app-text-muted hover:bg-app-surface-2 hover:text-app-text'
            }`}
          >
            {item.icon}
            <span>{item.label}</span>
          </button>
        ))}
      </div>

      <div className="mt-3 rounded-lg bg-app-surface/70 p-2">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-micro uppercase text-app-text-muted">
            <span>{activeKind}</span>
            {dataBadges.map((badge) => (
              <span key={badge.id} className="rounded bg-app-bg px-1.5 py-0.5" title={badge.title}>
                {badge.label}
              </span>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setReloadKey((key) => key + 1)}
            className="text-micro text-app-text-muted hover:text-app-text"
          >
            Refresh
          </button>
          <button
            type="button"
            onClick={() => sendPanelContext(data)}
            disabled={!data}
            className="rounded p-1 text-app-text-muted hover:bg-app-bg hover:text-app-text disabled:opacity-40"
            title="Send GitHub panel context to chat"
            aria-label="Send GitHub panel context to chat"
          >
            <MessageSquare className="h-3.5 w-3.5" />
          </button>
        </div>
        {loading && <div className="p-2 text-xs text-app-text-muted">Loading GitHub data...</div>}
        {error && <div className="p-2 text-xs text-app-danger">{error}</div>}
        {!loading && !error && data?.items.length === 0 && (
          <div className="p-2 text-xs text-app-text-muted">No {activeKind} found.</div>
        )}
        <div className="space-y-1">
          {data?.items.map((item) => (
            <div
              key={item.id}
              className={itemButtonClassName}
            >
              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => open(item.url)}
                  disabled={!item.url}
                  className="min-w-0 flex-1 truncate text-left text-xs font-medium text-app-text disabled:cursor-default"
                  title={item.title}
                >
                  {item.title}
                </button>
                {item.state && <span className="rounded bg-app-surface-2 px-1.5 py-0.5 text-micro uppercase text-app-text-muted">{item.state}</span>}
                <button
                  type="button"
                  onClick={() => sendItemContext(item)}
                  className="rounded p-1 text-app-text-muted hover:bg-app-surface hover:text-app-text"
                  title="Send GitHub item context to chat"
                  aria-label="Send GitHub item context to chat"
                >
                  <MessageSquare className="h-3.5 w-3.5" />
                </button>
              </div>
              {item.subtitle && (
                <div className="mt-1 truncate text-micro text-app-text-muted" title={item.subtitle}>
                  {item.subtitle}
                </div>
              )}
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-micro text-app-text-muted">
                {item.author && <span>@{item.author}</span>}
                {item.createdAt && <span>{new Date(item.createdAt).toLocaleString()}</span>}
                {item.meta && Object.entries(item.meta).map(([key, value]) => (
                  value !== null && value !== undefined ? <span key={key}>{key}: {String(value)}</span> : null
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function RepoSummaryCard({
  summary,
  onOpen,
  onSendContext,
}: {
  summary: GitHubRepoSummary
  onOpen: (url?: string) => void
  onSendContext: () => void
}) {
  return (
    <div className="rounded-lg bg-app-surface p-3 shadow-[inset_0_0_0_1px_var(--app-inset)]">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate font-medium text-app-text">{summary.owner}/{summary.repo}</div>
          <div className="mt-1 truncate font-mono text-micro text-app-text-muted" title={summary.remoteUrl ?? undefined}>
            {summary.remoteUrl}
          </div>
        </div>
        <button
          type="button"
          onClick={() => onOpen(summary.webUrl ?? undefined)}
          className="rounded-md p-1.5 text-app-text-muted hover:bg-app-surface-2 hover:text-app-text"
          title="Open repo on GitHub"
        >
          <ExternalLink className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onSendContext}
          className="rounded-md p-1.5 text-app-text-muted hover:bg-app-surface-2 hover:text-app-text"
          title="Send GitHub repo context to chat"
          aria-label="Send GitHub repo context to chat"
        >
          <MessageSquare className="h-4 w-4" />
        </button>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 text-micro text-app-text-muted">
        <SummaryStat label="Branch" value={summary.branch ?? 'unknown'} title={summary.branch ?? undefined} />
        <SummaryStat label="Ahead" value={summary.ahead} />
        <SummaryStat label="Behind" value={summary.behind} />
      </div>
    </div>
  )
}

function SummaryStat({
  label,
  value,
  title,
}: {
  label: string
  value: string | number
  title?: string
}) {
  return (
    <div className="rounded bg-app-bg p-2">
      <div>{label}</div>
      <div className="truncate font-mono text-app-text" title={title}>{value}</div>
    </div>
  )
}
