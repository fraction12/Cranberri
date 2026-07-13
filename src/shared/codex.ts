import type { ToolEventRecord } from './tools'
import type { CodexPendingHumanServerRequest, CodexRequestOutcomeEntry } from './codex-requests'

export type CodexRole = 'user' | 'assistant' | 'system' | 'tool' | 'reasoning' | 'compact'

export type CodexSpeed = 'standard' | 'fast'
export type CodexServiceTier = 'priority'
export const CODEX_REASONING_EFFORT_VALUES = ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'] as const
export type CodexReasoningEffort = (typeof CODEX_REASONING_EFFORT_VALUES)[number]
export type CodexApprovalMode = 'ask' | 'approve' | 'full' | 'custom'

export interface CodexModelOption {
  label: string
  value: string
  description: string
  defaultEffort: CodexReasoningEffort
  supportedEfforts: readonly CodexReasoningEffort[]
  serviceTiers: readonly CodexServiceTier[]
}

const STANDARD_EFFORTS = ['low', 'medium', 'high', 'xhigh'] as const satisfies readonly CodexReasoningEffort[]
const MAX_EFFORTS = [...STANDARD_EFFORTS, 'max'] as const satisfies readonly CodexReasoningEffort[]
const ULTRA_EFFORTS = [...MAX_EFFORTS, 'ultra'] as const satisfies readonly CodexReasoningEffort[]
const PRIORITY_SERVICE_TIER = ['priority'] as const satisfies readonly CodexServiceTier[]

export const CODEX_MODELS: readonly CodexModelOption[] = [
  {
    label: 'GPT-5.6-Sol',
    value: 'gpt-5.6-sol',
    description: 'Most capable',
    defaultEffort: 'low',
    supportedEfforts: ULTRA_EFFORTS,
    serviceTiers: PRIORITY_SERVICE_TIER,
  },
  {
    label: 'GPT-5.6-Terra',
    value: 'gpt-5.6-terra',
    description: 'Balanced',
    defaultEffort: 'medium',
    supportedEfforts: ULTRA_EFFORTS,
    serviceTiers: PRIORITY_SERVICE_TIER,
  },
  {
    label: 'GPT-5.6-Luna',
    value: 'gpt-5.6-luna',
    description: 'Fastest',
    defaultEffort: 'medium',
    supportedEfforts: MAX_EFFORTS,
    serviceTiers: PRIORITY_SERVICE_TIER,
  },
  {
    label: 'GPT-5.5',
    value: 'gpt-5.5',
    description: 'Previous flagship',
    defaultEffort: 'medium',
    supportedEfforts: STANDARD_EFFORTS,
    serviceTiers: PRIORITY_SERVICE_TIER,
  },
  {
    label: 'GPT-5.4',
    value: 'gpt-5.4',
    description: 'General coding',
    defaultEffort: 'medium',
    supportedEfforts: STANDARD_EFFORTS,
    serviceTiers: PRIORITY_SERVICE_TIER,
  },
  {
    label: 'GPT-5.4-Mini',
    value: 'gpt-5.4-mini',
    description: 'Efficient coding',
    defaultEffort: 'medium',
    supportedEfforts: STANDARD_EFFORTS,
    serviceTiers: [],
  },
  {
    label: 'GPT-5.3-Codex-Spark',
    value: 'gpt-5.3-codex-spark',
    description: 'Low latency',
    defaultEffort: 'high',
    supportedEfforts: STANDARD_EFFORTS,
    serviceTiers: [],
  },
]

export const CODEX_EFFORTS: Array<{ label: string; value: CodexReasoningEffort }> = [
  { label: 'Light', value: 'low' },
  { label: 'Medium', value: 'medium' },
  { label: 'High', value: 'high' },
  { label: 'Extra High', value: 'xhigh' },
  { label: 'Max', value: 'max' },
  { label: 'Ultra', value: 'ultra' },
]

export function getCodexModelOption(model: string): CodexModelOption | undefined {
  return CODEX_MODELS.find((option) => option.value === model)
}

export function getCodexEffortsForModel(model: string): typeof CODEX_EFFORTS {
  const supportedEfforts = getCodexModelOption(model)?.supportedEfforts
  if (!supportedEfforts) return CODEX_EFFORTS
  return CODEX_EFFORTS.filter((option) => supportedEfforts.includes(option.value))
}

export function normalizeCodexReasoningEffort(
  model: string,
  effort: CodexReasoningEffort,
): CodexReasoningEffort {
  const option = getCodexModelOption(model)
  if (!option || option.supportedEfforts.includes(effort)) return effort
  return option.defaultEffort
}

