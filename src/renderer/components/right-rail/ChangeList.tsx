import { useState } from 'react'
import { AlertCircle, ChevronRight, FileText, Folder, Loader2 } from 'lucide-react'
import type { GitFileStatus } from '@/shared/git'

interface ChangeListProps {
  status?: GitFileStatus[]
  statusLoading: boolean
  error?: Error | null
  selectedFile: GitFileStatus | null
  onSelectFile: (file: GitFileStatus) => void
}

interface ChangeTreeNodeData {
  name: string
  path: string
  children: ChangeTreeNodeData[]
  file: GitFileStatus | null
  statuses: Set<GitFileStatus['status']>
  childrenByName: Map<string, ChangeTreeNodeData>
}

function statusColor(status: GitFileStatus['status']) {
  switch (status) {
    case 'added':
    case 'untracked':
      return 'text-app-success bg-app-success/10'
    case 'deleted':
      return 'text-app-danger bg-app-danger/10'
    case 'modified':
      return 'text-app-warning bg-app-warning/10'
    case 'renamed':
      return 'text-app-info bg-app-info/10'
    case 'conflict':
      return 'text-app-warning bg-app-warning/10'
    case 'staged':
      return 'text-app-success bg-app-success/10'
    case 'tracked':
    default:
      return 'text-app-text-muted bg-app-surface-2'
  }
}

export function ChangeList({
  status,
  statusLoading,
  error,
  selectedFile,
  onSelectFile,
}: ChangeListProps) {
  if (statusLoading) {
    return <div className="flex items-center gap-2 p-3 text-sm text-app-text-muted"><Loader2 className="h-4 w-4 animate-spin" /> Loading changes</div>
  }

  if (error) {
    return (
      <div role="alert" className="flex h-full flex-col items-center justify-center p-5 text-center text-sm text-app-text-muted">
        <AlertCircle className="mb-2 h-7 w-7 text-app-danger" />
        <span className="font-medium text-app-text">Changes could not be loaded</span>
        <span className="mt-1 text-caption">{error.message}</span>
      </div>
    )
  }

  if (!status?.length) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-4 text-center text-sm text-app-text-muted">
        <FileText className="mb-2 h-8 w-8 opacity-50" />
        No changed files.
      </div>
    )
  }

  const tree = buildChangeTree(status)

  return (
    <ul className="p-2 text-sm">
      {tree.map((node) => (
        <ChangeTreeNode
          key={node.path}
          node={node}
          selectedPath={selectedFile?.path ?? null}
          onSelectFile={onSelectFile}
        />
      ))}
    </ul>
  )
}

function buildChangeTree(files: GitFileStatus[]): ChangeTreeNodeData[] {
  const root = new Map<string, ChangeTreeNodeData>()

  const getNode = (siblings: Map<string, ChangeTreeNodeData>, name: string, path: string) => {
    let node = siblings.get(name)
    if (!node) {
      node = { name, path, children: [], file: null, statuses: new Set(), childrenByName: new Map() }
      siblings.set(name, node)
    }
    return node
  }

  for (const file of files) {
    const parts = file.path.split('/').filter(Boolean)
    let siblings = root

    for (let index = 0; index < parts.length; index += 1) {
      const name = parts[index]
      const path = parts.slice(0, index + 1).join('/')
      const current = getNode(siblings, name, path)
      current.statuses.add(file.status)

      if (index === parts.length - 1) {
        current.file = file
      } else {
        siblings = current.childrenByName
      }
    }
  }

  const sortNodes = (nodes: ChangeTreeNodeData[]): ChangeTreeNodeData[] => nodes
    .map((node) => ({ ...node, children: sortNodes([...node.childrenByName.values()]) }))
    .sort((a, b) => {
      if (Boolean(a.file) === Boolean(b.file)) return a.name.localeCompare(b.name)
      return a.file ? 1 : -1
    })

  return sortNodes([...root.values()])
}

function countChangedFiles(node: ChangeTreeNodeData): number {
  if (node.file) return 1
  return node.children.reduce((total, child) => total + countChangedFiles(child), 0)
}

function statusRank(statuses: Set<GitFileStatus['status']>): GitFileStatus['status'] {
  const order: GitFileStatus['status'][] = [
    'conflict',
    'deleted',
    'renamed',
    'modified',
    'added',
    'untracked',
    'staged',
    'tracked',
  ]
  return order.find((status) => statuses.has(status)) ?? 'tracked'
}

function ChangeTreeNode({
  node,
  selectedPath,
  onSelectFile,
  depth = 0,
}: {
  node: ChangeTreeNodeData
  selectedPath: string | null
  onSelectFile: (file: GitFileStatus) => void
  depth?: number
}) {
  const [expanded, setExpanded] = useState(depth < 2 || node.children.length <= 4)

  if (node.file) {
    return (
      <li>
        <button
          type="button"
          onClick={() => onSelectFile(node.file!)}
          className={`group flex w-full items-center gap-2 rounded-md py-1.5 pr-2 text-left transition hover:bg-app-surface-2/70 ${
            selectedPath === node.path ? 'bg-app-surface-2' : ''
          }`}
          style={{ paddingLeft: `${8 + depth * 14}px` }}
          title={node.path}
        >
          <FileText className="h-3.5 w-3.5 shrink-0 text-app-text-muted group-hover:text-app-text" />
          <span className="min-w-0 flex-1 truncate text-sm text-app-text">{node.name}</span>
          <span className={`shrink-0 rounded px-1.5 py-0.5 text-micro capitalize ${statusColor(node.file.status)}`}>
            {node.file.status}
          </span>
        </button>
      </li>
    )
  }

  const badgeStatus = statusRank(node.statuses)

  return (
    <li>
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="group flex w-full items-center gap-1.5 rounded-md py-1.5 pr-2 text-left text-app-text-muted transition hover:bg-app-surface-2/60 hover:text-app-text"
        style={{ paddingLeft: `${8 + depth * 14}px` }}
        title={node.path}
      >
        <ChevronRight className={`h-3 w-3 shrink-0 transition-transform ${expanded ? 'rotate-90' : ''}`} />
        <Folder className="h-3.5 w-3.5 shrink-0 text-app-accent/80" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-app-text">{node.name}</span>
        <span className="rounded bg-app-surface-2 px-1.5 py-0.5 text-micro tabular-nums text-app-text-muted">
          {countChangedFiles(node)}
        </span>
        <span className={`h-1.5 w-1.5 rounded-full ${statusColor(badgeStatus).split(' ')[1]}`} />
      </button>
      {expanded && node.children.length > 0 && (
        <ul>
          {node.children.map((child) => (
            <ChangeTreeNode
              key={child.path}
              node={child}
              selectedPath={selectedPath}
              onSelectFile={onSelectFile}
              depth={depth + 1}
            />
          ))}
        </ul>
      )}
    </li>
  )
}
