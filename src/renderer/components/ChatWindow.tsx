import { useEffect, useRef, useState } from 'react'
import { Send, Loader2, Check, X } from 'lucide-react'
import { useCodex } from '../state/codex'
import { useWorkspace } from '../state/workspace'

export function ChatWindow({ id }: { id: string }) {
  const {
    createThread,
    sendMessage,
    abort,
    getThreadForWindow,
    activeThread,
  } = useCodex()
  const { renameWindow } = useWorkspace()
  const threadId = getThreadForWindow(id)
  const thread = threadId && activeThread?.id === threadId ? activeThread : undefined

  const [input, setInput] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!threadId) {
      createThread(id).catch((err) => console.error('Failed to create Codex thread:', err))
    }
  }, [id, threadId, createThread])

  useEffect(() => {
    if (thread?.title) {
      renameWindow(id, thread.title)
    }
  }, [id, thread?.title, renameWindow])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [thread?.messages.length])

  const handleSend = async () => {
    const text = input.trim()
    if (!text) return
    setInput('')
    await sendMessage(text)
  }

  const isRunning = thread?.isRunning ?? false

  return (
    <div className="flex flex-col h-full w-full bg-app-surface rounded border border-app-border overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-app-border shrink-0">
        <span className="text-sm font-medium text-app-text truncate max-w-[200px]">
          {thread?.title ?? `Chat ${id.slice(-4)}`}
        </span>
        {isRunning && (
          <button
            onClick={() => abort()}
            className="text-xs px-2 py-1 rounded bg-app-danger text-white flex items-center gap-1"
          >
            <Loader2 className="w-3 h-3 animate-spin" />
            Stop
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3 min-h-0">
        {!thread && (
          <div className="text-sm text-app-text-muted">Starting Codex thread...</div>
        )}
        {thread?.messages.length === 0 && (
          <div className="text-sm text-app-text-muted">Start by sending a message.</div>
        )}
        {thread?.messages.map((msg) => (
          <div
            key={msg.id}
            className={`text-sm p-2 rounded ${
              msg.role === 'user'
                ? 'bg-app-accent/10 text-app-text ml-6'
                : msg.role === 'system'
                  ? 'bg-app-surface-2 text-app-text-muted italic'
                  : 'bg-app-surface-2 text-app-text mr-6'
            }`}
          >
            <div className="text-[10px] uppercase text-app-text-muted mb-1">{msg.role}</div>
            <div className="whitespace-pre-wrap">{msg.content}</div>
          </div>
        ))}
        {thread?.pendingApprovals.map((approval) => (
          <div key={approval.id} className="p-3 rounded bg-app-warning/10 border border-app-warning/30 text-sm">
            <div className="font-medium text-app-text mb-1">Approval needed: {approval.tool}</div>
            <div className="text-app-text-muted mb-2">{approval.description}</div>
            <div className="flex gap-2">
              <button
                onClick={() => sendMessage('yes')}
                className="flex items-center gap-1 px-2 py-1 rounded bg-app-accent text-app-bg text-xs"
              >
                <Check className="w-3 h-3" /> Approve
              </button>
              <button
                onClick={() => sendMessage('no')}
                className="flex items-center gap-1 px-2 py-1 rounded bg-app-surface-2 text-app-text text-xs"
              >
                <X className="w-3 h-3" /> Deny
              </button>
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      <div className="p-2 border-t border-app-border shrink-0">
        <div className="flex items-center gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSend()}
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
