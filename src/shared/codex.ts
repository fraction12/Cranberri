export interface CodexMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
  id: string
  timestamp: number
}

export interface ToolCall {
  id: string
  function: string
  arguments: Record<string, unknown>
}

export interface PendingApproval {
  id: string
  tool: string
  args: Record<string, unknown>
  description: string
}

export interface CodexThread {
  id: string
  title: string
  repoId: string
  messages: CodexMessage[]
  pendingApprovals: PendingApproval[]
  isRunning: boolean
}

export type CodexEvent =
  | { type: 'text'; threadId: string; text: string }
  | { type: 'tool_call'; threadId: string; tool: ToolCall }
  | { type: 'approval_request'; threadId: string; approval: PendingApproval }
  | { type: 'run_start'; threadId: string }
  | { type: 'run_end'; threadId: string; error?: string }

export interface CodexSessionState {
  threads: CodexThread[]
  activeThreadId: string | null
}
