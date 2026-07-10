import { useGitDiffForFile } from '../../state/git'

export function DiffStats({ filePath }: { filePath: string }) {
  const { data: fileDiff } = useGitDiffForFile(filePath)
  if (!fileDiff?.files.length) return null
  const { additions, deletions } = fileDiff.files[0]
  if (additions === 0 && deletions === 0) return null

  return (
    <div className="ml-auto flex items-center gap-2 text-micro font-medium">
      {additions > 0 && <span className="text-app-success">+{additions}</span>}
      {deletions > 0 && <span className="text-app-danger">&minus;{deletions}</span>}
    </div>
  )
}
