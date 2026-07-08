import type { CodexMessage, CodexThread } from '@/shared/codex'

const MAX_ACTIVE_CHAT_CONTEXT_CHARS = 12000
const MAX_MESSAGES = 18
const MAX_MESSAGE_CHARS = 1200

function truncateTail(value: string, maxChars: number): string {
  const text = value.trim()
  if (text.length <= maxChars) return text
  const keep = Math.floor((maxChars - 70) / 2)
  return [
    text.slice(0, keep).trimEnd(),
    `[Message truncated: ${text.length - (keep * 2)} chars omitted]`,
    text.slice(-keep).trimStart(),
  ].join('\n')
}

function truncateMiddle(value: string, maxChars = MAX_ACTIVE_CHAT_CONTEXT_CHARS): string {
  const text = value.trim()
  if (text.length <= maxChars) return text
  const keep = Math.floor((maxChars - 100) / 2)
  return [
    text.slice(0, keep).trimEnd(),
    '',
    `[Active chat context truncated: ${text.length - (keep * 2)} chars omitted from the middle]`,
    '',
    text.slice(-keep).trimStart(),
  ].join('\n')
}

function formatNumber(value: number): string {
  return Number.isFinite(value) ? Math.round(value).toLocaleString('en-US') : 'unknown'
}

function formatDuration(ms: number | undefined): string {
  if (!ms || !Number.isFinite(ms)) return 'unknown'
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(ms >= 10000 ? 0 : 1)}s`
}

function formatMessage(message: CodexMessage): string {
  return [
    `- ${message.role}${message.pending ? ' (pending)' : ''}:`,
    indent(truncateTail(message.content, MAX_MESSAGE_CHARS)),
  ].join('\n')
}

function indent(value: string): string {
  return value.split('\n').map((line) => `  ${line}`).join('\n')
}

export function activeChatContext(thread: CodexThread): string {
  const shownMessages = thread.messages.slice(-MAX_MESSAGES)
  const omittedMessages = Math.max(0, thread.messages.length - shownMessages.length)
  const contextUsage = thread.contextUsage
  const pendingApprovals = thread.pendingApprovals.map((approval) => `- ${approval.description || approval.id}`).join('\n')

  const body = [
    'Active chat context:',
    '',
    'Thread:',
    `- ID: ${thread.id}`,
    `- Title: ${thread.title || 'Untitled'}`,
    `- Repo ID: ${thread.repoId}`,
    `- Running: ${thread.isRunning}`,
    thread.currentActivity ? `- Activity: ${thread.currentActivity}` : '- Activity: none',
    `- Last run duration: ${formatDuration(thread.lastRunDurationMs)}`,
    `- Messages: ${thread.messages.length}`,
    `- Pending approvals: ${thread.pendingApprovals.length}`,
    contextUsage
      ? `- Context usage: ${formatNumber(contextUsage.usedTokens)} / ${formatNumber(contextUsage.contextWindow)} tokens (${Math.round((contextUsage.usedTokens / Math.max(1, contextUsage.contextWindow)) * 100)}%)`
      : '- Context usage: unknown',
    '',
    'Pending approvals:',
    pendingApprovals || '- none',
    '',
    'Recent messages:',
    omittedMessages ? `- ${omittedMessages} earlier message${omittedMessages === 1 ? '' : 's'} omitted` : '- no earlier messages omitted',
    ...shownMessages.map(formatMessage),
  ].join('\n')

  return truncateMiddle(body)
}
