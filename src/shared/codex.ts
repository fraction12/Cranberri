export type CodexRole = 'user' | 'assistant' | 'system' | 'tool' | 'reasoning'

export type CodexReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh'
export type CodexApprovalMode = 'ask' | 'approve' | 'full' | 'custom'

export const CODEX_MODELS = [
  { label: 'GPT-5.5', value: 'gpt-5.5' },
  { label: 'GPT-5.4', value: 'gpt-5.4' },
  { label: 'GPT-5.4-Mini', value: 'gpt-5.4-mini' },
  { label: 'GPT-5.3-Codex-Spark', value: 'gpt-5.3-codex-spark' },
]

export const CODEX_EFFORTS: Array<{ label: string; value: CodexReasoningEffort }> = [
  { label: 'Light', value: 'low' },
  { label: 'Medium', value: 'medium' },
  { label: 'High', value: 'high' },
  { label: 'Extra High', value: 'xhigh' },
]

export const CODEX_APPROVAL_MODES: Array<{
  value: CodexApprovalMode
  label: string
  description: string
}> = [
  { value: 'ask', label: 'Ask for approval', description: 'Always ask to edit external files and use the internet' },
  { value: 'approve', label: 'Approve for me', description: 'Only ask for actions detected as potentially unsafe' },
  { value: 'full', label: 'Full access', description: 'Unrestricted access to the internet and any file on your computer' },
  { value: 'custom', label: 'Custom (config.toml)', description: 'Uses permissions defined in config.toml' },
]

export interface CodexTurnSettings {
  model: string
  effort: CodexReasoningEffort
  approvalMode?: CodexApprovalMode
}

export interface CodexPluginInfo {
  id: string
  name: string
  displayName: string
  description: string
  prompt: string
  icon?: string
  enabled: boolean
  toolCount: number
}

export interface CodexContextUsage {
  usedTokens: number
  contextWindow: number
}

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
  currentActivity?: string
  runStartedAt?: number
  lastRunDurationMs?: number
  contextUsage?: CodexContextUsage
}

export type CodexEvent =
  | { type: 'thread_name_updated'; threadId: string; title: string }
  | { type: 'agent_message_delta'; threadId: string; itemId: string; delta: string }
  | { type: 'agent_message_completed'; threadId: string; itemId: string; text: string; phase?: 'commentary' | 'final_answer' | string }
  | { type: 'tool_call'; threadId: string; tool: ToolCall }
  | { type: 'approval_request'; threadId: string; approval: PendingApproval }
  | { type: 'run_start'; threadId: string }
  | { type: 'run_end'; threadId: string; error?: string }
  | { type: 'context_usage'; threadId: string; usedTokens: number; contextWindow: number }
  | { type: 'final_answer'; threadId: string; text: string }
  | { type: 'item_started'; threadId: string; itemId?: string; itemType: string }
  | { type: 'log'; level: string; text: string }
