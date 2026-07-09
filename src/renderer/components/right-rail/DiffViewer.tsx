import ReactDiffViewer from 'react-diff-viewer-continued'
import { useGitDiffForFile, useGitRawContent } from '../../state/git'
import { preloadCodePreview } from '../editor/CodePreview'
import { CodeEditor } from '../editor/CodeEditor'
import type { GitFileStatus } from '@/shared/git'

export function preloadDiffRenderer() {
  preloadCodePreview()
}

interface DiffViewerProps {
  filePath: string
  status: GitFileStatus['status']
  wrapContent: boolean
  focusLine?: number | null
  searchRequest?: number
}

export function DiffViewer({ filePath, status, wrapContent, focusLine, searchRequest = 0 }: DiffViewerProps) {
  const { data: oldContent, isLoading: oldLoading } = useGitRawContent(
    status === 'added' || status === 'untracked' ? null : filePath,
    'HEAD',
  )
  const { data: newContent, isLoading: newLoading } = useGitRawContent(filePath, 'WORKING')

  if (oldLoading || newLoading) {
    return <div className="p-3 text-sm text-app-text-muted">Loading diff...</div>
  }

  if (status === 'tracked') {
    return (
      <CodeEditor
        value={newContent ?? ''}
        filePath={filePath}
        readOnly
        lineWrap={wrapContent}
        focusLine={focusLine}
        searchRequest={searchRequest}
      />
    )
  }

  return (
    <div className={`cranberri-diff-viewer h-full overflow-auto text-code ${wrapContent ? 'wrap-diff-content' : ''}`}>
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
    </div>
  )
}

export function DiffStats({ filePath }: { filePath: string; status: GitFileStatus['status'] }) {
  const { data: fileDiff } = useGitDiffForFile(filePath)
  if (!fileDiff?.files.length) return null
  const { additions, deletions } = fileDiff.files[0]
  if (additions === 0 && deletions === 0) return null
  return (
    <div className="ml-auto flex items-center gap-2 text-micro font-medium">
      {additions > 0 && <span className="text-app-success">+{additions}</span>}
      {deletions > 0 && <span className="text-app-danger">−{deletions}</span>}
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
        addedBackground: 'var(--app-diff-added)',
        addedColor: 'var(--app-text)',
        removedBackground: 'var(--app-diff-removed)',
        removedColor: 'var(--app-text)',
        changedBackground: 'transparent',
        gutterColor: 'var(--app-text-muted)',
        codeFoldBackground: 'var(--app-surface-2)',
        codeFoldGutterBackground: 'var(--app-surface-2)',
      },
    },
    diffContainer: {
      fontFamily: 'var(--app-font-mono)',
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
