import { useEffect, useState, type ReactNode } from 'react'
import {
  AlertCircle,
  CircleDot,
  ExternalLink,
  FileText,
  GitBranch,
  Github,
  GitPullRequest,
  Loader2,
  MessageSquare,
  PlayCircle,
  RefreshCw,
  UploadCloud,
} from 'lucide-react'
import type { GitHubPanelData, GitHubPanelKind, GitHubRepoSummary } from '@/shared/git'
import { cn, iconButton } from '../../lib/ui'
import { sendChatContextSafely } from '../../state/chat-context-command'
import { createGitHubContextCapturedEvent } from '../github-context-events'
import { githubItemChatContext, githubPanelChatContext } from '../github-chat-context'
import { githubPanelBadges } from './github-panel-model'
import { loadGitHubPanelData, loadGitHubSummary } from './github-panel-route'
import { typeStyle } from '../../lib/typography'

interface GitHubPanelProps {
  repoPath: string | null
  taskId?: string | null
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

function githubStateTone(state: string): 'success' | 'warning' | 'info' | 'danger' {
  const normalized = state.toLowerCase()
  if (/failed|failure|error|closed|cancelled/.test(normalized)) return 'danger'
  if (/pending|queued|draft|waiting/.test(normalized)) return 'warning'
  if (/open|passed|success|merged|completed|active/.test(normalized)) return 'success'
  return 'info'
}

export function GitHubPanel({ repoPath, taskId = null }: GitHubPanelProps) {
  const [summary, setSummary] = useState<GitHubRepoSummary | null>(null)
  const [summaryLoading, setSummaryLoading] = useState(false)
  const [activeKind, setActiveKind] = useState<GitHubPanelKind>('repo')
  const [data, setData] = useState<GitHubPanelData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    if (!repoPath) {
      setSummary(null)
      setData(null)
      setError(null)
      return
    }
    let cancelled = false
    setSummaryLoading(true)
    setSummary(null)
    setData(null)
    setError(null)
    loadGitHubSummary(window.cranberri, { repoPath, taskId })
      .then((result) => {
        if (!cancelled) setSummary(result)
      })
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Failed to read the GitHub remote')
      })
      .finally(() => {
        if (!cancelled) setSummaryLoading(false)
      })
    return () => { cancelled = true }
  }, [reloadKey, repoPath, taskId])

  useEffect(() => {
    if (!repoPath || !summary?.isGitHub) return
    let cancelled = false
    setLoading(true)
    setData(null)
    setError(null)
    loadGitHubPanelData(window.cranberri, { repoPath, taskId }, activeKind)
      .then((result) => {
        if (!cancelled) setData(result)
      })
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Failed to load GitHub data')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [activeKind, reloadKey, repoPath, summary?.isGitHub, taskId])

  const sendPanelContext = (panelData?: GitHubPanelData | null) => {
    if (!summary || !repoPath) return
    const text = githubPanelChatContext({ repoPath, summary, data: panelData })
    window.dispatchEvent(createGitHubContextCapturedEvent({ kind: 'panel', label: panelData?.kind ?? 'repo', repoPath, text }))
    sendChatContextSafely({ text })
  }

  const sendItemContext = (item: GitHubPanelData['items'][number]) => {
    if (!summary || !repoPath) return
    const text = githubItemChatContext({ repoPath, summary, kind: activeKind, item })
    window.dispatchEvent(createGitHubContextCapturedEvent({ kind: 'item', label: item.title, repoPath, text }))
    sendChatContextSafely({ text })
  }

  if (!repoPath) return <PanelEmpty icon={Github} label="Select a repo to use GitHub." />
  if (summaryLoading) return <PanelLoading label="Reading GitHub remote" />
  if (error && !summary) return <PanelError message={error} onRetry={() => setReloadKey((key) => key + 1)} />
  if (!summary) return <PanelError message="GitHub remote details were not returned." onRetry={() => setReloadKey((key) => key + 1)} />
  if (!summary.isGitHub || !summary.webUrl) {
    return <PanelEmpty icon={Github} label="No GitHub remote detected." detail={summary.remoteUrl ?? undefined} />
  }

  const dataBadges = githubPanelBadges(data)
  const activeLabel = panelKinds.find((item) => item.kind === activeKind)?.label ?? activeKind

  return (
    <div className={cn('h-full overflow-y-auto px-2 pb-3', typeStyle({ role: 'body' }))}>
      <div className="flex items-start gap-2 px-1 py-2.5">
        <Github className="mt-0.5 h-4 w-4 shrink-0 text-app-text-muted" />
        <div className="min-w-0 flex-1">
          <div className={cn('truncate', typeStyle({ role: 'panelTitle' }))}>{summary.owner}/{summary.repo}</div>
          <div className={cn('mt-1 flex flex-wrap gap-x-2 gap-y-0.5', typeStyle({ role: 'metadata', tone: 'secondary' }))}>
            {summary.branch && <span className="[overflow-wrap:anywhere]">{summary.branch}</span>}
            <span>{summary.ahead} ahead</span>
            <span>{summary.behind} behind</span>
          </div>
        </div>
        <button type="button" onClick={() => void window.cranberri.openExternal(summary.webUrl!)} className={iconButton()} title="Open repo on GitHub" aria-label="Open repo on GitHub">
          <ExternalLink className="h-3.5 w-3.5" />
        </button>
        <button type="button" onClick={() => sendPanelContext()} className={iconButton()} title="Send GitHub repo context to chat" aria-label="Send GitHub repo context to chat">
          <MessageSquare className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1 py-1" role="tablist" aria-label="GitHub view">
        {panelKinds.map((item) => (
          <button
            key={item.kind}
            type="button"
            role="tab"
            aria-selected={activeKind === item.kind}
            aria-label={item.label}
            title={item.label}
            onClick={() => setActiveKind(item.kind)}
            className={cn(
              'flex h-8 min-w-0 items-center justify-center rounded-md transition-colors duration-fast ease-standard',
              activeKind === item.kind ? 'bg-app-surface-2 text-app-text' : 'text-app-text-muted hover:bg-app-surface-2/55 hover:text-app-text',
            )}
          >
            {item.icon}
            <span className="sr-only">{item.label}</span>
          </button>
        ))}
      </div>

      <div className="mt-1">
        <div className="flex h-9 items-center gap-2 px-1">
          <span className={typeStyle({ role: 'panelTitle' })}>{activeLabel}</span>
          {dataBadges.map((badge) => <span key={badge.id} className={typeStyle({ role: 'metadata', tone: 'secondary' })} title={badge.title}>{badge.label}</span>)}
          <button type="button" onClick={() => setReloadKey((key) => key + 1)} className={cn(iconButton(), 'ml-auto')} title="Refresh GitHub" aria-label="Refresh GitHub">
            <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
          </button>
          <button type="button" onClick={() => sendPanelContext(data)} disabled={!data} className={iconButton()} title="Send GitHub panel context to chat" aria-label="Send GitHub panel context to chat">
            <MessageSquare className="h-3.5 w-3.5" />
          </button>
        </div>

        {loading && !data && <PanelLoading label={`Loading ${activeLabel.toLowerCase()}`} />}
        {error && summary && <PanelError message={error} onRetry={() => setReloadKey((key) => key + 1)} compact />}
        {!loading && !error && data?.items.length === 0 && <div className={cn('px-2 py-4', typeStyle({ role: 'body', tone: 'secondary' }))}>No {activeLabel.toLowerCase()} found.</div>}
        <div className="space-y-0.5">
          {data?.items.map((item) => (
            <div key={item.id} className="group rounded-md px-2 py-2 hover:bg-app-surface-2/55">
              <div className="flex items-start gap-2">
                <button type="button" onClick={() => item.url && void window.cranberri.openExternal(item.url)} disabled={!item.url} className="min-w-0 flex-1 text-left disabled:cursor-default">
                  <span className={cn('block truncate', typeStyle({ role: 'label' }))} title={item.title}>{item.title}</span>
                  {item.subtitle && <span className={cn('mt-0.5 block truncate', typeStyle({ role: 'metadata', tone: 'secondary' }))} title={item.subtitle}>{item.subtitle}</span>}
                </button>
                {item.state && <span className={cn('shrink-0 capitalize', typeStyle({ role: 'status', tone: githubStateTone(item.state) }))}>{item.state}</span>}
                <button type="button" onClick={() => sendItemContext(item)} className={iconButton()} title="Send GitHub item context to chat" aria-label="Send GitHub item context to chat">
                  <MessageSquare className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className={cn('mt-1 flex flex-wrap gap-x-2', typeStyle({ role: 'micro', tone: 'secondary' }))}>
                {item.author && <span>@{item.author}</span>}
                {item.createdAt && <span>{new Date(item.createdAt).toLocaleString()}</span>}
                {item.meta && Object.entries(item.meta).map(([key, value]) => value !== null && value !== undefined ? <span key={key}>{key}: {String(value)}</span> : null)}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function PanelLoading({ label }: { label: string }) {
  return <div className={cn('flex items-center gap-2 px-3 py-4', typeStyle({ role: 'status', tone: 'secondary' }))} role="status"><Loader2 className="h-4 w-4 animate-spin" />{label}</div>
}

function PanelError({ message, onRetry, compact = false }: { message: string; onRetry: () => void; compact?: boolean }) {
  return (
    <div role="alert" className={cn('flex items-start gap-2', typeStyle({ role: 'status', tone: 'danger' }), compact ? 'px-2 py-3' : 'p-4')}>
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
      <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{message}</span>
      <button type="button" onClick={onRetry} className={cn('hover:underline', typeStyle({ role: 'control' }))}>Retry</button>
    </div>
  )
}

function PanelEmpty({ icon: Icon, label, detail }: { icon: React.ElementType; label: string; detail?: string }) {
  return (
    <div className={cn('flex h-full min-h-40 flex-col items-center justify-center p-5 text-center', typeStyle({ role: 'body', tone: 'secondary' }))}>
      <Icon className="mb-2 h-7 w-7 opacity-45" />
      <span>{label}</span>
      {detail && <span className={cn('mt-1 max-w-full [overflow-wrap:anywhere]', typeStyle({ role: 'metadata', tone: 'secondary' }))} title={detail}>{detail}</span>}
    </div>
  )
}
