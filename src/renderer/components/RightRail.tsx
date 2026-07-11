import { lazy, Suspense, type FormEvent, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ChevronLeft, Copy, ExternalLink, FileDiff, FolderOpen, Hash, Loader2, Menu, MessageSquare, Search } from 'lucide-react'
import { useGitStatus, useGitFiles } from '../state/git'
import { useCodexThreads } from '../state/codex'
import { useRepos } from '../state/repos'
import { ChangeList } from './right-rail/ChangeList'
import { AgentsPanel } from './right-rail/AgentsPanel'
import { CommitDialog, type CommitDraftState, type CommitState } from './right-rail/CommitDialog'
import { DiffOptionsMenu } from './right-rail/DiffOptionsMenu'
import { DiffStats } from './right-rail/DiffStats'
import { FileTree } from './right-rail/FileTree'
import { createRightRailActiveFileEvent } from './right-rail/right-rail-active-file-events'
import { OPEN_RIGHT_RAIL_COMMAND_EVENT, rightRailCommandFromEvent } from './right-rail/right-rail-command-events'
import { OPEN_RIGHT_RAIL_FILE_EVENT, rightRailFileFromEvent } from './right-rail/right-rail-file-events'
import { createSendChatContextEvent } from './chat/chat-context-events'
import { createRepoFileContextCapturedEvent } from './repo-file-context-events'
import { repoFileChatContext } from './repo-chat-context'
import { repoAbsolutePath } from '../lib/repo-path'
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
const DiffViewer = lazy(() => import('./right-rail/DiffViewer').then((module) => ({ default: module.DiffViewer })))

function preloadDiffRenderer(): void {
  void import('./right-rail/DiffViewer').then((module) => module.preloadDiffRenderer())
}

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

