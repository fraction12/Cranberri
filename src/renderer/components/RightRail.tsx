import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import ReactDiffViewer from 'react-diff-viewer-continued'
import { Activity, Check, FileDiff, FileText, Ticket, ChevronLeft, Folder, ChevronRight, Menu } from 'lucide-react'
import { useGitStatus, useGitDiffForFile, useGitFiles, useGitRawContent } from '../state/git'
import { useRepos } from '../state/repos'
import type { GitFileStatus, FileTreeNode } from '@/shared/git'
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
  const [bottomPanel, setBottomPanel] = useState<'issue' | 'processes' | null>(null)
  const [filesMode, setFilesMode] = useState<'changes' | 'all'>('changes')
  const [wrapDiffContent, setWrapDiffContent] = useState(false)
  const [diffMenuOpen, setDiffMenuOpen] = useState(false)
  const [diffMenuPosition, setDiffMenuPosition] = useState<{ top: number; left: number } | null>(null)
  const diffMenuButtonRef = useRef<HTMLButtonElement>(null)

  const { data: status, isLoading: statusLoading } = useGitStatus()
  const { data: allFiles, isLoading: filesLoading } = useGitFiles()
  const { activeRepo } = useRepos()
  const [activeDiffFile, setActiveDiffFile] = useState<GitFileStatus | null>(null)
  const { isLoading: diffLoading } = useGitRawContent(activeDiffFile?.path ?? null, 'WORKING')

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

  return (
    <div className="flex flex-col h-full bg-app-surface">
      <div className="flex h-9 border-b border-app-border shrink-0">
        <TabButton active={activeTab === 'files'} onClick={() => setActiveTab('files')} icon={<FileText className="w-4 h-4" />} label="Files" />
        <TabButton active={activeTab === 'diff'} onClick={() => setActiveTab('diff')} icon={<FileDiff className="w-4 h-4" />} label="Diff" />
      </div>

      <div className={`${bottomPanel ? 'basis-1/2' : 'flex-1'} min-h-0 overflow-hidden relative`}>
        {activeTab === 'files' && (
          <div className="absolute inset-0 flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2 border-b border-app-border shrink-0">
              <span className="text-xs font-medium text-app-text-muted uppercase tracking-wider">{filesMode === 'changes' ? 'Changes' : 'All Files'}</span>
              <button
                type="button"
                onClick={() => setFilesMode((m) => (m === 'changes' ? 'all' : 'changes'))}
                className="text-[10px] px-2 py-1 rounded bg-app-surface-2 hover:bg-app-border text-app-text"
              >
                {filesMode === 'changes' ? 'Show all files' : 'Show changes'}
              </button>
            </div>
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
              {bottomPanel === 'issue' ? <Ticket className="h-3.5 w-3.5 text-app-text-muted" /> : <Activity className="h-3.5 w-3.5 text-app-text-muted" />}
              <span>{bottomPanel === 'issue' ? 'Issue' : 'Processes'}</span>
            </div>
          </div>
          {bottomPanel === 'issue' ? (
            <div className="p-3 text-sm text-app-text-muted">
              No Linear issue linked.
            </div>
          ) : (
            <ProcessesPanel repoPath={activeRepo?.path ?? null} />
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
      </div>
    </div>
  )
}

function ProcessesPanel({ repoPath }: { repoPath: string | null }) {
  const [processes, setProcesses] = useState<AgentProcessInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
          <div key={processInfo.pid} className="rounded-lg bg-app-surface/70 p-2 text-xs">
            <div className="flex items-center justify-between gap-2">
              <span className="rounded bg-app-surface-2 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-app-text-muted">{processInfo.kind}</span>
              <span className="text-[10px] text-app-text-muted">pid {processInfo.pid}</span>
            </div>
            <div className="mt-1 truncate font-mono text-[11px] text-app-text" title={processInfo.command}>{processInfo.command}</div>
            {processInfo.cwd && <div className="mt-1 truncate text-[10px] text-app-text-muted" title={processInfo.cwd}>{processInfo.cwd}</div>}
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

  return (
    <ul className="divide-y divide-app-border">
      {status.map((file) => (
        <li
          key={file.path}
          onClick={() => onSelectFile(file)}
          className={`flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-app-surface-2/50 ${
            selectedFile?.path === file.path ? 'bg-app-surface-2' : ''
          }`}
        >
          <span className="text-sm truncate flex-1 pr-2" title={file.path}>{file.path}</span>
          <span className={`text-[10px] uppercase px-1.5 py-0.5 rounded ${statusColor(file.status)}`}>{file.status}</span>
        </li>
      ))}
    </ul>
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
