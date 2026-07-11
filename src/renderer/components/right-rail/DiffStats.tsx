import { useGitDiffForFile } from '../../state/git'
import { cn } from '../../lib/ui'
import { typeStyle } from '../../lib/typography'

export function DiffStats({ filePath }: { filePath: string }) {
  const { data: fileDiff } = useGitDiffForFile(filePath)
  if (!fileDiff?.files.length) return null
  const { additions, deletions } = fileDiff.files[0]
  if (additions === 0 && deletions === 0) return null

  return (
    <div className="flex shrink-0 items-center gap-2">
      {additions > 0 && <span className={cn('tabular-nums', typeStyle({ role: 'status', tone: 'success' }))}>+{additions}</span>}
      {deletions > 0 && <span className={cn('tabular-nums', typeStyle({ role: 'status', tone: 'danger' }))}>&minus;{deletions}</span>}
    </div>
  )
}