export const CODEX_SPEEDS: Array<{ label: string; value: CodexSpeed; description: string }> = [
  { label: 'Standard', value: 'standard', description: 'Default speed' },
  { label: 'Fast', value: 'fast', description: '1.5x speed, increased usage' },
]

export function getCodexSpeedsForModel(model: string): typeof CODEX_SPEEDS {
  const option = getCodexModelOption(model)
  if (!option || option.serviceTiers.includes('priority')) return CODEX_SPEEDS
  return CODEX_SPEEDS.filter((speed) => speed.value === 'standard')
}

export function normalizeCodexSpeed(model: string, speed?: CodexSpeed): CodexSpeed | undefined {
  if (!speed) return undefined
  const option = getCodexModelOption(model)
  if (!option || speed === 'standard' || option.serviceTiers.includes('priority')) return speed
  return 'standard'
}

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

export interface CodexRuntimeContext {
  cwd: string
  runtimeRoots?: string[]
  taskId?: string
  dynamicTools?: Array<Record<string, unknown>>
}

export interface CodexTransportCapabilities {
  cwdArrayHistory: boolean
  explicitTurnCwd: boolean
  dynamicTools: boolean
}

export interface CodexServerRequestContext {
  id: string | number
  method: string
}

export type CodexServerRequestHandler = (
  params: Record<string, unknown>,
  context: CodexServerRequestContext,
) => unknown | Promise<unknown>

export interface CodexPluginInfo {
  id: string
  name: string
  displayName: string
  description: string
  prompt: string
  icon?: string
  enabled: boolean
  toolCount: number
  installed?: boolean
  marketplaceName?: string
  version?: string
  installPolicy?: string
  authPolicy?: string
  sourceLabel?: string
}

