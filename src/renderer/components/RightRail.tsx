import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ChevronLeft, FileDiff, Menu } from 'lucide-react'
import { useGitStatus, useGitFiles, useGitRawContent } from '../state/git'
import { useRepos } from '../state/repos'
import { ChangeList } from './right-rail/ChangeList'
import { CommitDialog, type CommitState } from './right-rail/CommitDialog'
import { DiffOptionsMenu } from './right-rail/DiffOptionsMenu'
import { DiffStats, DiffViewer, preloadDiffRenderer } from './right-rail/DiffViewer'
import { FileTree } from './right-rail/FileTree'
import {
  BottomPanelContent,
  BottomPanelNav,
  RightRailTabs,
  type BottomPanelKind,
  type RightRailTab,
} from './right-rail/RailShell'
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
  const [activeTab, setActiveTab] = useState<RightRailTab>('files')
  const [bottomPanel, setBottomPanel] = useState<BottomPanelKind | null>(null)
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
    preloadDiffRenderer()
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
      <RightRailTabs activeTab={activeTab} onSelectTab={setActiveTab} />

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
      {bottomPanel && <BottomPanelContent bottomPanel={bottomPanel} repoPath={activeRepo?.path ?? null} />}
      <BottomPanelNav bottomPanel={bottomPanel} onTogglePanel={(panel) => setBottomPanel((current) => current === panel ? null : panel)} />
    </div>
  )
}
