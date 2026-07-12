import { Laptop, TreePine } from 'lucide-react'
import type { SessionExecutionTarget } from '@/shared/appState'
import type { EnvironmentRecord } from '@/shared/environments'
import type { BranchOption } from './BranchSelector'
import { BranchSelector } from './BranchSelector'
import { EnvironmentSelector } from './EnvironmentSelector'
import { cn } from '../../lib/ui'
import { typeStyle } from '../../lib/typography'

export function DraftSessionHeader({ target, pinnedBranch, baseRef, branches, environments, environmentId, loading, partialFallback, includeLocalChanges, onBaseRefChange, onEnvironmentChange, onIncludeLocalChanges, onRetry }: {
  target: SessionExecutionTarget
  pinnedBranch?: string | null
  baseRef: string
  branches: readonly BranchOption[]
  environments: readonly EnvironmentRecord[]
  environmentId: string | null
  loading?: boolean
  partialFallback?: boolean
  includeLocalChanges?: boolean
  onBaseRefChange: (ref: string) => void
  onEnvironmentChange: (id: string | null) => void
  onIncludeLocalChanges: (include: boolean) => void
  onRetry: () => void
}) {
  if (target === 'local') {
    return <header className="flex h-9 shrink-0 items-center gap-2 px-3"><Laptop className="h-3.5 w-3.5 text-app-text-muted" /><span className={cn('truncate', typeStyle({ role: 'control', tone: 'secondary' }))}>Local · {pinnedBranch ?? 'current branch'}</span></header>
  }
  return <header className="flex min-h-9 shrink-0 flex-wrap items-center gap-1 px-3 py-1" aria-label="New worktree setup">
    <TreePine className="mr-1 h-3.5 w-3.5 text-app-text-muted" />
    <span className={cn('mr-1', typeStyle({ role: 'control', tone: 'secondary' }))}>New worktree</span>
    <BranchSelector value={baseRef} options={branches} loading={loading} partialFallback={partialFallback} includeLocalEligible={baseRef === `refs/heads/${pinnedBranch}`} includeLocalChanges={includeLocalChanges} side="bottom" onIncludeLocalChanges={onIncludeLocalChanges} onRetry={onRetry} onChange={onBaseRefChange} />
    <EnvironmentSelector value={environmentId} options={environments.map((record) => ({ id: record.manifest.environmentId, name: record.manifest.name, trusted: record.manifest.trustedRevision === record.manifest.currentRevision }))} side="bottom" onChange={onEnvironmentChange} />
  </header>
}
