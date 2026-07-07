import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import ReactDiffViewer from 'react-diff-viewer-continued'
import { Activity, Check, CircleDot, ExternalLink, FileDiff, FileText, GitBranch, Github, GitPullRequest, PlayCircle, Ticket, ChevronLeft, Folder, ChevronRight, Menu, UploadCloud, X } from 'lucide-react'
import { useGitStatus, useGitDiffForFile, useGitFiles, useGitRawContent } from '../state/git'
import { useRepos } from '../state/repos'
import type { GitFileStatus, FileTreeNode, GitHubPanelData, GitHubPanelKind, GitHubRepoSummary } from '@/shared/git'
import type { AgentProcessInfo } from '@/shared/processes'

function statusColor(status: GitFileStatus['status']) {
  switch (status) {
    case 'added':
    case 'untracked':
      return 'text-app-accent bg-app-accent/10'
    case 'deleted':
      return 'text-app-danger bg-app-danger/10'
    case 'modified':
      return 'text-yellow-400 bg-yellow-400/10'
    case 'renamed':
      return 'text-blue-400 bg-blue-400/10'
    case 'conflict':
      return 'text-orange-400 bg-orange-400/10'
    case 'staged':
      return 'text-green-300 bg-green-300/10'
    case 'tracked':
    default:
      return 'text-app-text-muted bg-app-surface-2'
  }
}

const DIFF_MENU_WIDTH = 176
const VIEWPORT_PADDING = 8

function getDiffMenuPosition(button: HTMLButtonElement | null) {
  const rect = button?.getBoundingClientRect()
  if (!rect) return null
  return {
    top: Math.min(rect.bottom + 4, window.innerHeight - VIEWPORT_PADDING),
    left: Math.min(
      Math.max(VIEWPORT_PADDING, rect.right - DIFF_MENU_WIDTH),
      window.innerWidth - DIFF_MENU_WIDTH - VIEWPORT_PADDING,
    ),
  }
}

