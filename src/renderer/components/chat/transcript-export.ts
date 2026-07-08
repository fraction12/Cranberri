import type { CodexMessage, CodexThread } from '@/shared/codex'
import { stripCodexAppDirectives } from './assistant-response-context'

export function activeThreadExportFileName(thread: CodexThread): string {
  const baseName = (thread.title || 'cranberri-chat')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'cranberri-chat'
  return `${baseName}.md`
}

export function activeThreadMarkdownExport(thread: CodexThread, repoPath?: string | null, exportedAt = new Date()): string {
  const title = thread.title || 'Untitled chat'
  const lines = [
    `# ${title}`,
    '',
    `- Thread: ${thread.id}`,
    repoPath ? `- Repo: ${repoPath}` : null,
    `- Exported: ${exportedAt.toISOString()}`,
    thread.contextUsage ? `- Context: ${thread.contextUsage.usedTokens} / ${thread.contextUsage.contextWindow} tokens` : null,
    '',
    '## Transcript',
    '',
    ...thread.messages.flatMap(messageMarkdown),
  ].filter((line): line is string => line !== null)

  return `${lines.join('\n').trim()}\n`
}

function messageMarkdown(message: CodexMessage): string[] {
  const content = cleanMessageContent(message)
  if (!content) return []
  return [
    `### ${messageRoleTitle(message)} - ${new Date(message.timestamp).toISOString()}`,
    '',
    content,
    '',
  ]
}

function messageRoleTitle(message: CodexMessage): string {
  if (message.role === 'assistant') return message.pending ? 'Assistant (streaming)' : 'Assistant'
  if (message.role === 'user') return 'User'
  if (message.role === 'reasoning') return 'Reasoning'
  if (message.role === 'compact') return 'Compact Summary'
  return message.role.charAt(0).toUpperCase() + message.role.slice(1)
}

function cleanMessageContent(message: CodexMessage): string {
  const content = message.role === 'assistant'
    ? stripCodexAppDirectives(message.content)
    : message.content.trim()
  return content.trim()
}
