import { Command } from 'lucide-react'
import { useRepos } from '../state/repos'

export function Header() {
  const { activeRepo } = useRepos()

  return (
    <header className="h-10 flex items-center justify-between px-3 pl-[80px] border-b border-app-border bg-app-surface shrink-0 header-drag">
      <div className="flex items-center gap-2">
        <Command className="w-4 h-4 text-app-accent" />
        <span className="text-sm font-semibold tracking-tight">Cranberri</span>
      </div>
      <div className="flex items-center gap-3 text-xs text-app-text-muted">
        {activeRepo ? (
          <span className="font-mono truncate max-w-[400px]" title={activeRepo.path}>{activeRepo.path}</span>
        ) : (
          <span>No repo selected</span>
        )}
      </div>
    </header>
  )
}
