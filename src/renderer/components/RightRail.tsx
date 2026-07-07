import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import ReactDiffViewer from 'react-diff-viewer-continued'
import { Activity, FileDiff, FileText, Github, Ticket, ChevronLeft, Menu } from 'lucide-react'
import { useGitStatus, useGitDiffForFile, useGitFiles, useGitRawContent } from '../state/git'
import { useRepos } from '../state/repos'
import { ChangeList } from './right-rail/ChangeList'
import { CommitDialog, type CommitState } from './right-rail/CommitDialog'
import { DiffOptionsMenu } from './right-rail/DiffOptionsMenu'
import { FileTree } from './right-rail/FileTree'
import { GitHubPanel } from './right-rail/GitHubPanel'
import { ProcessesPanel } from './right-rail/ProcessesPanel'
import type { GitFileStatus } from '@/shared/git'

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
  const [commitState, setCommitState] = useState<CommitState>({ status: 'idle', message: null })
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

  return (
    <div className="flex flex-col h-full bg-app-surface">
      {commitDialogOpen && (
        <CommitDialog
          title={commitTitle}
          summary={commitSummary}
          commitState={commitState}
          onClose={() => setCommitDialogOpen(false)}
          onTitleChange={setCommitTitle}
          onSummaryChange={setCommitSummary}
          onCommit={() => void handleCommit()}
        />
      )}
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
                  {diffMenuOpen && diffMenuPosition && (
                    <DiffOptionsMenu
                      position={diffMenuPosition}
                      wrapContent={wrapDiffContent}
                      onToggleWrapContent={() => setWrapDiffContent((value) => !value)}
                    />
                  )}
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