export function RightRail({ onOpenToolsSettings }: { onOpenToolsSettings: () => void }) {
  const [selectedFile, setSelectedFile] = useState<GitFileStatus | null>(null)
  const [activeTab, setActiveTab] = useState<RightRailTab>('files')
  const [bottomPanel, setBottomPanel] = useState<BottomPanelKind | null>(null)
  const [filesMode, setFilesMode] = useState<'changes' | 'all'>('changes')
  const [wrapDiffContent, setWrapDiffContent] = useState(false)
  const [diffMenuOpen, setDiffMenuOpen] = useState(false)
  const [diffMenuPosition, setDiffMenuPosition] = useState<{ top: number; left: number } | null>(null)
  const [commitState, setCommitState] = useState<CommitState>({ status: 'idle', message: null })
  const [commitDraftState, setCommitDraftState] = useState<CommitDraftState>({ status: 'idle', message: null })
  const [commitDialogOpen, setCommitDialogOpen] = useState(false)
  const [commitTitle, setCommitTitle] = useState('')
  const [commitSummary, setCommitSummary] = useState('')
  const [selectedLine, setSelectedLine] = useState<number | null>(null)
  const [contextState, setContextState] = useState<{ status: 'idle' | 'sending' | 'error'; message: string | null }>({ status: 'idle', message: null })
  const [editorSearchRequest, setEditorSearchRequest] = useState(0)
  const [lineDialogOpen, setLineDialogOpen] = useState(false)
  const [lineInput, setLineInput] = useState('1')
  const [lineError, setLineError] = useState<string | null>(null)
  const diffMenuButtonRef = useRef<HTMLButtonElement>(null)

  const showChanges = activeTab === 'files' && filesMode === 'changes'
  const showAllFiles = activeTab === 'files' && filesMode === 'all'
  const { data: status, isLoading: statusLoading, refetch: refetchStatus } = useGitStatus(showChanges || commitDialogOpen)
  const { data: allFiles, isLoading: filesLoading } = useGitFiles(showAllFiles)
  const { activeRepo } = useRepos()
  const { activeThread } = useCodexThreads()
  const agentCount = activeThread?.workers?.length ?? 0

  useEffect(() => {
    setSelectedFile(null)
    setSelectedLine(null)
    setEditorSearchRequest(0)
    setLineDialogOpen(false)
    setActiveTab('files')
  }, [activeRepo?.id])

  const handleSelectFile = useCallback((file: GitFileStatus, line?: number) => {
    preloadDiffRenderer()
    setSelectedFile(file)
    setSelectedLine(line ?? null)
    setEditorSearchRequest(0)
    setLineDialogOpen(false)
    setActiveTab('diff')
  }, [])

  useEffect(() => {
    const onOpenFile = (event: Event) => {
      const request = rightRailFileFromEvent(event)
      if (request) handleSelectFile(request.file, request.line)
    }
    window.addEventListener(OPEN_RIGHT_RAIL_FILE_EVENT, onOpenFile)
    return () => window.removeEventListener(OPEN_RIGHT_RAIL_FILE_EVENT, onOpenFile)
  }, [handleSelectFile])

  const handleBack = () => {
    setSelectedFile(null)
    setSelectedLine(null)
    setEditorSearchRequest(0)
    setDiffMenuOpen(false)
    setLineDialogOpen(false)
    setContextState({ status: 'idle', message: null })
    setActiveTab('files')
  }

  const sendSelectedFileToChat = useCallback(async () => {
    if (!activeRepo || !selectedFile || contextState.status === 'sending') return
    setContextState({ status: 'sending', message: 'Sending file context…' })
    try {
      const shouldReadWorking = selectedFile.status !== 'deleted'
      const shouldReadHead = selectedFile.status !== 'added' && selectedFile.status !== 'untracked'
      const [diff, workingContent, headContent] = await Promise.all([
        selectedFile.status === 'tracked'
          ? Promise.resolve(null)
          : window.cranberri.git.diffFile(activeRepo.path, selectedFile.path),
        shouldReadWorking
          ? window.cranberri.git.rawContent(activeRepo.path, selectedFile.path, 'WORKING')
          : Promise.resolve(''),
        shouldReadHead
          ? window.cranberri.git.rawContent(activeRepo.path, selectedFile.path, 'HEAD')
          : Promise.resolve(''),
      ])
      const context = {
        repoPath: activeRepo.path,
        file: selectedFile,
        workingContent,
        headContent,
        diff,
      }
      window.dispatchEvent(createRepoFileContextCapturedEvent(context))
      window.dispatchEvent(createSendChatContextEvent({
        text: repoFileChatContext(context),
      }))
      setContextState({ status: 'idle', message: 'File context sent to chat' })
      window.setTimeout(() => {
        setContextState((state) => state.message === 'File context sent to chat' ? { status: 'idle', message: null } : state)
      }, 3000)
    } catch (error) {
      setContextState({ status: 'error', message: error instanceof Error ? error.message : 'Failed to send file context' })
    }
  }, [activeRepo, contextState.status, selectedFile])

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
      setCommitDraftState({ status: 'idle', message: null })
      void refetchStatus()
    } catch (err) {
      setCommitState({ status: 'error', message: err instanceof Error ? err.message : 'Commit failed' })
    }
  }

  const openCommitDialog = useCallback(() => {
    setCommitState({ status: 'idle', message: null })
    setCommitDraftState({ status: 'idle', message: null })
    setCommitDialogOpen(true)
  }, [])

  const draftCommitMessage = useCallback(async () => {
    if (!activeRepo || commitDraftState.status === 'drafting' || commitState.status === 'committing') return
    setCommitDialogOpen(true)
    setCommitDraftState({ status: 'drafting', message: 'Drafting commit message…' })
    setCommitState({ status: 'idle', message: null })
    try {
      const draft = await window.cranberri.git.draftCommitMessage(activeRepo.path)
      setCommitTitle(draft.title)
      setCommitSummary(draft.summary)
      setCommitDraftState({ status: 'idle', message: 'Drafted from current changes' })
      window.setTimeout(() => {
        setCommitDraftState((state) => state.message === 'Drafted from current changes' ? { status: 'idle', message: null } : state)
      }, 3000)
    } catch (error) {
      setCommitDraftState({ status: 'error', message: error instanceof Error ? error.message : 'Failed to draft commit message' })
    }
  }, [activeRepo, commitDraftState.status, commitState.status])

  const copySelectedFilePath = useCallback(async () => {
    if (!selectedFile) return
    await navigator.clipboard.writeText(selectedFile.path)
    setContextState({ status: 'idle', message: 'File path copied' })
    window.setTimeout(() => {
      setContextState((state) => state.message === 'File path copied' ? { status: 'idle', message: null } : state)
    }, 2500)
  }, [selectedFile])

  const copySelectedFileContent = useCallback(async () => {
    if (!activeRepo || !selectedFile) return
    try {
      const ref = selectedFile.status === 'deleted' ? 'HEAD' : 'WORKING'
      const content = await window.cranberri.git.rawContent(activeRepo.path, selectedFile.path, ref)
      await navigator.clipboard.writeText(content)
      setContextState({ status: 'idle', message: 'File content copied' })
      window.setTimeout(() => {
        setContextState((state) => state.message === 'File content copied' ? { status: 'idle', message: null } : state)
      }, 2500)
    } catch (error) {
      setContextState({ status: 'error', message: error instanceof Error ? error.message : 'Failed to copy file content' })
    }
  }, [activeRepo, selectedFile])

  const focusSelectedFileLine = useCallback((line: number) => {
    if (!selectedFile || selectedFile.status !== 'tracked') return
    if (!Number.isFinite(line) || line < 1) return
    const nextLine = Math.floor(line)
    setSelectedLine(nextLine)
    setActiveTab('diff')
    setContextState({ status: 'idle', message: `Focused line ${nextLine}` })
    window.setTimeout(() => {
      setContextState((state) => state.message === `Focused line ${nextLine}` ? { status: 'idle', message: null } : state)
    }, 2500)
  }, [selectedFile])

  const openGoToLineDialog = useCallback(() => {
    if (!selectedFile || selectedFile.status !== 'tracked') return
    setLineInput(selectedLine ? String(selectedLine) : '1')
    setLineError(null)
    setLineDialogOpen(true)
    setActiveTab('diff')
  }, [selectedFile, selectedLine])

  const submitGoToLine = useCallback((event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const line = Number.parseInt(lineInput, 10)
    if (!Number.isFinite(line) || line < 1) {
      setLineError('Enter a line number greater than 0')
      return
    }
    setLineDialogOpen(false)
    setLineError(null)
    focusSelectedFileLine(line)
  }, [focusSelectedFileLine, lineInput])

  const copySelectedFileAbsolutePath = useCallback(async () => {
    if (!activeRepo || !selectedFile || selectedFile.status === 'deleted') return
    try {
      await navigator.clipboard.writeText(repoAbsolutePath(activeRepo.path, selectedFile.path))
      setContextState({ status: 'idle', message: 'Absolute file path copied' })
      window.setTimeout(() => {
        setContextState((state) => state.message === 'Absolute file path copied' ? { status: 'idle', message: null } : state)
      }, 2500)
    } catch (error) {
      setContextState({ status: 'error', message: error instanceof Error ? error.message : 'Failed to copy absolute file path' })
    }
  }, [activeRepo, selectedFile])

  const openSelectedFileExternal = useCallback(async () => {
    if (!activeRepo || !selectedFile || selectedFile.status === 'deleted') return
    try {
      await window.cranberri.openPath(repoAbsolutePath(activeRepo.path, selectedFile.path))
      setContextState({ status: 'idle', message: 'File opened' })
      window.setTimeout(() => {
        setContextState((state) => state.message === 'File opened' ? { status: 'idle', message: null } : state)
      }, 2500)
    } catch (error) {
      setContextState({ status: 'error', message: error instanceof Error ? error.message : 'Failed to open file' })
    }
  }, [activeRepo, selectedFile])

  const revealSelectedFile = useCallback(async () => {
    if (!activeRepo || !selectedFile || selectedFile.status === 'deleted') return
    try {
      await window.cranberri.revealPath(repoAbsolutePath(activeRepo.path, selectedFile.path))
      setContextState({ status: 'idle', message: 'File revealed' })
      window.setTimeout(() => {
        setContextState((state) => state.message === 'File revealed' ? { status: 'idle', message: null } : state)
      }, 2500)
    } catch (error) {
      setContextState({ status: 'error', message: error instanceof Error ? error.message : 'Failed to reveal file' })
    }
  }, [activeRepo, selectedFile])

  useEffect(() => {
    window.dispatchEvent(createRightRailActiveFileEvent(selectedFile))
  }, [selectedFile])

  useEffect(() => {
    const onOpenRailCommand = (event: Event) => {
      const command = rightRailCommandFromEvent(event)
      if (!command) return
      if (command.filesMode) setFilesMode(command.filesMode)
      if (command.selectedFileCommand === 'search') {
        if (selectedFile?.status === 'tracked') setEditorSearchRequest((request) => request + 1)
      } else if (command.selectedFileCommand === 'go-to-line') {
        if (command.selectedFileLine) {
          focusSelectedFileLine(command.selectedFileLine)
        } else {
          openGoToLineDialog()
        }
      } else if (command.selectedFileCommand === 'send-context') {
        void sendSelectedFileToChat()
      } else if (command.selectedFileCommand === 'copy-path') {
        void copySelectedFilePath()
      } else if (command.selectedFileCommand === 'copy-content') {
        void copySelectedFileContent()
      }
      if (command.action === 'open-commit') {
        setFilesMode('changes')
        openCommitDialog()
      } else if (command.action === 'open-commit-draft') {
        setFilesMode('changes')
        openCommitDialog()
        void draftCommitMessage()
      }
      if (command.tab) {
        setActiveTab(command.tab)
          if (command.tab === 'files') {
            setSelectedFile(null)
            setSelectedLine(null)
            setDiffMenuOpen(false)
            setLineDialogOpen(false)
            setContextState({ status: 'idle', message: null })
          } else if (command.tab === 'diff') {
          preloadDiffRenderer()
        }
      }
      if ('bottomPanel' in command) setBottomPanel(command.bottomPanel ?? null)
    }
    window.addEventListener(OPEN_RIGHT_RAIL_COMMAND_EVENT, onOpenRailCommand)
    return () => window.removeEventListener(OPEN_RIGHT_RAIL_COMMAND_EVENT, onOpenRailCommand)
  }, [copySelectedFileContent, copySelectedFilePath, draftCommitMessage, focusSelectedFileLine, openCommitDialog, openGoToLineDialog, selectedFile?.status, sendSelectedFileToChat])

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
          draftState={commitDraftState}
          canDraft={Boolean(activeRepo && status?.length)}
          onClose={() => setCommitDialogOpen(false)}
          onTitleChange={setCommitTitle}
          onSummaryChange={setCommitSummary}
          onDraft={() => void draftCommitMessage()}
          onCommit={() => void handleCommit()}
        />
      )}
      <RightRailTabs activeTab={activeTab} agentCount={agentCount} onSelectTab={setActiveTab} />

      <div className={`${bottomPanel ? 'basis-1/2' : 'flex-1'} min-h-0 overflow-hidden relative`}>
        {activeTab === 'files' && (
          <div id="right-rail-files-panel" role="tabpanel" aria-labelledby="right-rail-files-tab" className="absolute inset-0 flex flex-col overflow-hidden">
            <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-app-border shrink-0">
              <span className="text-xs font-medium text-app-text-muted uppercase">{filesMode === 'changes' ? 'Changes' : 'All Files'}</span>
              <div className="flex items-center gap-1.5">
                {filesMode === 'changes' && (
                  <button
                    type="button"
                    onClick={openCommitDialog}
                    disabled={!activeRepo || !status?.length || commitState.status === 'committing'}
                    className="text-micro px-2 py-1 rounded bg-app-surface-2 text-app-text hover:bg-app-border disabled:cursor-not-allowed disabled:opacity-40"
                    title="Write a commit message and commit these changes"
                  >
                    {commitState.status === 'committing' ? 'Committing…' : 'Commit'}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setFilesMode((m) => (m === 'changes' ? 'all' : 'changes'))}
                  className="text-micro px-2 py-1 rounded bg-app-surface-2 hover:bg-app-border text-app-text"
                >
                  {filesMode === 'changes' ? 'Show all files' : 'Show changes'}
                </button>
              </div>
            </div>
            {commitState.message && filesMode === 'changes' && (
              <div className={`border-b border-app-border px-3 py-1.5 text-caption ${commitState.status === 'error' ? 'text-app-danger' : 'text-app-text-muted'}`}>
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
          <div id="right-rail-diff-panel" role="tabpanel" aria-labelledby="right-rail-diff-tab" className="absolute inset-0 flex flex-col overflow-hidden">
            {selectedFile ? (
              <div className="flex flex-col h-full">
                <div className="flex items-center gap-2 px-3 py-2 border-b border-app-border bg-app-surface-2 shrink-0">
                  <button type="button" onClick={handleBack} className="p-1 rounded hover:bg-app-surface">
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <span className="min-w-0 flex-1 truncate text-xs font-medium" title={selectedFile.path}>{selectedFile.path}</span>
                  <DiffStats filePath={selectedFile.path} />
                  {selectedFile.status === 'tracked' && (
                    <>
                      <button
                        type="button"
                        onClick={() => setEditorSearchRequest((request) => request + 1)}
                        className="rounded p-1 text-app-text-muted hover:bg-app-surface hover:text-app-text"
                        title="Search selected file"
                        aria-label="Search selected file"
                      >
                        <Search className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={openGoToLineDialog}
                        className="rounded p-1 text-app-text-muted hover:bg-app-surface hover:text-app-text"
                        title="Go to line in selected file"
                        aria-label="Go to line in selected file"
                      >
                        <Hash className="h-4 w-4" />
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    onClick={() => void copySelectedFilePath()}
                    className="rounded px-1.5 py-1 text-micro font-medium text-app-text-muted hover:bg-app-surface hover:text-app-text"
                    title="Copy selected file path"
                    aria-label="Copy selected file path"
                  >
                    Path
                  </button>
                  <button
                    type="button"
                    onClick={() => void copySelectedFileContent()}
                    disabled={!activeRepo}
                    className="rounded p-1 text-app-text-muted hover:bg-app-surface hover:text-app-text disabled:opacity-40"
                    title="Copy selected file content"
                    aria-label="Copy selected file content"
                  >
                    <Copy className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => void copySelectedFileAbsolutePath()}
                    disabled={!activeRepo || selectedFile.status === 'deleted'}
                    className="rounded px-1.5 py-1 text-micro font-medium text-app-text-muted hover:bg-app-surface hover:text-app-text disabled:opacity-40"
                    title="Copy selected file absolute path"
                    aria-label="Copy selected file absolute path"
                  >
                    Abs
                  </button>
                  <button
                    type="button"
                    onClick={() => void openSelectedFileExternal()}
                    disabled={!activeRepo || selectedFile.status === 'deleted'}
                    className="rounded p-1 text-app-text-muted hover:bg-app-surface hover:text-app-text disabled:opacity-40"
                    title="Open selected file"
                    aria-label="Open selected file"
                  >
                    <ExternalLink className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => void revealSelectedFile()}
                    disabled={!activeRepo || selectedFile.status === 'deleted'}
                    className="rounded p-1 text-app-text-muted hover:bg-app-surface hover:text-app-text disabled:opacity-40"
                    title="Reveal selected file in Finder"
                    aria-label="Reveal selected file in Finder"
                  >
                    <FolderOpen className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => void sendSelectedFileToChat()}
                    disabled={!activeRepo || contextState.status === 'sending'}
                    className="rounded p-1 text-app-text-muted hover:bg-app-surface hover:text-app-text disabled:opacity-40"
                    title="Send selected file context to chat"
                    aria-label="Send selected file context to chat"
                  >
                    {contextState.status === 'sending' ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageSquare className="h-4 w-4" />}
                  </button>
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
                {contextState.message && (
                  <div className={`border-b border-app-border px-3 py-1.5 text-caption ${contextState.status === 'error' ? 'text-app-danger' : 'text-app-text-muted'}`}>
                    {contextState.message}
                  </div>
                )}
                {lineDialogOpen && selectedFile.status === 'tracked' && (
                  <form
                    role="dialog"
                    aria-label="Go to line"
                    className="flex items-center gap-2 border-b border-app-border bg-app-surface px-3 py-2"
                    onSubmit={submitGoToLine}
                  >
                    <label htmlFor="right-rail-go-to-line" className="text-caption font-medium text-app-text-muted">Line</label>
                    <input
                      id="right-rail-go-to-line"
                      autoFocus
                      inputMode="numeric"
                      className="h-7 w-20 rounded border border-app-border bg-app-bg px-2 text-xs text-app-text outline-none focus:border-app-accent"
                      value={lineInput}
                      onChange={(event) => {
                        setLineInput(event.target.value)
                        setLineError(null)
                      }}
                    />
                    <button
                      type="submit"
                      className="h-7 rounded bg-app-accent px-2 text-caption font-semibold text-app-accent-contrast hover:bg-app-accent/90"
                    >
                      Go
                    </button>
                    <button
                      type="button"
                      className="h-7 rounded px-2 text-caption font-medium text-app-text-muted hover:bg-app-surface-2 hover:text-app-text"
                      onClick={() => {
                        setLineDialogOpen(false)
                        setLineError(null)
                      }}
                    >
                      Cancel
                    </button>
                    {lineError && <span className="min-w-0 text-caption text-app-danger">{lineError}</span>}
                  </form>
                )}
                <div className="flex-1 min-h-0 overflow-y-auto bg-app-bg p-0">
                  <Suspense fallback={<div className="p-3 text-sm text-app-text-muted">Loading diff...</div>}>
                    <DiffViewer
                      filePath={selectedFile.path}
                      status={selectedFile.status}
                      wrapContent={wrapDiffContent}
                      focusLine={selectedLine}
                      searchRequest={editorSearchRequest}
                    />
                  </Suspense>
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

        {activeTab === 'agents' && (
          <div id="right-rail-agents-panel" role="tabpanel" aria-labelledby="right-rail-agents-tab" className="absolute inset-0 overflow-hidden">
            <AgentsPanel thread={activeThread} />
          </div>
        )}

      </div>
      {bottomPanel && <BottomPanelContent bottomPanel={bottomPanel} repoPath={activeRepo?.path ?? null} onOpenToolsSettings={onOpenToolsSettings} />}
      <BottomPanelNav bottomPanel={bottomPanel} onTogglePanel={(panel) => setBottomPanel((current) => current === panel ? null : panel)} />
    </div>
  )
}
