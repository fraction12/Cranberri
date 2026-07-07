export type CodexRole = 'user' | 'assistant' | 'system' | 'tool' | 'reasoning' | 'compact'

export type CodexSpeed = 'standard' | 'fast'
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

export const CODEX_SPEEDS: Array<{ label: string; value: CodexSpeed; description: string }> = [
  { label: 'Standard', value: 'standard', description: 'Default speed' },
  { label: 'Fast', value: 'fast', description: '1.5x speed, increased usage' },
]

export const CODEX_APPROVAL_MODES: Array<{
  value: CodexApprovalMode
  label: string
  description: string
}> = [
  { value: 'ask', label: 'Ask for approval', description: 'Always ask to edit external files and use the internet' },
  { value: 'approve', label: 'Approve for me', description: 'Only ask for actions detected as potentially unsafe' },
  { value: 'full', label: 'Full access', description: 'Unrestricted access to the internet and all files on your computer' },
  { value: 'custom', label: 'Custom (config.toml)', description: 'Uses permissions defined in config.toml' },
]

export interface CodexTurnSettings {
  model: string
  effort: CodexReasoningEffort
  speed?: CodexSpeed
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

export interface CodexSkillInfo {
  id: string
  name: string
  displayName: string
  description: string
  path: string
  source: 'personal' | 'system' | 'plugin'
  pluginName?: string
}

export type CodexUserInput =
  | { type: 'text'; text: string; text_elements?: Array<{ byteRange: { start: number; end: number }; placeholder?: string | null }> }
  | { type: 'skill'; name: string; path: string }

export interface CodexConnectionStatus {
  installed: boolean
  authenticated: boolean
  cliPath?: string
  detail: string
}

export interface CodexRateLimitWindow {
  usedPercent: number
  windowDurationMins: number
  resetsAt: number
}

export interface CodexRateLimitCredits {
  hasCredits: boolean
  unlimited: boolean
  balance: string
}

export interface CodexRateLimits {
  limitId: string
  limitName: string | null
  primary: CodexRateLimitWindow
  secondary: CodexRateLimitWindow
  credits: CodexRateLimitCredits | null
  individualLimit: unknown
  planType: string
  rateLimitReachedType: string | null
}

export interface CodexRateLimitResetCredits {
  availableCount: number
}

export interface CodexRateLimitsReadResult {
  rateLimits: CodexRateLimits
  rateLimitsByLimitId: Record<string, CodexRateLimits>
  rateLimitResetCredits: CodexRateLimitResetCredits
}

export interface CodexDailyUsageBucket {
  startDate: string
  tokens: number
}

export interface CodexAccountUsageReadResult {
  summary: {
    lifetimeTokens: number
    peakDailyTokens: number
    longestRunningTurnSec: number
    currentStreakDays: number
    longestStreakDays: number
  }
  dailyUsageBuckets: CodexDailyUsageBucket[]
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
  pending?: boolean
}

export interface CodexSdkThreadItem {
  id?: string
  type?: string
  text?: string
  phase?: string | null
  content?: Array<{ type?: string; text?: string }>
  summary?: string[]
}

export interface CodexSdkTurn {
  id: string
  items?: CodexSdkThreadItem[]
  startedAt?: number | null
  completedAt?: number | null
  durationMs?: number | null
  status?: unknown
}

export interface CodexSessionSummary {
  id: string
  sessionId?: string
  title: string
  preview: string
  cwd?: string
  createdAt: number
  updatedAt: number
  recencyAt?: number | null
  archived: boolean
  status?: unknown
  path?: string | null
  turnCount: number
}

export interface CodexSessionThread extends CodexSessionSummary {
  turns: CodexSdkTurn[]
}

export interface ToolCall {
  id: string
  function: string
  arguments: Record<string, unknown>
}

export interface PendingApproval {
  id: string
  reviewId: string
  targetItemId?: string | null
  action: unknown
  review: unknown
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
  isHistorical?: boolean
}

export type CodexEvent =
  | { type: 'thread_name_updated'; threadId: string; title: string }
  | { type: 'agent_message_delta'; threadId: string; itemId: string; delta: string; phase?: 'commentary' | 'final_answer' | string }
  | { type: 'agent_message_completed'; threadId: string; itemId: string; text: string; phase?: 'commentary' | 'final_answer' | string }
  | { type: 'tool_call'; threadId: string; tool: ToolCall }
  | { type: 'approval_request'; threadId: string; approval: PendingApproval }
  | { type: 'approval_completed'; threadId: string; reviewId: string; action: 'approved' | 'denied' | 'timedOut' | 'aborted' }
  | { type: 'run_start'; threadId: string }
  | { type: 'run_end'; threadId: string; error?: string }
  | { type: 'context_usage'; threadId: string; usedTokens: number; contextWindow: number }
  | { type: 'context_compaction'; threadId: string; state: 'started' | 'completed' | 'failed'; message?: string }
  | { type: 'final_answer'; threadId: string; text: string }
  | { type: 'item_started'; threadId: string; itemId?: string; itemType: string }
  | { type: 'log'; level: string; text: string }
