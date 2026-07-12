import { lazy, Suspense, type FormEvent, useCallback, useEffect, useState } from 'react'
import { ChevronLeft, FileDiff, GitCommitHorizontal, Hash, Loader2, MessageSquare, Search } from 'lucide-react'
import { toast } from 'sonner'
import { useGitStatus, useGitFiles } from '../state/git'
import { useCodexThreads } from '../state/codex'
import { useRepos } from '../state/repos'
import { useWorkspace } from '../state/workspace'
import { ChangeList } from './right-rail/ChangeList'
import { AgentsPanel } from './right-rail/AgentsPanel'
import { CommitDialog, type CommitDraftState, type CommitState } from './right-rail/CommitDialog'
import { DiffOptionsMenu } from './right-rail/DiffOptionsMenu'
import { DiffStats } from './right-rail/DiffStats'
import { FileTree } from './right-rail/FileTree'
import { createRightRailActiveFileEvent } from './right-rail/right-rail-active-file-events'
import { OPEN_RIGHT_RAIL_COMMAND_EVENT, rightRailCommandFromEvent } from './right-rail/right-rail-command-events'
import { OPEN_RIGHT_RAIL_FILE_EVENT, rightRailFileFromEvent } from './right-rail/right-rail-file-events'
import { sendChatContext } from '../state/chat-context-command'
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
import { buttonStyle, cn, compactFieldStyle, iconButton } from '../lib/ui'
import { typeStyle } from '../lib/typography'

const DiffViewer = lazy(() => import('./right-rail/DiffViewer').then((module) => ({ default: module.DiffViewer })))

function preloadDiffRenderer(): void {
  void import('./right-rail/DiffViewer').then((module) => module.preloadDiffRenderer())
}

