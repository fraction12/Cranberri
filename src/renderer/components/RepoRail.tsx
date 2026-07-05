import { Plus, FolderGit2, X } from 'lucide-react'
import { useRepos } from '../state/repos'

export function RepoRail() {
  const { repos, activeRepoId, addRepo, removeRepo, setActiveRepo } = useRepos()

  return (
    <div className="w-16 flex flex-col items-center border-r border-app-border bg-app-surface py-2">
      <button
        onClick={addRepo}
        className="p-2 rounded hover:bg-app-surface-2 mb-3"
        title="Add repo"
      >
        <Plus className="w-5 h-5" />
      </button>

      <div className="flex flex-col gap-2 w-full px-2">
        {repos.map((repo) => (
          <button
            key={repo.id}
            onClick={() => setActiveRepo(repo.id)}
            className={`group relative flex flex-col items-center gap-1 p-2 rounded ${
              activeRepoId === repo.id ? 'bg-app-surface-2' : 'hover:bg-app-surface-2/50'
            }`}
            title={repo.path}
          >
            <FolderGit2 className="w-5 h-5" />
            <span className="text-[10px] max-w-full truncate leading-tight">{repo.name}</span>
            <span
              onClick={(e) => {
                e.stopPropagation()
                removeRepo(repo.id)
              }}
              className="absolute -top-1 -right-1 hidden group-hover:flex p-0.5 rounded bg-app-danger text-white"
            >
              <X className="w-3 h-3" />
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
