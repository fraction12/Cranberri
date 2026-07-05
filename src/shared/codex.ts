export type CodexRole = 'user' | 'assistant' | 'system' | 'tool'

export interface CodexMessage {
  role: CodexRole
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
  | { type: 'thread_name_updated'; threadId: string; title: string }
  | { type: 'agent_message_delta'; threadId: string; itemId: string; delta: string }
  | { type: 'agent_message_completed'; threadId: string; itemId: string; text: string }
  | { type: 'tool_call'; threadId: string; tool: ToolCall }
  | { type: 'approval_request'; threadId: string; approval: PendingApproval }
  | { type: 'run_start'; threadId: string }
  | { type: 'run_end'; threadId: string; error?: string }
  | { type: 'item_started'; threadId: string; itemId?: string; itemType: string }
  | { type: 'log'; level: string; text: string }
