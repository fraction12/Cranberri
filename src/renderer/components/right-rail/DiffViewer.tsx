import { Suspense, lazy } from 'react'
import { useGitDiffForFile, useGitRawContent } from '../../state/git'
import type { GitFileStatus } from '@/shared/git'

const ReactDiffViewer = lazy(() => import('react-diff-viewer-continued'))

interface DiffViewerProps {
  filePath: string
  status: GitFileStatus['status']
  wrapContent: boolean
}

export function DiffViewer({ filePath, status, wrapContent }: DiffViewerProps) {
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
      <Suspense fallback={<div className="p-3 text-sm text-app-text-muted">Loading diff...</div>}>
        <ReactDiffViewer
          oldValue={oldContent ?? ''}
          newValue={newContent ?? ''}
          splitView={false}
          showDiffOnly={false}
          hideLineNumbers
          hideSummary
          disableWordDiff
          styles={getDiffStyles(wrapContent)}
        />
      </Suspense>
    </div>
  )
}

export function DiffStats({ filePath }: { filePath: string; status: GitFileStatus['status'] }) {
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

function getDiffStyles(wrapContent: boolean) {
  return {
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
  } as const
}
