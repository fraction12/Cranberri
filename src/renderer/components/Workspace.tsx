import { useWorkspace } from '../state/workspace'
import { ChatWindow } from './ChatWindow'
import { TerminalWindow } from './TerminalWindow'
import { Plus, MessageSquare, Terminal, X } from 'lucide-react'

export function Workspace() {
  const { windows, activeWindowId, openChat, openTerminal, closeWindow, setActiveWindow } = useWorkspace()

  return (
    <div className="flex flex-col h-full w-full overflow-hidden">
      <div className="h-9 flex items-center border-b border-app-border bg-app-surface shrink-0 px-2 gap-1">
        {windows.map((win) => (
          <button
            key={win.id}
            onClick={() => setActiveWindow(win.id)}
            className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs max-w-[160px] ${
              activeWindowId === win.id
                ? 'bg-app-surface-2 text-app-text'
                : 'text-app-text-muted hover:bg-app-surface-2/50'
            }`}
          >
            {win.type === 'chat' ? <MessageSquare className="w-3.5 h-3.5" /> : <Terminal className="w-3.5 h-3.5" />}
            <span className="truncate">{win.title}</span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                closeWindow(win.id)
              }}
              className="ml-1 p-0.5 rounded hover:bg-app-border"
            >
              <X className="w-3 h-3" />
            </button>
          </button>
        ))}
        <div className="flex-1" />
        <button
          type="button"
          onClick={openChat}
          className="flex items-center gap-1 px-2 py-1 rounded text-xs text-app-text-muted hover:text-app-text hover:bg-app-surface-2"
        >
          <Plus className="w-3.5 h-3.5" />
          <MessageSquare className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={openTerminal}
          className="flex items-center gap-1 px-2 py-1 rounded text-xs text-app-text-muted hover:text-app-text hover:bg-app-surface-2"
        >
          <Plus className="w-3.5 h-3.5" />
          <Terminal className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="flex-1 min-h-0 relative">
        {windows.length === 0 && (
          <div className="flex items-center justify-center h-full text-sm text-app-text-muted">
            Open a chat or terminal window.
          </div>
        )}
        {windows.map((win) => (
          <div
            key={win.id}
            className={`absolute inset-0 ${activeWindowId === win.id ? 'block' : 'hidden'}`}
          >
            {win.type === 'chat' ? <ChatWindow id={win.id} /> : <TerminalWindow id={win.id} />}
          </div>
        ))}
      </div>
    </div>
  )
}
