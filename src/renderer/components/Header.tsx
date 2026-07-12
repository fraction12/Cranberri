import { Command, Settings } from 'lucide-react'
import { useRepos } from '../state/repos'
import { cn } from '../lib/ui'
import { typeStyle } from '../lib/typography'
import appIcon from '../../../buildResources/icon-1024.png'
import { IconButton } from './ui/IconButton'

interface HeaderProps {
  commandPaletteOpen: boolean
  onOpenSettings: () => void
  onOpenCommandPalette: () => void
}

export function Header({ commandPaletteOpen, onOpenSettings, onOpenCommandPalette }: HeaderProps) {
  const { activeRepo } = useRepos()

  return (
    <header className="relative z-10 flex h-10 shrink-0 items-center justify-between bg-app-surface px-2.5 pl-[80px] shadow-sm">
      <div className="header-drag flex h-full min-w-0 flex-1 items-center gap-1.5">
        <span className="relative h-5 w-5 shrink-0 overflow-hidden" aria-hidden="true">
          <img src={appIcon} alt="" className="absolute left-1/2 top-1/2 h-[38px] w-[38px] max-w-none -translate-x-1/2 -translate-y-1/2" />
        </span>
        <span className={typeStyle({ role: 'panelTitle', tone: 'primary' })}>Cranberri</span>
      </div>
      <div className="flex min-w-0 items-center gap-1.5">
        {activeRepo ? (
          <span className={cn('header-drag max-w-[min(44vw,560px)] truncate', typeStyle({ role: 'metadata', tone: 'tertiary', family: 'mono' }))} title={activeRepo.path}>{activeRepo.path}</span>
        ) : (
          <span className={cn('header-drag', typeStyle({ role: 'metadata', tone: 'tertiary' }))}>No repo selected</span>
        )}
        <IconButton
          id="command-palette-trigger"
          type="button"
          onClick={onOpenCommandPalette}
          className="no-drag"
          label="Open command palette"
          aria-haspopup="dialog"
          aria-expanded={commandPaletteOpen}
        >
          <Command className="w-4 h-4" />
        </IconButton>
        <IconButton
          id="settings-trigger"
          type="button"
          onClick={onOpenSettings}
          className="no-drag"
          label="Open settings"
        >
          <Settings className="w-4 h-4" />
        </IconButton>
      </div>
    </header>
  )
}
