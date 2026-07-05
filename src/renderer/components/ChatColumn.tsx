import { useState } from 'react'
import { Send } from 'lucide-react'

export function ChatColumn({ title }: { title: string }) {
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState<string[]>(['Hello from Cranberri.'])

  const send = () => {
    if (!input.trim()) return
    setMessages((m) => [...m, `User: ${input}`, `Codex: thinking...`])
    setInput('')
  }

  return (
    <div className="flex flex-col w-80 min-w-[280px] max-w-[480px] flex-shrink-0 rounded-lg border border-app-border bg-app-surface">
      <div className="h-9 flex items-center px-3 border-b border-app-border text-sm font-medium">
        {title}
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {messages.map((m, i) => (
          <div key={i} className="text-sm px-2 py-1.5 rounded bg-app-surface-2">
            {m}
          </div>
        ))}
      </div>

      <div className="p-2 border-t border-app-border">
        <div className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && send()}
            placeholder="Ask Codex..."
            className="flex-1 bg-app-bg border border-app-border rounded px-2 py-1 text-sm outline-none focus:border-app-accent"
          />
          <button onClick={send} className="p-1.5 rounded bg-app-accent text-black hover:opacity-90">
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  )
}
