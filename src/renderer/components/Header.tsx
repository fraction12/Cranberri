import { Command, Settings } from 'lucide-react'
import { useRepos } from '../state/repos'

export function Header({ onOpenSettings, onOpenCommandPalette }: { onOpenSettings: () => void; onOpenCommandPalette: () => void }) {
  const { activeRepo } = useRepos()

  return (
    <header className="flex h-10 shrink-0 items-center justify-between border-b border-app-border bg-app-surface px-3 pl-[80px]">
      <div className="header-drag flex h-full flex-1 items-center gap-2">
        <span className="text-base leading-none" aria-hidden="true">🫐</span>
        <span className="text-sm font-semibold">Cranberri</span>
      </div>
      <div className="flex items-center gap-3 text-xs text-app-text-muted">
        {activeRepo ? (
          <span className="header-drag truncate font-mono max-w-[400px]" title={activeRepo.path}>{activeRepo.path}</span>
        ) : (
          <span className="header-drag">No repo selected</span>
        )}
        <button
          type="button"
          onClick={onOpenCommandPalette}
          className="no-drag rounded p-1.5 text-app-text-muted hover:bg-app-surface-2 hover:text-app-text"
          title="Command palette (⌘K)"
          aria-label="Open command palette"
        >
          <Command className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={onOpenSettings}
          className="no-drag rounded p-1.5 text-app-text-muted hover:bg-app-surface-2 hover:text-app-text"
          title="Settings (⌘,)"
          aria-label="Open settings"
        >
          <Settings className="w-4 h-4" />
        </button>
      </div>
    </header>
  )
}
