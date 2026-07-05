import { Plus, FolderGit2, X } from 'lucide-react'
import { useRepos } from '../state/repos'

export function RepoRail() {
  const { repos, activeRepoId, addRepo, removeRepo, setActiveRepo } = useRepos()

  return (
    <div className="w-64 h-full flex flex-col border-r border-app-border bg-app-surface py-2 px-3 overflow-hidden">
      <div className="flex items-center justify-between mb-3 shrink-0">
        <span className="text-xs font-semibold uppercase text-app-text-muted tracking-wider">Repos</span>
        <button
          onClick={addRepo}
          className="p-1.5 rounded hover:bg-app-surface-2"
          title="Add repo"
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>

      <div className="flex flex-col gap-1 overflow-y-auto">
        {repos.map((repo) => (
          <div
            key={repo.id}
            onClick={() => setActiveRepo(repo.id)}
            className={`group flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer ${
              activeRepoId === repo.id ? 'bg-app-surface-2' : 'hover:bg-app-surface-2/50'
            }`}
            title={repo.path}
          >
            <FolderGit2 className="w-4 h-4 shrink-0 text-app-text-muted" />
            <span className="text-sm truncate flex-1">{repo.name}</span>
            <button
              onClick={(e) => {
                e.stopPropagation()
                removeRepo(repo.id)
              }}
              className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-app-danger hover:text-white transition-opacity"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
