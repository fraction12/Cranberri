import { useState } from 'react'
import { AlertCircle, ChevronRight, File, Folder, Loader2 } from 'lucide-react'
import type { FileTreeNode } from '@/shared/git'
import { cn } from '../../lib/ui'
import { typeStyle } from '../../lib/typography'

interface FileTreeProps {
  nodes?: FileTreeNode[]
  isLoading: boolean
  error?: Error | null
  selectedPath: string | null
  onSelectFile: (path: string) => void
  depth?: number
}

export function FileTree({
  nodes,
  isLoading,
  error,
  selectedPath,
  onSelectFile,
  depth = 0,
}: FileTreeProps) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())

  if (isLoading) {
    return <div className={cn('flex items-center gap-2 p-3', typeStyle({ role: 'status', tone: 'secondary' }))}><Loader2 className="h-4 w-4 animate-spin" /> Loading files</div>
  }

  if (error) {
    return (
      <div role="alert" className="flex h-full flex-col items-center justify-center p-5 text-center">
        <AlertCircle className="mb-2 h-7 w-7 text-app-status-danger" />
        <span className={typeStyle({ role: 'status', tone: 'danger' })}>Files could not be loaded</span>
        <span className={cn('mt-1 max-w-full [overflow-wrap:anywhere]', typeStyle({ role: 'status', tone: 'danger' }))}>{error.message}</span>
      </div>
    )
  }

  if (!nodes?.length) {
    return (
      <div className={cn('flex h-full flex-col items-center justify-center p-4 text-center', typeStyle({ role: 'body', tone: 'secondary' }))}>
        <Folder className="mb-2 h-8 w-8 opacity-50" />
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
    <ul className={cn('py-1', typeStyle({ role: 'body' }))} role={depth === 0 ? 'tree' : 'group'}>
      {sorted.map((node) => {
        const name = node.path.split('/').pop() ?? node.path
        const isExpanded = expanded.has(node.path)
        if (node.type === 'dir') {
          return (
            <li key={node.path}>
              <button
                type="button"
                onClick={() => toggle(node.path)}
                className="flex min-h-8 w-full items-center gap-1.5 rounded-md pr-2 text-left hover:bg-app-surface-2/55"
                style={{ paddingLeft: `${12 + depth * 16}px` }}
                aria-expanded={isExpanded}
              >
                <ChevronRight className={`h-3 w-3 ${isExpanded ? 'rotate-90' : ''}`} />
                <Folder className="h-3.5 w-3.5 text-app-text-muted" />
                <span>{name}</span>
              </button>
              {isExpanded && (
                <FileTree
                  nodes={node.children}
                  isLoading={false}
                  error={null}
                  selectedPath={selectedPath}
                  onSelectFile={onSelectFile}
                  depth={depth + 1}
                />
              )}
            </li>
          )
        }
        return (
          <li key={node.path} role="treeitem">
            <button
              type="button"
              onClick={() => onSelectFile(node.path)}
              className={`flex min-h-8 w-full items-center gap-1.5 rounded-md pr-2 text-left hover:bg-app-surface-2/55 ${
                selectedPath === node.path ? 'bg-app-surface-2' : ''
              }`}
              style={{ paddingLeft: `${12 + depth * 16}px` }}
              title={node.path}
            >
              <File className="h-3.5 w-3.5 shrink-0 text-app-text-muted" />
              <span className="min-w-0 flex-1 truncate">{name}</span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}
