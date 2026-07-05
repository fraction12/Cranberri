import { useState } from 'react'
import { FileDiff, FileText, Ticket, ChevronLeft, Folder, ChevronRight } from 'lucide-react'
import { useGitStatus, useGitDiffForFile, useGitFiles } from '../state/git'
import type { GitFileStatus, FileTreeNode, DiffFile } from '@/shared/git'

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

export function RightRail() {
  const [selectedFile, setSelectedFile] = useState<GitFileStatus | null>(null)
  const [activeTab, setActiveTab] = useState<'files' | 'diff' | 'issue'>('files')
  const [filesMode, setFilesMode] = useState<'changes' | 'all'>('changes')

  const { data: status, isLoading: statusLoading } = useGitStatus()
  const { data: allFiles, isLoading: filesLoading } = useGitFiles()
  const { data: fileDiff, isLoading: diffLoading } = useGitDiffForFile(selectedFile?.path ?? null)

  const handleSelectFile = (file: GitFileStatus) => {
    setSelectedFile(file)
    setActiveTab('diff')
  }

  const handleBack = () => {
    setSelectedFile(null)
    setActiveTab('files')
  }

  return (
    <div className="flex flex-col h-full bg-app-surface">
      <div className="flex h-9 border-b border-app-border shrink-0">
        <TabButton active={activeTab === 'files'} onClick={() => setActiveTab('files')} icon={<FileText className="w-4 h-4" />} label="Files" />
        <TabButton active={activeTab === 'diff'} onClick={() => setActiveTab('diff')} icon={<FileDiff className="w-4 h-4" />} label="Diff" />
        <TabButton active={activeTab === 'issue'} onClick={() => setActiveTab('issue')} icon={<Ticket className="w-4 h-4" />} label="Issue" />
      </div>

      <div className="flex-1 min-h-0 overflow-hidden relative">
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
                  <span className="text-xs font-medium truncate" title={selectedFile.path}>{selectedFile.path}</span>
                </div>
                <div className="flex-1 min-h-0 overflow-y-auto p-0">
                  {diffLoading ? (
                    <div className="p-3 text-sm text-app-text-muted">Loading diff...</div>
                  ) : fileDiff?.files.length ? (
                    <DiffViewer file={fileDiff.files[0]} />
                  ) : (
                    <div className="p-3 text-sm text-app-text-muted">No diff for this file.</div>
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

        {activeTab === 'issue' && (
          <div className="absolute inset-0 p-3 text-sm text-app-text-muted overflow-y-auto">
            No Linear issue linked.
          </div>
        )}
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

function DiffViewer({ file }: { file: DiffFile }) {
  if (!file.chunks.length) {
    return <div className="p-3 text-sm text-app-text-muted">No diff chunks for this file.</div>
  }

  return (
    <div className="text-xs font-mono">
      <div className="px-3 py-2 border-b border-app-border bg-app-surface-2 text-app-text-muted">
        {file.additions} additions, {file.deletions} deletions
      </div>
      {file.chunks.map((chunk, ci) => (
        <div key={ci} className="border-b border-app-border">
          <div className="px-3 py-1 bg-app-bg/50 text-app-text-muted">
            @@ -{chunk.oldStart},{chunk.oldLines} +{chunk.newStart},{chunk.newLines} @@
          </div>
          <div className="leading-relaxed">
            {chunk.changes.map((change, li) => {
              const bg = change.type === 'add' ? 'bg-app-accent/10' : change.type === 'del' ? 'bg-app-danger/10' : ''
              const text = change.type === 'add' ? 'text-app-accent' : change.type === 'del' ? 'text-app-danger' : 'text-app-text-muted'
              const prefix = change.type === 'add' ? '+' : change.type === 'del' ? '-' : ' '
              return (
                <div key={li} className={`flex ${bg}`}>
                  <div className="w-12 text-right pr-2 text-app-text-muted select-none">
                    {change.delLine ?? change.ln1 ?? ''}
                  </div>
                  <div className="w-12 text-right pr-2 text-app-text-muted select-none">
                    {change.addLine ?? change.ln2 ?? ''}
                  </div>
                  <div className={`w-4 text-center ${text} select-none`}>{prefix}</div>
                  <pre className={`flex-1 whitespace-pre-wrap ${text}`}>{change.line || ' '}</pre>
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
