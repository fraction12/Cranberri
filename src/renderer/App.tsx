import { RepoRail } from './components/RepoRail'
import { ChatColumn } from './components/ChatColumn'
import { RightRail } from './components/RightRail'
import { Header } from './components/Header'

export function App() {
  return (
    <div className="flex flex-col h-screen bg-app-bg text-app-text overflow-hidden">
      <Header />
      <div className="flex flex-1 min-h-0">
        <RepoRail />
        <div className="flex-1 min-w-0 flex">
          <div className="flex-1 min-w-0 p-2 overflow-x-auto">
            <ChatColumn title="Chat" />
          </div>
          <div className="w-80 border-l border-app-border bg-app-surface shrink-0">
            <RightRail />
          </div>
        </div>
      </div>
    </div>
  )
}
