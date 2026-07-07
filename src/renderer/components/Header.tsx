import { Settings } from 'lucide-react'
import { useRepos } from '../state/repos'

export function Header({ onOpenSettings }: { onOpenSettings: () => void }) {
  const { activeRepo } = useRepos()

  return (
    <header className="h-10 flex items-center justify-between px-3 pl-[80px] border-b border-app-border bg-app-surface shrink-0 header-drag">
      <div className="flex items-center gap-2">
        <span className="text-base leading-none" aria-hidden="true">🫐</span>
        <span className="text-sm font-semibold tracking-tight">Cranberri</span>
      </div>
      <div className="flex items-center gap-3 text-xs text-app-text-muted">
        {activeRepo ? (
          <span className="font-mono truncate max-w-[400px]" title={activeRepo.path}>{activeRepo.path}</span>
        ) : (
          <span>No repo selected</span>
        )}
        <button
          type="button"
          onClick={onOpenSettings}
          className="p-1.5 rounded hover:bg-app-surface-2 text-app-text-muted hover:text-app-text"
          title="Settings (⌘,)"
        >
          <Settings className="w-4 h-4" />
        </button>
      </div>
    </header>
  )
}