export interface CodexPluginActionResult {
  ok: boolean
  pluginId?: string
  output?: unknown
  message?: string
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
  | { type: 'image'; url: string; detail?: 'auto' | 'low' | 'high' }
  | { type: 'localImage'; path: string; detail?: 'auto' | 'low' | 'high' }
  | { type: 'skill'; name: string; path: string }

export interface CodexConnectionStatus {
  installed: boolean
  authenticated: boolean
  runtimeSource?: 'automatic' | 'custom'
  cliPath?: string
  version?: string
  minimumVersion?: string
  updateRequired?: boolean
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
  turnId?: string
}

export type CodexActivityItemKind =
  | 'commentary'
  | 'reasoning'
  | 'plan'
  | 'command'
  | 'file_change'
  | 'web_search'
  | 'mcp_tool'
  | 'dynamic_tool'
  | 'collaboration'
  | 'subagent'
  | 'image'
  | 'sleep'
  | 'review'
  | 'compaction'
  | 'steering'
  | 'other'

export type CodexActivityItemStatus = 'running' | 'completed' | 'failed' | 'declined'
export type CodexActivityTurnStatus = 'running' | 'completed' | 'failed' | 'interrupted'

export interface CodexCommandActivityDetail {
  type: 'commandExecution'
  command?: string
  commandActions?: CodexSdkCommandAction[]
  cwd?: unknown
  processId?: string | null
  source?: string
  aggregatedOutput?: unknown
  exitCode?: number | null
  durationMs?: number | null
}

export interface CodexFileChangeActivityDetail {
  type: 'fileChange'
  changes?: CodexSdkFileChange[]
  applyStatus?: unknown
  error?: unknown
}

export interface CodexMcpToolCallActivityDetail {
  type: 'mcpToolCall'
  server?: string
  tool?: string
  appContext?: CodexSdkMcpToolCallAppContext | null
  mcpAppResourceUri?: string
  pluginId?: string | null
  arguments?: unknown
  result?: unknown
  error?: unknown
  durationMs?: number | null
}

export interface CodexDynamicToolCallActivityDetail {
  type: 'dynamicToolCall'
  namespace?: string | null
  tool?: string
  arguments?: unknown
  contentItems?: CodexSdkDynamicToolCallOutputContentItem[] | null
  success?: boolean | null
  result?: unknown
  error?: unknown
  durationMs?: number | null
}

export interface CodexHookPromptActivityDetail {
  type: 'hookPrompt'
  fragments?: CodexSdkHookPromptFragment[]
}

export interface CodexAgentMessageActivityDetail {
  type: 'agentMessage'
  phase?: string | null
  memoryCitation?: CodexSdkMemoryCitation | null
}

export interface CodexReasoningActivityDetail {
  type: 'reasoning'
  summary?: string[]
  content?: string[]
}

export interface CodexWebSearchActivityDetail {
  type: 'webSearch'
  query?: string
  action?: CodexSdkWebSearchAction | null
}

export interface CodexCollaborationActivityDetail {
  type: 'collabAgentToolCall'
  tool?: string
  senderThreadId?: string
  receiverThreadIds?: string[]
  prompt?: string | null
  model?: string | null
  reasoningEffort?: CodexReasoningEffort | string | null
  agentsStates?: Record<string, CodexSdkCollabAgentState | undefined>
}

export interface CodexSubAgentActivityDetail {
  type: 'subAgentActivity'
  kind?: string
  agentThreadId?: string
  agentPath?: string
}

export interface CodexImageViewActivityDetail {
  type: 'imageView'
  path?: string
}

export interface CodexImageGenerationActivityDetail {
  type: 'imageGeneration'
  generationStatus?: string
  revisedPrompt?: string | null
  result?: string
  savedPath?: string
}

export interface CodexSleepActivityDetail {
  type: 'sleep'
  durationMs?: number
}

export interface CodexReviewActivityDetail {
  type: 'enteredReviewMode' | 'exitedReviewMode'
  review?: string
}

export interface CodexCompactionActivityDetail {
  type: 'contextCompaction'
}

export type CodexActivityDetail =
  | CodexHookPromptActivityDetail
  | CodexAgentMessageActivityDetail
  | CodexReasoningActivityDetail
  | CodexCommandActivityDetail
  | CodexFileChangeActivityDetail
  | CodexWebSearchActivityDetail
  | CodexMcpToolCallActivityDetail
  | CodexDynamicToolCallActivityDetail
  | CodexCollaborationActivityDetail
  | CodexSubAgentActivityDetail
  | CodexImageViewActivityDetail
  | CodexImageGenerationActivityDetail
  | CodexSleepActivityDetail
  | CodexReviewActivityDetail
  | CodexCompactionActivityDetail

export interface CodexActivityItem {
  id: string
  kind: CodexActivityItemKind
  status: CodexActivityItemStatus
  title: string
  detail?: string
  content?: string
  activityDetail?: CodexActivityDetail
  startedAt?: number
  completedAt?: number
  durationMs?: number
}

export interface CodexActivityTurn {
  id: string
  status: CodexActivityTurnStatus
  startedAt: number
  completedAt?: number
  durationMs?: number
  items: CodexActivityItem[]
}

export interface CodexSdkCommandAction {
  type?: string
  command?: string
  name?: string
  path?: unknown
  query?: string | null
}

export interface CodexSdkFileChange {
  path?: string
  kind?: unknown
  diff?: string
}

export interface CodexSdkHookPromptFragment {
  text: string
  hookRunId: string
}

export interface CodexSdkMemoryCitationEntry {
  path: string
  lineStart: number
  lineEnd: number
  note: string
}

export interface CodexSdkMemoryCitation {
  entries: CodexSdkMemoryCitationEntry[]
  threadIds: string[]
}

export interface CodexSdkMcpToolCallAppContext {
  connectorId: string
  linkId: string | null
  resourceUri: string | null
  appName: string | null
  templateId: string | null
  actionName: string | null
}

export type CodexSdkDynamicToolCallOutputContentItem =
  | { type: 'inputText'; text: string }
  | { type: 'inputImage'; imageUrl: string }

export type CodexSdkWebSearchAction =
  | { type: 'search'; query: string | null; queries: string[] | null }
  | { type: 'openPage'; url: string | null }
  | { type: 'findInPage'; url: string | null; pattern: string | null }
  | { type: 'other' }

export interface CodexSdkCollabAgentState {
  status: string
  message: string | null
}

export interface CodexSdkThreadItem {
  id?: string
  type?: string
  text?: string
  phase?: string | null
  clientId?: string | null
  content?: Array<Record<string, unknown> | string>
  fragments?: CodexSdkHookPromptFragment[]
  memoryCitation?: CodexSdkMemoryCitation | null
  summary?: string[]
  command?: string
  cwd?: unknown
  processId?: string | null
  source?: string
  commandActions?: CodexSdkCommandAction[]
  aggregatedOutput?: unknown
  exitCode?: number | null
  durationMs?: number | null
  changes?: CodexSdkFileChange[]
  server?: string
  namespace?: string | null
  appContext?: CodexSdkMcpToolCallAppContext | null
  mcpAppResourceUri?: string
  pluginId?: string | null
  arguments?: unknown
  contentItems?: CodexSdkDynamicToolCallOutputContentItem[] | null
  result?: unknown
  error?: unknown
  success?: boolean | null
  query?: string
  action?: CodexSdkWebSearchAction | null
  path?: unknown
  revisedPrompt?: string | null
  savedPath?: string
  review?: string
  tool?: 'spawnAgent' | 'sendInput' | 'resumeAgent' | 'wait' | 'closeAgent' | 'spawn_agent' | 'send_input' | 'resume_agent' | 'close_agent' | string
  status?: unknown
  senderThreadId?: string
  receiverThreadIds?: string[]
  receiverThreadId?: string | null
  newThreadId?: string | null
  prompt?: string | null
  model?: string | null
  reasoningEffort?: CodexReasoningEffort | string | null
  agentsStates?: Record<string, CodexSdkCollabAgentState | undefined>
  agentStatus?: string | { status?: string; message?: string | null } | null
  kind?: 'started' | 'interacted' | 'interrupted' | string
  agentThreadId?: string
  agentPath?: string
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
  forkedFromId?: string | null
  parentThreadId?: string | null
  ephemeral?: boolean
  source?: unknown
  threadSource?: string | null
  agentNickname?: string | null
  agentRole?: string | null
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
  workers?: CodexWorker[]
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

export type CodexWorkerStatus =
  | 'pendingInit'
  | 'running'
  | 'idle'
  | 'interrupted'
  | 'completed'
  | 'errored'
  | 'shutdown'
  | 'notFound'

export interface CodexWorker {
  threadId: string
  parentThreadId: string
  sessionId?: string
  title?: string
  nickname?: string
  role?: string
  prompt?: string
  lastInstruction?: string
  model?: string
  reasoningEffort?: string
  status: CodexWorkerStatus
  message?: string
  cwd?: string
  agentPath?: string
  ephemeral?: boolean
  source?: unknown
  createdAt?: number
  updatedAt: number
  workers?: CodexWorker[]
}

export interface CodexThread {
  id: string
  title: string
  repoId: string
  messages: CodexMessage[]
  activityTurns?: CodexActivityTurn[]
  pendingApprovals: PendingApproval[]
  pendingHumanRequests?: CodexPendingHumanServerRequest[]
  humanRequestOutcomes?: CodexRequestOutcomeEntry[]
  isRunning: boolean
  currentActivity?: string
  runStartedAt?: number
  lastRunDurationMs?: number
  contextUsage?: CodexContextUsage
  isHistorical?: boolean
  sessionId?: string
  parentThreadId?: string | null
  agentNickname?: string | null
  agentRole?: string | null
  workers?: CodexWorker[]
}

export type CodexItemProgress =
  | { type: 'command_output'; delta: string }
  | { type: 'file_output'; delta: string }
  | { type: 'file_patch'; changes: CodexSdkFileChange[] }
  | { type: 'mcp_progress'; message: string }

export type CodexEvent =
  | { type: 'thread_name_updated'; threadId: string; title: string }
  | { type: 'agent_message_delta'; threadId: string; turnId?: string; itemId: string; delta: string; phase?: 'commentary' | 'final_answer' | string }
  | { type: 'agent_message_completed'; threadId: string; turnId?: string; itemId: string; text: string; phase?: 'commentary' | 'final_answer' | string }
  | { type: 'tool_call'; threadId: string; tool: ToolCall }
  | { type: 'tool_event'; threadId: string; event: ToolEventRecord }
  | { type: 'approval_request'; threadId: string; approval: PendingApproval }
  | { type: 'approval_completed'; threadId: string; reviewId: string; action: 'approved' | 'denied' | 'timedOut' | 'aborted' }
  | { type: 'human_request_pending'; threadId: string; pending: CodexPendingHumanServerRequest }
  | { type: 'human_request_outcome'; threadId: string; outcome: CodexRequestOutcomeEntry }
  | { type: 'server_request_resolved'; threadId: string; requestId: string | number }
  | { type: 'run_start'; threadId: string; turnId?: string; startedAt?: number }
  | { type: 'run_end'; threadId: string; turnId?: string; status?: CodexActivityTurnStatus; completedAt?: number; durationMs?: number; error?: string }
  | { type: 'context_usage'; threadId: string; usedTokens: number; contextWindow: number }
  | { type: 'context_compaction'; threadId: string; turnId?: string; state: 'started' | 'completed' | 'failed'; message?: string }
  | { type: 'worker_updated'; threadId: string; worker: CodexWorker }
  | { type: 'final_answer'; threadId: string; text: string }
  | { type: 'item_started'; threadId: string; turnId?: string; itemId?: string; itemType: string; item?: CodexSdkThreadItem; startedAt?: number }
  | { type: 'item_completed'; threadId: string; turnId?: string; itemId?: string; itemType: string; item?: CodexSdkThreadItem; completedAt?: number }
  | { type: 'item_progress'; threadId: string; turnId: string; itemId: string; progress: CodexItemProgress }
  | { type: 'turn_diff_updated'; threadId: string; turnId: string; diff: string }
  | { type: 'log'; level: string; text: string }
