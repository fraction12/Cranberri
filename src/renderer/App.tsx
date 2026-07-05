import { RepoRail } from './components/RepoRail'
import { Workspace } from './components/Workspace'
import { RightRail } from './components/RightRail'
import { Header } from './components/Header'

export function App() {
  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-app-bg text-app-text">
      <Header />
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
    </div>
  )
}