export function RightRail({ onOpenToolsSettings }: { onOpenToolsSettings: () => void }) {
  const [selectedFile, setSelectedFile] = useState<GitFileStatus | null>(null)
  const [activeTab, setActiveTab] = useState<RightRailTab>('files')
  const [bottomPanel, setBottomPanel] = useState<BottomPanelKind | null>(null)
  const [filesMode, setFilesMode] = useState<'changes' | 'all'>('changes')
  const [wrapDiffContent, setWrapDiffContent] = useState(false)
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

  const showChanges = activeTab === 'files' && filesMode === 'changes'
  const showAllFiles = activeTab === 'files' && filesMode === 'all'
  const { data: status, isLoading: statusLoading, isError: statusFailed, error: statusError, refetch: refetchStatus } = useGitStatus(showChanges || commitDialogOpen)
  const { data: allFiles, isLoading: filesLoading, isError: filesFailed, error: filesError } = useGitFiles(showAllFiles)
  const { activeRepo } = useRepos()
  const { activeWindowId, activeExecutionContext, activeExecutionResolution } = useWorkspace()
  const activeTaskId = activeExecutionContext?.taskId ?? null
  const executionPending = Boolean(activeWindowId) && activeExecutionResolution === null
  const executionUnavailable = activeExecutionResolution?.status === 'unavailable'
  const activeCheckoutPath = executionPending || executionUnavailable
    ? null
    : activeExecutionContext?.checkoutPath ?? activeRepo?.path ?? null
  const { activeThread } = useCodexThreads()
  const agentCount = activeThread?.workers?.length ?? 0

  useEffect(() => {
    setSelectedFile(null)
    setSelectedLine(null)
    setEditorSearchRequest(0)
    setLineDialogOpen(false)
    setActiveTab('files')
  }, [activeExecutionContext?.checkoutId, activeRepo?.id])

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
    setLineDialogOpen(false)
    setContextState({ status: 'idle', message: null })
    setActiveTab('files')
  }

  const sendSelectedFileToChat = useCallback(async () => {
    if (!activeCheckoutPath || !selectedFile || contextState.status === 'sending') return
    setContextState({ status: 'sending', message: 'Sending file context…' })
    try {
      const shouldReadWorking = selectedFile.status !== 'deleted'
      const shouldReadHead = selectedFile.status !== 'added' && selectedFile.status !== 'untracked'
      const [diff, workingContent, headContent] = await Promise.all([
        selectedFile.status === 'tracked'
          ? Promise.resolve(null)
          : activeTaskId
            ? window.cranberri.git.taskDiffFile(activeTaskId, selectedFile.path)
            : window.cranberri.git.diffFile(activeCheckoutPath, selectedFile.path),
        shouldReadWorking
          ? activeTaskId
            ? window.cranberri.git.taskRawContent(activeTaskId, selectedFile.path, 'WORKING')
            : window.cranberri.git.rawContent(activeCheckoutPath, selectedFile.path, 'WORKING')
          : Promise.resolve(''),
        shouldReadHead
          ? activeTaskId
            ? window.cranberri.git.taskRawContent(activeTaskId, selectedFile.path, 'HEAD')
            : window.cranberri.git.rawContent(activeCheckoutPath, selectedFile.path, 'HEAD')
          : Promise.resolve(''),
      ])
      const context = {
        repoPath: activeCheckoutPath,
        file: selectedFile,
        workingContent,
        headContent,
        diff,
      }
      window.dispatchEvent(createRepoFileContextCapturedEvent(context))
      await sendChatContext({
        text: repoFileChatContext(context),
      })
      setContextState({ status: 'idle', message: null })
      toast.success('File context added to chat')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to send file context'
      setContextState({ status: 'error', message: null })
      toast.error(message)
    }
  }, [activeCheckoutPath, activeTaskId, contextState.status, selectedFile])

  const handleCommit = async () => {
    if (!activeCheckoutPath || commitState.status === 'committing') return
    setCommitState({ status: 'committing', message: 'Committing changes…' })
    try {
      const result = activeTaskId
        ? await window.cranberri.git.taskCommit(activeTaskId, commitTitle, commitSummary)
        : await window.cranberri.git.commit(activeCheckoutPath, commitTitle, commitSummary)
      setCommitState({ status: 'success', message: `Committed ${result.hash.slice(0, 7)} · ${result.title}` })
      toast.success(`Committed ${result.hash.slice(0, 7)}`)
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
    if (!activeCheckoutPath || commitDraftState.status === 'drafting' || commitState.status === 'committing') return
    setCommitDialogOpen(true)
    setCommitDraftState({ status: 'drafting', message: 'Drafting commit message…' })
    setCommitState({ status: 'idle', message: null })
    try {
      const draft = await window.cranberri.git.draftCommitMessage(activeCheckoutPath)
      setCommitTitle(draft.title)
      setCommitSummary(draft.summary)
      setCommitDraftState({ status: 'idle', message: null })
      toast.success('Commit message drafted')
    } catch (error) {
      setCommitDraftState({ status: 'error', message: error instanceof Error ? error.message : 'Failed to draft commit message' })
    }
  }, [activeCheckoutPath, commitDraftState.status, commitState.status])

  const copySelectedFilePath = useCallback(async () => {
    if (!selectedFile) return
    try {
      await navigator.clipboard.writeText(selectedFile.path)
      toast.success('Relative path copied')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to copy the file path')
    }
  }, [selectedFile])

  const copySelectedFileContent = useCallback(async () => {
    if (!activeCheckoutPath || !selectedFile) return
    try {
      const ref = selectedFile.status === 'deleted' ? 'HEAD' : 'WORKING'
      const content = activeTaskId
        ? await window.cranberri.git.taskRawContent(activeTaskId, selectedFile.path, ref)
        : await window.cranberri.git.rawContent(activeCheckoutPath, selectedFile.path, ref)
      await navigator.clipboard.writeText(content)
      toast.success('File contents copied')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to copy file contents')
    }
  }, [activeCheckoutPath, activeTaskId, selectedFile])

  const focusSelectedFileLine = useCallback((line: number) => {
    if (!selectedFile || selectedFile.status !== 'tracked') return
    if (!Number.isFinite(line) || line < 1) return
    const nextLine = Math.floor(line)
    setSelectedLine(nextLine)
    setActiveTab('diff')
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
    if (!activeCheckoutPath || !selectedFile || selectedFile.status === 'deleted') return
    try {
      await navigator.clipboard.writeText(repoAbsolutePath(activeCheckoutPath, selectedFile.path))
      toast.success('Absolute path copied')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to copy the absolute path')
    }
  }, [activeCheckoutPath, selectedFile])

  const openSelectedFileExternal = useCallback(async () => {
    if (!activeCheckoutPath || !selectedFile || selectedFile.status === 'deleted') return
    try {
      await window.cranberri.openPath(repoAbsolutePath(activeCheckoutPath, selectedFile.path))
      toast.success('File opened')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to open the file')
    }
  }, [activeCheckoutPath, selectedFile])

  const revealSelectedFile = useCallback(async () => {
    if (!activeCheckoutPath || !selectedFile || selectedFile.status === 'deleted') return
    try {
      await window.cranberri.revealPath(repoAbsolutePath(activeCheckoutPath, selectedFile.path))
      toast.success('Revealed in Finder')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to reveal the file')
    }
  }, [activeCheckoutPath, selectedFile])

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

  return (
    <div className="flex h-full flex-col bg-app-surface">
      {commitDialogOpen && (
        <CommitDialog
          title={commitTitle}
          summary={commitSummary}
          commitState={commitState}
          draftState={commitDraftState}
          canDraft={Boolean(activeCheckoutPath && status?.length)}
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
            <div className="flex h-10 shrink-0 items-center justify-between gap-2 px-3">
              <span className={typeStyle({ role: 'panelTitle' })}>{filesMode === 'changes' ? 'Changes' : 'All files'}</span>
              <div className="flex items-center gap-1.5">
                {filesMode === 'changes' && (
                  <button
                    type="button"
                    onClick={openCommitDialog}
                    disabled={!activeCheckoutPath || !status?.length || commitState.status === 'committing'}
                    className={buttonStyle({ tone: 'secondary', size: 'compact' })}
                    title="Write a commit message and commit these changes"
                  >
                    <GitCommitHorizontal className="h-3.5 w-3.5" />
                    {commitState.status === 'committing' ? 'Committing…' : 'Commit'}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setFilesMode((m) => (m === 'changes' ? 'all' : 'changes'))}
                  className={buttonStyle({ tone: 'ghost', size: 'compact' })}
                >
                  {filesMode === 'changes' ? 'Show all files' : 'Show changes'}
                </button>
              </div>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto">
              {filesMode === 'changes' ? (
                <ChangeList
                  status={status}
                  statusLoading={statusLoading}
                  error={statusFailed ? statusError : null}
                  selectedFile={selectedFile}
                  onSelectFile={handleSelectFile}
                />
              ) : (
                <FileTree
                  nodes={allFiles}
                  isLoading={filesLoading}
                  error={filesFailed ? filesError : null}
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
                <div className="flex h-10 shrink-0 items-center gap-1.5 bg-app-surface-2/45 px-2 shadow-sm">
                  <button type="button" onClick={handleBack} className={iconButton()} title="Back to files" aria-label="Back to files">
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <span className={cn('min-w-0 flex-1 truncate', typeStyle({ role: 'metadata' }))} title={selectedFile.path}>{selectedFile.path}</span>
                  <DiffStats filePath={selectedFile.path} />
                  {selectedFile.status === 'tracked' && (
                    <>
                      <button
                        type="button"
                        onClick={() => setEditorSearchRequest((request) => request + 1)}
                        className={iconButton()}
                        title="Search selected file"
                        aria-label="Search selected file"
                      >
                        <Search className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={openGoToLineDialog}
                        className={iconButton()}
                        title="Go to line in selected file"
                        aria-label="Go to line in selected file"
                      >
                        <Hash className="h-4 w-4" />
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    onClick={() => void sendSelectedFileToChat()}
                    disabled={!activeCheckoutPath || contextState.status === 'sending'}
                    className={iconButton()}
                    title="Send selected file context to chat"
                    aria-label="Send selected file context to chat"
                  >
                    {contextState.status === 'sending' ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageSquare className="h-4 w-4" />}
                  </button>
                  <DiffOptionsMenu
                    wrapContent={wrapDiffContent}
                    canReadFile={Boolean(activeCheckoutPath)}
                    canOpenFile={Boolean(activeCheckoutPath && selectedFile.status !== 'deleted')}
                    onToggleWrapContent={() => setWrapDiffContent((value) => !value)}
                    onCopyPath={() => void copySelectedFilePath()}
                    onCopyAbsolutePath={() => void copySelectedFileAbsolutePath()}
                    onCopyContent={() => void copySelectedFileContent()}
                    onOpenFile={() => void openSelectedFileExternal()}
                    onRevealFile={() => void revealSelectedFile()}
                  />
                </div>
                {lineDialogOpen && selectedFile.status === 'tracked' && (
                  <form
                    role="dialog"
                    aria-label="Go to line"
                    className="flex items-center gap-2 bg-app-surface-2/45 px-3 py-2 shadow-sm"
                    onSubmit={submitGoToLine}
                  >
                    <label htmlFor="right-rail-go-to-line" className={typeStyle({ role: 'label', tone: 'secondary' })}>Line</label>
                    <input
                      id="right-rail-go-to-line"
                      autoFocus
                      inputMode="numeric"
                      className={cn(compactFieldStyle, 'w-20')}
                      value={lineInput}
                      onChange={(event) => {
                        setLineInput(event.target.value)
                        setLineError(null)
                      }}
                    />
                    <button
                      type="submit"
                      className={buttonStyle({ tone: 'primary', size: 'compact' })}
                    >
                      Go
                    </button>
                    <button
                      type="button"
                      className={buttonStyle({ tone: 'ghost', size: 'compact' })}
                      onClick={() => {
                        setLineDialogOpen(false)
                        setLineError(null)
                      }}
                    >
                      Cancel
                    </button>
                    {lineError && <span className={cn('min-w-0 [overflow-wrap:anywhere]', typeStyle({ role: 'status', tone: 'danger' }))}>{lineError}</span>}
                  </form>
                )}
                <div className="flex-1 min-h-0 overflow-hidden bg-app-bg p-0">
                  <Suspense fallback={<div className={cn('p-3', typeStyle({ role: 'status', tone: 'secondary' }))}>Loading diff...</div>}>
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
              <div className={cn('flex h-full flex-col items-center justify-center p-5 text-center', typeStyle({ role: 'body', tone: 'secondary' }))}>
                <FileDiff className="mb-2 h-7 w-7 opacity-45" />
                Choose a file in Files to inspect it.
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
      {bottomPanel && <BottomPanelContent
        key={activeExecutionContext?.checkoutId ?? `window:${activeWindowId ?? 'none'}`}
        bottomPanel={bottomPanel}
        repoPath={activeCheckoutPath}
        taskId={activeTaskId}
        onOpenToolsSettings={onOpenToolsSettings}
      />}
      <BottomPanelNav bottomPanel={bottomPanel} onTogglePanel={(panel) => setBottomPanel((current) => current === panel ? null : panel)} />
    </div>
  )
}
