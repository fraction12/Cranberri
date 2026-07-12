import { useCallback, useState } from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Check, ChevronRight, GitBranch, Loader2, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { cn, menuSurface } from '../lib/ui'
import { typeStyle } from '../lib/typography'
import type { GitRef } from '@/shared/worktrees'

interface BranchChoice {
  name: string
  pinned: boolean
  current: boolean
}

export function orderedLocalBranchChoices(refs: readonly GitRef[], currentBranch: string | null, pinnedBranch: string | null): BranchChoice[] {
  const liveBranch = currentBranch === 'HEAD' ? null : currentBranch
  return refs
    .filter((ref) => ref.kind === 'local')
    .map((ref) => ({ name: ref.name, pinned: ref.name === pinnedBranch, current: ref.name === liveBranch }))
    .sort((left, right) => {
      const leftRank = left.pinned ? 0 : left.current ? 1 : 2
      const rightRank = right.pinned ? 0 : right.current ? 1 : 2
      return leftRank - rightRank || left.name.localeCompare(right.name)
    })
}

const MENU_ITEM = cn(
  'flex min-h-8 select-none items-center gap-2 rounded-md px-2 outline-none data-[highlighted]:bg-app-surface-2 data-[disabled]:opacity-45',
  typeStyle({ role: 'control', tone: 'primary' }),
)

export function RepoPinnedBranchMenu({ projectId, repoPath, pinnedBranch, onPin }: {
  projectId: string
  repoPath: string
  pinnedBranch?: string | null
  onPin: (branch: string) => Promise<void>
}) {
  const [choices, setChoices] = useState<BranchChoice[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savingBranch, setSavingBranch] = useState<string | null>(null)

  const loadBranches = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [refs, summary] = await Promise.all([
        window.cranberri.worktrees.listRefs(projectId),
        window.cranberri.git.githubSummary(repoPath),
      ])
      setChoices(orderedLocalBranchChoices(refs.refs, summary.branch, pinnedBranch ?? null))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Branches could not be loaded')
    } finally {
      setLoading(false)
    }
  }, [pinnedBranch, projectId, repoPath])

  const pinBranch = async (branch: string) => {
    if (branch === pinnedBranch || savingBranch) return
    setSavingBranch(branch)
    try {
      await onPin(branch)
      setChoices((current) => current.map((choice) => ({ ...choice, pinned: choice.name === branch })))
      toast.success(`Pinned Local to ${branch}`)
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Pinned branch could not be updated')
    } finally {
      setSavingBranch(null)
    }
  }

  return <DropdownMenu.Sub onOpenChange={(open) => { if (open) void loadBranches() }}>
    <DropdownMenu.SubTrigger className={MENU_ITEM}>
      <GitBranch className="h-3.5 w-3.5 shrink-0 text-app-text-muted" />
      <span className="min-w-0 flex-1">Pinned local branch</span>
      <span className={cn('max-w-24 truncate', typeStyle({ role: 'micro', tone: 'secondary' }))}>{pinnedBranch ?? 'Not set'}</span>
      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-app-text-muted" />
    </DropdownMenu.SubTrigger>
    <DropdownMenu.Portal>
      <DropdownMenu.SubContent sideOffset={5} alignOffset={-4} collisionPadding={8} className={cn(menuSurface, 'z-[1500] max-h-72 w-56 overflow-y-auto overscroll-contain')}>
        {loading && <div className={cn('flex min-h-8 items-center gap-2 px-2', typeStyle({ role: 'control', tone: 'secondary' }))}><Loader2 className="h-3.5 w-3.5 animate-spin" />Loading branches</div>}
        {!loading && error && <DropdownMenu.Item className={MENU_ITEM} onSelect={(event) => { event.preventDefault(); void loadBranches() }}><RefreshCw className="h-3.5 w-3.5 text-app-text-muted" />Retry loading branches</DropdownMenu.Item>}
        {!loading && !error && choices.length === 0 && <div className={cn('px-2 py-1.5', typeStyle({ role: 'control', tone: 'secondary' }))}>No local branches</div>}
        {!loading && !error && choices.map((choice) => (
          <DropdownMenu.Item key={choice.name} disabled={savingBranch !== null} className={MENU_ITEM} onSelect={() => { void pinBranch(choice.name) }}>
            <Check className={cn('h-3.5 w-3.5 shrink-0', choice.pinned ? 'opacity-100' : 'opacity-0')} />
            <span className="min-w-0 flex-1 truncate">{choice.name}</span>
            {choice.current && <span className={typeStyle({ role: 'micro', tone: 'secondary' })}>Current</span>}
            {savingBranch === choice.name && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />}
          </DropdownMenu.Item>
        ))}
      </DropdownMenu.SubContent>
    </DropdownMenu.Portal>
  </DropdownMenu.Sub>
}
