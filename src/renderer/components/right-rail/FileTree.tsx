import { useState } from 'react'
import { ChevronRight, Folder } from 'lucide-react'
import type { FileTreeNode } from '@/shared/git'

interface FileTreeProps {
  nodes?: FileTreeNode[]
  isLoading: boolean
  selectedPath: string | null
  onSelectFile: (path: string) => void
  depth?: number
}

export function FileTree({
  nodes,
  isLoading,
  selectedPath,
  onSelectFile,
  depth = 0,
}: FileTreeProps) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())

  if (isLoading) {
    return <div className="p-3 text-sm text-app-text-muted">Loading files...</div>
  }

  if (!nodes?.length) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-4 text-center text-sm text-app-text-muted">
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
                className="flex w-full items-center gap-1 px-3 py-1 text-left hover:bg-app-surface-2/50"
                style={{ paddingLeft: `${12 + depth * 16}px` }}
              >
                <ChevronRight className={`h-3 w-3 ${isExpanded ? 'rotate-90' : ''}`} />
                <Folder className="h-3.5 w-3.5 text-app-text-muted" />
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
            className={`cursor-pointer truncate px-3 py-1 hover:bg-app-surface-2/50 ${
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
