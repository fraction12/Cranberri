import { Group, Panel, Separator } from 'react-resizable-panels'
import { useState } from 'react'
import { RepoRail } from './components/RepoRail'
import { ChatColumn } from './components/ChatColumn'
import { RightRail } from './components/RightRail'

export function App() {
  const [rightRailOpen, setRightRailOpen] = useState(true)

  return (
    <div className="flex h-full w-full bg-app-bg text-app-text">
      <RepoRail />

      <div className="flex flex-1 flex-col min-w-0">
        <header className="h-11 flex items-center justify-between border-b border-app-border px-3">
          <div className="flex items-center gap-2">
            <span className="font-semibold">Cranberri</span>
            <span className="text-xs text-app-text-muted">Experimental</span>
          </div>
          <button
            onClick={() => setRightRailOpen((s) => !s)}
            className="px-2 py-1 text-xs rounded hover:bg-app-surface-2"
          >
            {rightRailOpen ? 'Hide' : 'Show'} context
          </button>
        </header>

        <Group orientation="horizontal" className="flex-1 min-h-0">
          <Panel defaultSize={75} minSize={40}>
            <div className="flex h-full gap-2 p-2 overflow-x-auto">
              <ChatColumn title="Thread 1" />
              <ChatColumn title="Thread 2" />
            </div>
          </Panel>

          {rightRailOpen && (
            <>
              <Separator className="w-1 bg-app-border hover:bg-app-accent transition-colors" />
              <Panel defaultSize={25} minSize={20} maxSize={40}>
                <RightRail />
              </Panel>
            </>
          )}
        </Group>
      </div>
    </div>
  )
}
