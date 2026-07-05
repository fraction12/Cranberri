import { Plus, FolderGit2 } from 'lucide-react'

export function RepoRail() {
  return (
    <div className="w-14 flex flex-col items-center border-r border-app-border bg-app-surface py-2">
      <button className="p-2 rounded hover:bg-app-surface-2 mb-2" title="Add repo">
        <Plus className="w-5 h-5" />
      </button>
      <button className="p-2 rounded bg-app-surface-2" title="nephrite">
        <FolderGit2 className="w-5 h-5" />
      </button>
    </div>
  )
}
