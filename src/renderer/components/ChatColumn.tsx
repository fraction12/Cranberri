import { useState } from 'react'
import { Send, Loader2 } from 'lucide-react'
import { useCodex } from '../state/codex'

export function ChatColumn({ title }: { title: string }) {
  const {
    activeThread,
    createThread,
    sendMessage,
    approve,
    interrupt,
  } = useCodex()

  const [input, setInput] = useState('')
  const isRunning = activeThread?.isRunning ?? false

  const handleSend = async () => {
    if (!input.trim()) return
    if (!activeThread) {
      await createThread(input)
      setInput('')
      return
    }
    await sendMessage(input)
    setInput('')
  }

  return (
    <div className="flex flex-col h-full min-w-[320px] bg-app-surface rounded border border-app-border">
      <div className="flex items-center justify-between px-3 py-2 border-b border-app-border">
        <span className="text-sm font-medium text-app-text">{title}</span>
        {isRunning && (
          <button
            onClick={() => interrupt()}
            className="text-xs px-2 py-1 rounded bg-app-danger text-white"
          >
            Stop
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {!activeThread && (
          <div className="text-sm text-app-text-muted">
            Start by sending a message.
          </div>
        )}
        {activeThread?.messages.map((msg) => (
          <div
            key={msg.id}
            className={`text-sm p-2 rounded ${
              msg.role === 'user'
                ? 'bg-app-accent/10 text-app-text'
                : 'bg-app-surface-2 text-app-text'
            }`}
          >
            <div className="text-[10px] uppercase text-app-text-muted mb-1">{msg.role}</div>
            <div className="whitespace-pre-wrap">{msg.content}</div>
          </div>
        ))}
        {activeThread?.pendingApprovals.map((approval) => (
          <div key={approval.id} className="border border-app-border rounded p-2 text-sm">
            <div className="text-app-text mb-1">{approval.description}</div>
            <button
              onClick={() => approve(approval.id)}
              className="px-3 py-1 rounded bg-app-accent text-app-bg text-sm font-medium"
            >
              Approve
            </button>
          </div>
        ))}
      </div>

      <div className="p-2 border-t border-app-border">
        <div className="flex items-center gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !isRunning && handleSend()}
            placeholder={isRunning ? 'Waiting...' : 'Ask Codex...'}
            disabled={isRunning}
            className="flex-1 bg-app-surface-2 border border-app-border rounded px-3 py-2 text-sm outline-none focus:border-app-accent"
          />
          <button
            onClick={handleSend}
            disabled={isRunning || !input.trim()}
            className="p-2 rounded bg-app-accent text-app-bg disabled:opacity-50"
          >
            {isRunning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </button>
        </div>
      </div>
    </div>
  )
}
