import { useEffect, useState } from 'react'
import { RepoRail } from './components/RepoRail'
import { Workspace } from './components/Workspace'
import { RightRail } from './components/RightRail'
import { Header } from './components/Header'
import { SettingsDialog } from './components/SettingsDialog'

export function App() {
  const [settingsOpen, setSettingsOpen] = useState(false)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === ',') {
        event.preventDefault()
        setSettingsOpen(true)
      }
      if (event.key === 'Escape' && settingsOpen) {
        setSettingsOpen(false)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [settingsOpen])

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-app-bg text-app-text">
      <Header onOpenSettings={() => setSettingsOpen(true)} />
      <div className="flex flex-1 min-h-0 w-full overflow-hidden">
        <div className="h-full">
          <RepoRail />
        </div>
        <div className="flex-1 min-w-0 flex h-full min-h-0 overflow-hidden">
          <div className="flex-1 min-w-0 h-full overflow-hidden">
            <Workspace />
          </div>
          <div className="w-80 h-full overflow-hidden border-l border-app-border bg-app-surface shrink-0">
            <RightRail />
          </div>
        </div>
      </div>
      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  )
}