export function RightRail() {
  const [selectedFile, setSelectedFile] = useState<GitFileStatus | null>(null)
  const [activeTab, setActiveTab] = useState<'files' | 'diff'>('files')
  const [bottomPanel, setBottomPanel] = useState<'issue' | 'processes' | 'github' | null>(null)
  const [filesMode, setFilesMode] = useState<'changes' | 'all'>('changes')
  const [wrapDiffContent, setWrapDiffContent] = useState(false)
  const [diffMenuOpen, setDiffMenuOpen] = useState(false)
  const [diffMenuPosition, setDiffMenuPosition] = useState<{ top: number; left: number } | null>(null)
  const [commitState, setCommitState] = useState<{ status: 'idle' | 'committing' | 'success' | 'error'; message: string | null }>({ status: 'idle', message: null })
  const [commitDialogOpen, setCommitDialogOpen] = useState(false)
  const [commitTitle, setCommitTitle] = useState('')
  const [commitSummary, setCommitSummary] = useState('')
  const diffMenuButtonRef = useRef<HTMLButtonElement>(null)

  const { data: status, isLoading: statusLoading, refetch: refetchStatus } = useGitStatus()
  const { data: allFiles, isLoading: filesLoading } = useGitFiles()
  const { activeRepo } = useRepos()
  const [activeDiffFile, setActiveDiffFile] = useState<GitFileStatus | null>(null)
  const { isLoading: diffLoading } = useGitRawContent(activeDiffFile?.path ?? null, 'WORKING')

  useEffect(() => {
    setSelectedFile(null)
    setActiveDiffFile(null)
    setActiveTab('files')
  }, [activeRepo?.id])

  const handleSelectFile = (file: GitFileStatus) => {
    setSelectedFile(file)
    setActiveDiffFile(file)
    setActiveTab('diff')
  }

  const handleBack = () => {
    setSelectedFile(null)
    setActiveDiffFile(null)
    setDiffMenuOpen(false)
    setActiveTab('files')
  }

  const handleCommit = async () => {
    if (!activeRepo || commitState.status === 'committing') return
    setCommitState({ status: 'committing', message: 'Committing changes…' })
    try {
      const result = await window.cranberri.git.commit(activeRepo.path, commitTitle, commitSummary)
      setCommitState({ status: 'success', message: `Committed ${result.hash.slice(0, 7)} · ${result.title}` })
      window.setTimeout(() => {
        setCommitState((state) => state.status === 'success' ? { status: 'idle', message: null } : state)
      }, 5000)
      setCommitDialogOpen(false)
      setCommitTitle('')
      setCommitSummary('')
      void refetchStatus()
    } catch (err) {
      setCommitState({ status: 'error', message: err instanceof Error ? err.message : 'Commit failed' })
    }
  }

  const openCommitDialog = () => {
    setCommitState({ status: 'idle', message: null })
    setCommitDialogOpen(true)
  }

  useLayoutEffect(() => {
    if (!diffMenuOpen) return
    setDiffMenuPosition(getDiffMenuPosition(diffMenuButtonRef.current))
  }, [diffMenuOpen])

  useEffect(() => {
    if (!diffMenuOpen) return undefined

    const close = (event: PointerEvent) => {
      const path = event.composedPath()
      if (path.some((node) => node instanceof HTMLElement && node.dataset.diffMenu === 'true')) return
      setDiffMenuOpen(false)
    }
    const reposition = () => setDiffMenuPosition(getDiffMenuPosition(diffMenuButtonRef.current))

    document.addEventListener('pointerdown', close)
    window.addEventListener('resize', reposition)
    window.addEventListener('scroll', reposition, true)
    return () => {
      document.removeEventListener('pointerdown', close)
      window.removeEventListener('resize', reposition)
      window.removeEventListener('scroll', reposition, true)
    }
  }, [diffMenuOpen])

  const diffMenu = diffMenuOpen && diffMenuPosition ? createPortal(
    <div
      data-diff-menu="true"
      className="fixed z-[1400] w-44 rounded-lg border border-app-border bg-app-surface p-1 text-xs shadow-2xl shadow-black/50"
      style={{ top: diffMenuPosition.top, left: diffMenuPosition.left }}
    >
      <button
        type="button"
        onClick={() => setWrapDiffContent((value) => !value)}
        className="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left hover:bg-app-surface-2"
      >
        <span>Wrap diff content</span>
        {wrapDiffContent && <Check className="h-3.5 w-3.5 text-app-accent" />}
      </button>
    </div>,
    document.body,
  ) : null

  const commitDialog = commitDialogOpen ? createPortal(
    <div className="fixed inset-0 z-[1500] flex items-center justify-center bg-black/60 px-4">
      <div className="w-full max-w-md rounded-xl border border-app-border bg-app-surface p-4 shadow-2xl shadow-black/60">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div>
            <div className="text-sm font-medium text-app-text">Commit changes</div>
            <div className="mt-1 text-[11px] text-app-text-muted">Stages all current changes and commits them.</div>
          </div>
          <button
            type="button"
            onClick={() => setCommitDialogOpen(false)}
            className="rounded p-1 text-app-text-muted hover:bg-app-surface-2 hover:text-app-text"
            title="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <label className="block text-[11px] font-medium uppercase tracking-wide text-app-text-muted">
          Title
          <input
            autoFocus
            value={commitTitle}
            onChange={(event) => setCommitTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) void handleCommit()
            }}
            className="mt-1 w-full rounded-lg border border-app-border bg-app-bg px-3 py-2 text-sm normal-case tracking-normal text-app-text outline-none focus:border-app-text-muted"
            placeholder="fix(git): commit from changes panel"
          />
        </label>
        <label className="mt-3 block text-[11px] font-medium uppercase tracking-wide text-app-text-muted">
          Summary
          <textarea
            value={commitSummary}
            onChange={(event) => setCommitSummary(event.target.value)}
            className="mt-1 h-24 w-full resize-none rounded-lg border border-app-border bg-app-bg px-3 py-2 text-sm normal-case tracking-normal text-app-text outline-none focus:border-app-text-muted"
            placeholder="Optional body explaining what changed."
          />
        </label>
        {commitState.message && (
          <div className={`mt-3 text-xs ${commitState.status === 'error' ? 'text-app-danger' : 'text-app-text-muted'}`}>{commitState.message}</div>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={() => setCommitDialogOpen(false)} className="rounded-lg bg-app-surface-2 px-3 py-1.5 text-xs text-app-text-muted hover:text-app-text">Cancel</button>
          <button
            type="button"
            onClick={() => void handleCommit()}
            disabled={!commitTitle.trim() || commitState.status === 'committing'}
            className="rounded-lg bg-app-surface-2 px-3 py-1.5 text-xs font-medium text-app-text hover:bg-app-border disabled:cursor-not-allowed disabled:opacity-40"
          >
            {commitState.status === 'committing' ? 'Committing…' : 'Commit'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  ) : null

  return (
    <div className="flex flex-col h-full bg-app-surface">
      {commitDialog}
      <div className="flex h-9 border-b border-app-border shrink-0">
        <TabButton active={activeTab === 'files'} onClick={() => setActiveTab('files')} icon={<FileText className="w-4 h-4" />} label="Files" />
        <TabButton active={activeTab === 'diff'} onClick={() => setActiveTab('diff')} icon={<FileDiff className="w-4 h-4" />} label="Diff" />
      </div>

      <div className={`${bottomPanel ? 'basis-1/2' : 'flex-1'} min-h-0 overflow-hidden relative`}>
        {activeTab === 'files' && (
          <div className="absolute inset-0 flex flex-col overflow-hidden">
            <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-app-border shrink-0">
              <span className="text-xs font-medium text-app-text-muted uppercase tracking-wider">{filesMode === 'changes' ? 'Changes' : 'All Files'}</span>
              <div className="flex items-center gap-1.5">
                {filesMode === 'changes' && (
                  <button
                    type="button"
                    onClick={openCommitDialog}
                    disabled={!activeRepo || !status?.length || commitState.status === 'committing'}
                    className="text-[10px] px-2 py-1 rounded bg-app-surface-2 text-app-text hover:bg-app-border disabled:cursor-not-allowed disabled:opacity-40"
                    title="Write a commit message and commit these changes"
                  >
                    {commitState.status === 'committing' ? 'Committing…' : 'Commit'}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setFilesMode((m) => (m === 'changes' ? 'all' : 'changes'))}
                  className="text-[10px] px-2 py-1 rounded bg-app-surface-2 hover:bg-app-border text-app-text"
                >
                  {filesMode === 'changes' ? 'Show all files' : 'Show changes'}
                </button>
              </div>
            </div>
            {commitState.message && filesMode === 'changes' && (
              <div className={`border-b border-app-border px-3 py-1.5 text-[11px] ${commitState.status === 'error' ? 'text-app-danger' : 'text-app-text-muted'}`}>
                {commitState.message}
              </div>
            )}
            <div className="flex-1 min-h-0 overflow-y-auto">
              {filesMode === 'changes' ? (
                <ChangeList
                  status={status}
                  statusLoading={statusLoading}
                  selectedFile={selectedFile}
                  onSelectFile={handleSelectFile}
                />
              ) : (
                <FileTree
                  nodes={allFiles}
                  isLoading={filesLoading}
                  selectedPath={selectedFile?.path ?? null}
                  onSelectFile={(path) => handleSelectFile({ path, status: 'tracked' })}
                />
              )}
            </div>
          </div>
        )}

        {activeTab === 'diff' && (
          <div className="absolute inset-0 flex flex-col overflow-hidden">
            {selectedFile ? (
              <div className="flex flex-col h-full">
                <div className="flex items-center gap-2 px-3 py-2 border-b border-app-border bg-app-surface-2 shrink-0">
                  <button type="button" onClick={handleBack} className="p-1 rounded hover:bg-app-surface">
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <span className="min-w-0 flex-1 truncate text-xs font-medium" title={selectedFile.path}>{selectedFile.path}</span>
                  <DiffStats filePath={selectedFile.path} status={selectedFile.status} />
                  <button
                    ref={diffMenuButtonRef}
                    type="button"
                    data-diff-menu="true"
                    onClick={() => setDiffMenuOpen((open) => !open)}
                    className={`ml-auto rounded p-1 text-app-text-muted hover:bg-app-surface hover:text-app-text ${diffMenuOpen ? 'bg-app-surface text-app-text' : ''}`}
                    title="Diff options"
                  >
                    <Menu className="w-4 h-4" />
                  </button>
                  {diffMenu}
                </div>
                <div className="flex-1 min-h-0 overflow-y-auto bg-app-bg p-0">
                  {diffLoading ? (
                    <div className="p-3 text-sm text-app-text-muted">Loading diff...</div>
                  ) : (
                    <DiffViewer filePath={selectedFile.path} status={selectedFile.status} wrapContent={wrapDiffContent} />
                  )}
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-sm text-app-text-muted p-4 text-center">
                <FileDiff className="w-8 h-8 mb-2 opacity-50" />
                Select a file from the Files tab to view its diff.
              </div>
            )}
          </div>
        )}

      </div>
      {bottomPanel && (
        <div className="basis-1/2 min-h-0 border-t border-app-border bg-app-bg">
          <div className="flex h-8 shrink-0 items-center border-b border-app-border bg-app-surface-2 px-3">
            <div className="flex items-center gap-2 text-xs font-medium text-app-text">
              {bottomPanel === 'issue' && <Ticket className="h-3.5 w-3.5 text-app-text-muted" />}
              {bottomPanel === 'processes' && <Activity className="h-3.5 w-3.5 text-app-text-muted" />}
              {bottomPanel === 'github' && <Github className="h-3.5 w-3.5 text-app-text-muted" />}
              <span>{bottomPanel === 'issue' ? 'Issue' : bottomPanel === 'processes' ? 'Processes' : 'GitHub'}</span>
            </div>
          </div>
          {bottomPanel === 'issue' ? (
            <div className="p-3 text-sm text-app-text-muted">
              No Linear issue linked.
            </div>
          ) : bottomPanel === 'processes' ? (
            <ProcessesPanel repoPath={activeRepo?.path ?? null} />
          ) : (
            <GitHubPanel repoPath={activeRepo?.path ?? null} />
          )}
        </div>
      )}
      <div className="flex h-10 shrink-0 items-center gap-1 border-t border-app-border px-3 text-[11px] text-app-text-muted">
        <button
          type="button"
          onClick={() => setBottomPanel((panel) => panel === 'issue' ? null : 'issue')}
          className={`rounded-lg p-2 hover:bg-app-surface-2 hover:text-app-text ${bottomPanel === 'issue' ? 'bg-app-surface-2 text-app-text' : 'text-app-text-muted'}`}
          title="Issue"
        >
          <Ticket className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => setBottomPanel((panel) => panel === 'processes' ? null : 'processes')}
          className={`rounded-lg p-2 hover:bg-app-surface-2 hover:text-app-text ${bottomPanel === 'processes' ? 'bg-app-surface-2 text-app-text' : 'text-app-text-muted'}`}
          title="Repo processes"
        >
          <Activity className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => setBottomPanel((panel) => panel === 'github' ? null : 'github')}
          className={`rounded-lg p-2 hover:bg-app-surface-2 hover:text-app-text ${bottomPanel === 'github' ? 'bg-app-surface-2 text-app-text' : 'text-app-text-muted'}`}
          title="GitHub"
        >
          <Github className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}

function GitHubPanel({ repoPath }: { repoPath: string | null }) {
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

  if (!repoPath) return <div className="p-3 text-sm text-app-text-muted">Select a repo for GitHub actions.</div>
  if (!summary) return <div className="p-3 text-xs text-app-text-muted">Reading GitHub remote…</div>
  if (!summary.isGitHub || !summary.webUrl) {
    return (
      <div className="p-3 text-sm text-app-text-muted">
        No GitHub remote detected for this repo.
        {summary.remoteUrl && <div className="mt-2 truncate font-mono text-[11px]" title={summary.remoteUrl}>{summary.remoteUrl}</div>}
      </div>
    )
  }

  const kinds: Array<{ kind: GitHubPanelKind; label: string; icon: React.ReactNode }> = [
    { kind: 'repo', label: 'Repo', icon: <Github className="h-3.5 w-3.5" /> },
    { kind: 'pulls', label: 'PRs', icon: <GitPullRequest className="h-3.5 w-3.5" /> },
    { kind: 'issues', label: 'Issues', icon: <CircleDot className="h-3.5 w-3.5" /> },
    { kind: 'actions', label: 'CI', icon: <PlayCircle className="h-3.5 w-3.5" /> },
    { kind: 'branches', label: 'Branches', icon: <GitBranch className="h-3.5 w-3.5" /> },
    { kind: 'commits', label: 'Commits', icon: <FileText className="h-3.5 w-3.5" /> },
    { kind: 'releases', label: 'Releases', icon: <UploadCloud className="h-3.5 w-3.5" /> },
  ]

  const open = (url?: string) => {
    if (url) void window.cranberri.openExternal(url)
  }

  return (
    <div className="h-[calc(100%-2rem)] overflow-y-auto p-3 text-xs">
      <div className="rounded-lg bg-app-surface p-3 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04)]">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate font-medium text-app-text">{summary.owner}/{summary.repo}</div>
            <div className="mt-1 truncate font-mono text-[10px] text-app-text-muted" title={summary.remoteUrl ?? undefined}>{summary.remoteUrl}</div>
          </div>
          <button type="button" onClick={() => open(summary.webUrl ?? undefined)} className="rounded-md p-1.5 text-app-text-muted hover:bg-app-surface-2 hover:text-app-text" title="Open repo on GitHub">
            <ExternalLink className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2 text-[10px] text-app-text-muted">
          <div className="rounded bg-app-bg p-2"><div>Branch</div><div className="truncate font-mono text-app-text" title={summary.branch ?? undefined}>{summary.branch ?? 'unknown'}</div></div>
          <div className="rounded bg-app-bg p-2"><div>Ahead</div><div className="font-mono text-app-text">{summary.ahead}</div></div>
          <div className="rounded bg-app-bg p-2"><div>Behind</div><div className="font-mono text-app-text">{summary.behind}</div></div>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-1">
        {kinds.map((item) => (
          <button
            key={item.kind}
            type="button"
            onClick={() => setActiveKind(item.kind)}
            className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-left transition ${activeKind === item.kind ? 'bg-app-surface-2 text-app-text' : 'bg-app-surface/70 text-app-text-muted hover:bg-app-surface-2 hover:text-app-text'}`}
          >
            {item.icon}
            <span>{item.label}</span>
          </button>
        ))}
      </div>

      <div className="mt-3 rounded-lg bg-app-surface/70 p-2">
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="text-[10px] uppercase tracking-wide text-app-text-muted">{activeKind}</span>
          <button type="button" onClick={() => setReloadKey((key) => key + 1)} className="text-[10px] text-app-text-muted hover:text-app-text">Refresh</button>
        </div>
        {loading && <div className="p-2 text-xs text-app-text-muted">Loading GitHub data via gh…</div>}
        {error && <div className="p-2 text-xs text-app-danger">{error}</div>}
        {!loading && !error && data?.items.length === 0 && <div className="p-2 text-xs text-app-text-muted">No {activeKind} found.</div>}
        <div className="space-y-1">
          {data?.items.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => open(item.url)}
              disabled={!item.url}
              className="w-full rounded-md bg-app-bg p-2 text-left transition hover:bg-app-surface-2 disabled:cursor-default disabled:hover:bg-app-bg"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 flex-1 truncate text-xs font-medium text-app-text" title={item.title}>{item.title}</span>
                {item.state && <span className="rounded bg-app-surface-2 px-1.5 py-0.5 text-[10px] uppercase text-app-text-muted">{item.state}</span>}
              </div>
              {item.subtitle && <div className="mt-1 truncate text-[10px] text-app-text-muted" title={item.subtitle}>{item.subtitle}</div>}
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-app-text-muted">
                {item.author && <span>@{item.author}</span>}
                {item.createdAt && <span>{new Date(item.createdAt).toLocaleString()}</span>}
                {item.meta && Object.entries(item.meta).map(([key, value]) => value !== null && value !== undefined ? <span key={key}>{key}: {String(value)}</span> : null)}
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

function ProcessesPanel({ repoPath }: { repoPath: string | null }) {
  const [processes, setProcesses] = useState<AgentProcessInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [terminatingId, setTerminatingId] = useState<string | null>(null)

  const handleTerminate = async (processInfo: AgentProcessInfo) => {
    if (!repoPath || terminatingId) return
    const command = processInfo.command || processInfo.id
    if (!window.confirm(`Terminate process "${command}" (pid ${processInfo.pid})?`)) return
    setTerminatingId(processInfo.id)
    setError(null)
    setProcesses((items) => items.filter((item) => item.id !== processInfo.id))
    try {
      await window.cranberri.processes.terminate(repoPath, processInfo.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to close process')
      const result = await window.cranberri.processes.list(repoPath)
      setProcesses(result.processes)
    } finally {
      setTerminatingId(null)
    }
  }

  useEffect(() => {
    if (!repoPath) {
      setProcesses([])
      return
    }

    let cancelled = false
    const load = async () => {
      setLoading(true)
      setError(null)
      try {
        const result = await window.cranberri.processes.list(repoPath)
        if (!cancelled) setProcesses(result.processes)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load processes')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load().catch((err) => setError(err instanceof Error ? err.message : 'Failed to load processes'))
    const interval = window.setInterval(() => {
      load().catch((err) => setError(err instanceof Error ? err.message : 'Failed to load processes'))
    }, 3000)

    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [repoPath])

  if (!repoPath) {
    return <div className="p-3 text-sm text-app-text-muted">Select a repo to inspect running processes.</div>
  }

  if (error) {
    return <div className="p-3 text-sm text-app-danger">{error}</div>
  }

  return (
    <div className="h-[calc(100%-2rem)] overflow-y-auto p-2">
      {loading && processes.length === 0 && <div className="p-2 text-xs text-app-text-muted">Scanning repo processes…</div>}
      {!loading && processes.length === 0 && <div className="p-2 text-xs text-app-text-muted">No running processes found for this repo.</div>}
      <div className="space-y-1">
        {processes.map((processInfo) => (
          <div
            key={processInfo.id}
            className="group flex w-full items-start gap-2 rounded-lg bg-app-surface/70 p-2 text-xs transition hover:bg-app-surface-2"
          >
            <button
              type="button"
              onClick={() => window.dispatchEvent(new CustomEvent('cranberri:open-process-terminal', { detail: { process: processInfo } }))}
              className="min-w-0 flex-1 text-left focus:outline-none focus:ring-1 focus:ring-app-accent"
              title="Open in terminal"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="rounded bg-app-surface-2 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-app-text-muted">{processInfo.kind}</span>
                <span className="text-[10px] text-app-text-muted">pid {processInfo.pid}</span>
              </div>
              <div className="mt-1 truncate font-mono text-[11px] text-app-text" title={processInfo.command}>{processInfo.command}</div>
              {processInfo.cwd && <div className="mt-1 truncate text-[10px] text-app-text-muted" title={processInfo.cwd}>{processInfo.cwd}</div>}
            </button>
            <button
              type="button"
              onClick={() => void handleTerminate(processInfo)}
              disabled={terminatingId === processInfo.id}
              className="rounded p-1 text-app-text-muted opacity-70 hover:bg-app-border hover:text-app-danger disabled:cursor-wait disabled:opacity-40 group-hover:opacity-100"
              title="Close process"
              aria-label="Close process"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

function TabButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  label: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 flex items-center justify-center gap-1.5 text-xs hover:text-app-text data-[state=active]:text-app-text data-[state=active]:bg-app-surface-2 ${
        active ? 'text-app-text bg-app-surface-2' : 'text-app-text-muted'
      }`}
    >
      {icon}
      {label}
    </button>
  )
}

function ChangeList({
  status,
  statusLoading,
  selectedFile,
  onSelectFile,
}: {
  status?: GitFileStatus[]
  statusLoading: boolean
  selectedFile: GitFileStatus | null
  onSelectFile: (file: GitFileStatus) => void
}) {
  if (statusLoading) {
    return <div className="p-3 text-sm text-app-text-muted">Loading changes...</div>
  }

  if (!status?.length) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-sm text-app-text-muted p-4 text-center">
        <FileText className="w-8 h-8 mb-2 opacity-50" />
        No changed files.
      </div>
    )
  }

  const tree = buildChangeTree(status)

  return (
    <ul className="p-2 text-sm">
      {tree.map((node) => (
        <ChangeTreeNode
          key={node.path}
          node={node}
          selectedPath={selectedFile?.path ?? null}
          onSelectFile={onSelectFile}
        />
      ))}
    </ul>
  )
}

interface ChangeTreeNodeData {
  name: string
  path: string
  children: ChangeTreeNodeData[]
  file: GitFileStatus | null
  statuses: Set<GitFileStatus['status']>
  childrenByName: Map<string, ChangeTreeNodeData>
}

function buildChangeTree(files: GitFileStatus[]): ChangeTreeNodeData[] {
  const root = new Map<string, ChangeTreeNodeData>()

  const getNode = (siblings: Map<string, ChangeTreeNodeData>, name: string, path: string) => {
    let node = siblings.get(name)
    if (!node) {
      node = { name, path, children: [], file: null, statuses: new Set(), childrenByName: new Map() }
      siblings.set(name, node)
    }
    return node
  }

  for (const file of files) {
    const parts = file.path.split('/').filter(Boolean)
    let siblings = root

    for (let index = 0; index < parts.length; index += 1) {
      const name = parts[index]
      const path = parts.slice(0, index + 1).join('/')
      const current = getNode(siblings, name, path)
      current.statuses.add(file.status)

      if (index === parts.length - 1) {
        current.file = file
      } else {
        siblings = current.childrenByName
      }
    }
  }

  const sortNodes = (nodes: ChangeTreeNodeData[]): ChangeTreeNodeData[] => nodes
    .map((node) => ({ ...node, children: sortNodes([...node.childrenByName.values()]) }))
    .sort((a, b) => {
      if (Boolean(a.file) === Boolean(b.file)) return a.name.localeCompare(b.name)
      return a.file ? 1 : -1
    })

  return sortNodes([...root.values()])
}

function countChangedFiles(node: ChangeTreeNodeData): number {
  if (node.file) return 1
  return node.children.reduce((total, child) => total + countChangedFiles(child), 0)
}

function statusRank(statuses: Set<GitFileStatus['status']>): GitFileStatus['status'] {
  const order: GitFileStatus['status'][] = ['conflict', 'deleted', 'renamed', 'modified', 'added', 'untracked', 'staged', 'tracked']
  return order.find((status) => statuses.has(status)) ?? 'tracked'
}

function ChangeTreeNode({
  node,
  selectedPath,
  onSelectFile,
  depth = 0,
}: {
  node: ChangeTreeNodeData
  selectedPath: string | null
  onSelectFile: (file: GitFileStatus) => void
  depth?: number
}) {
  const [expanded, setExpanded] = useState(depth < 2 || node.children.length <= 4)

  if (node.file) {
    return (
      <li>
        <button
          type="button"
          onClick={() => onSelectFile(node.file!)}
          className={`group flex w-full items-center gap-2 rounded-md py-1.5 pr-2 text-left transition hover:bg-app-surface-2/70 ${
            selectedPath === node.path ? 'bg-app-surface-2' : ''
          }`}
          style={{ paddingLeft: `${8 + depth * 14}px` }}
          title={node.path}
        >
          <FileText className="h-3.5 w-3.5 shrink-0 text-app-text-muted group-hover:text-app-text" />
          <span className="min-w-0 flex-1 truncate text-[13px] text-app-text">{node.name}</span>
          <span className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] uppercase tracking-wide ${statusColor(node.file.status)}`}>{node.file.status}</span>
        </button>
      </li>
    )
  }

  const badgeStatus = statusRank(node.statuses)

  return (
    <li>
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="group flex w-full items-center gap-1.5 rounded-md py-1.5 pr-2 text-left text-app-text-muted transition hover:bg-app-surface-2/60 hover:text-app-text"
        style={{ paddingLeft: `${8 + depth * 14}px` }}
        title={node.path}
      >
        <ChevronRight className={`h-3 w-3 shrink-0 transition-transform ${expanded ? 'rotate-90' : ''}`} />
        <Folder className="h-3.5 w-3.5 shrink-0 text-app-accent/80" />
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-app-text">{node.name}</span>
        <span className="rounded bg-app-surface-2 px-1.5 py-0.5 text-[10px] tabular-nums text-app-text-muted">{countChangedFiles(node)}</span>
        <span className={`h-1.5 w-1.5 rounded-full ${statusColor(badgeStatus).split(' ')[1]}`} />
      </button>
      {expanded && node.children.length > 0 && (
        <ul>
          {node.children.map((child) => (
            <ChangeTreeNode
              key={child.path}
              node={child}
              selectedPath={selectedPath}
              onSelectFile={onSelectFile}
              depth={depth + 1}
            />
          ))}
        </ul>
      )}
    </li>
  )
}

function FileTree({
  nodes,
  isLoading,
  selectedPath,
  onSelectFile,
  depth = 0,
}: {
  nodes?: FileTreeNode[]
  isLoading: boolean
  selectedPath: string | null
  onSelectFile: (path: string) => void
  depth?: number
}) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())

  if (isLoading) {
    return <div className="p-3 text-sm text-app-text-muted">Loading files...</div>
  }

  if (!nodes?.length) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-sm text-app-text-muted p-4 text-center">
        <Folder className="w-8 h-8 mb-2 opacity-50" />
        No files found.
      </div>
    )
  }

  const toggle = (path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  const sorted = [...nodes].sort((a, b) => {
    if (a.type === b.type) return a.path.localeCompare(b.path)
    return a.type === 'dir' ? -1 : 1
  })

  return (
    <ul className="text-sm">
      {sorted.map((node) => {
        const name = node.path.split('/').pop() ?? node.path
        const isExpanded = expanded.has(node.path)
        if (node.type === 'dir') {
          return (
            <li key={node.path}>
              <button
                type="button"
                onClick={() => toggle(node.path)}
                className="flex items-center gap-1 w-full px-3 py-1 hover:bg-app-surface-2/50 text-left"
                style={{ paddingLeft: `${12 + depth * 16}px` }}
              >
                {isExpanded ? <ChevronRight className="w-3 h-3 rotate-90" /> : <ChevronRight className="w-3 h-3" />}
                <Folder className="w-3.5 h-3.5 text-app-text-muted" />
                <span>{name}</span>
              </button>
              {isExpanded && (
                <FileTree
                  nodes={node.children}
                  isLoading={false}
                  selectedPath={selectedPath}
                  onSelectFile={onSelectFile}
                  depth={depth + 1}
                />
              )}
            </li>
          )
        }
        return (
          <li
            key={node.path}
            onClick={() => onSelectFile(node.path)}
            className={`px-3 py-1 cursor-pointer hover:bg-app-surface-2/50 truncate ${
              selectedPath === node.path ? 'bg-app-surface-2' : ''
            }`}
            style={{ paddingLeft: `${12 + depth * 16}px` }}
            title={node.path}
          >
            {name}
          </li>
        )
      })}
    </ul>
  )
}

function DiffViewer({
  filePath,
  status,
  wrapContent,
}: {
  filePath: string
  status: GitFileStatus['status']
  wrapContent: boolean
}) {
  const { data: oldContent, isLoading: oldLoading } = useGitRawContent(
    status === 'added' || status === 'untracked' ? null : filePath,
    'HEAD',
  )
  const { data: newContent, isLoading: newLoading } = useGitRawContent(filePath, 'WORKING')

  if (oldLoading || newLoading) {
    return <div className="p-3 text-sm text-app-text-muted">Loading diff...</div>
  }

  return (
    <div className={`cranberri-diff-viewer h-full overflow-auto text-xs ${wrapContent ? 'wrap-diff-content' : ''}`}>
      <ReactDiffViewer
        oldValue={oldContent ?? ''}
        newValue={newContent ?? ''}
        splitView={false}
        showDiffOnly={false}
        hideLineNumbers
        hideSummary
        disableWordDiff
        styles={{
          variables: {
            light: {
              diffViewerBackground: 'var(--app-bg)',
              diffViewerColor: 'var(--app-text)',
              diffViewerTitleBackground: 'var(--app-surface-2)',
              diffViewerTitleColor: 'var(--app-text)',
              diffViewerTitleBorderColor: 'var(--app-border)',
              addedBackground: 'rgba(34, 197, 94, 0.12)',
              addedColor: 'var(--app-text)',
              removedBackground: 'rgba(239, 68, 68, 0.12)',
              removedColor: 'var(--app-text)',
              changedBackground: 'transparent',
              gutterColor: 'var(--app-text-muted)',
              codeFoldBackground: 'var(--app-surface-2)',
              codeFoldGutterBackground: 'var(--app-surface-2)',
            },
          },
          diffContainer: {
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
            borderRadius: 0,
            border: 'none',
            width: '100%',
            tableLayout: 'fixed',
          },
          line: {
            minHeight: '20px',
          },
          marker: {
            width: '24px',
            minWidth: '24px',
            paddingLeft: '8px',
            paddingRight: '6px',
          },
          content: {
            width: '100%',
            paddingLeft: '12px',
          },
          contentText: {
            whiteSpace: wrapContent ? 'pre-wrap' : 'pre',
            wordBreak: wrapContent ? 'break-word' : 'normal',
            overflowWrap: wrapContent ? 'anywhere' : 'normal',
            lineBreak: wrapContent ? 'anywhere' : 'auto',
          },
          codeFold: {
            backgroundColor: 'var(--app-surface-2)',
            color: 'var(--app-text-muted)',
          },
        }}
      />
    </div>
  )
}

function DiffStats({ filePath }: { filePath: string; status: GitFileStatus['status'] }) {
  const { data: fileDiff } = useGitDiffForFile(filePath)
  if (!fileDiff?.files.length) return null
  const { additions, deletions } = fileDiff.files[0]
  if (additions === 0 && deletions === 0) return null
  return (
    <div className="ml-auto flex items-center gap-2 text-[10px] font-medium">
      {additions > 0 && <span className="text-green-400">+{additions}</span>}
      {deletions > 0 && <span className="text-red-400">−{deletions}</span>}
    </div>
  )
}
