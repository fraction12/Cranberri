import type { CodexMessage } from '@/shared/codex'

const ASSISTANT_RESPONSE_CONTEXT_MAX_CHARS = 12000
const USER_PROMPT_CONTEXT_MAX_CHARS = 12000

export function stripCodexAppDirectives(text: string): string {
  return text
    .split('\n')
    .filter((line) => !/^::[a-z][a-z-]*\{.*\}\s*$/.test(line.trim()))
    .join('\n')
    .trim()
}

export function assistantResponseChatContext(text: string): string {
  const cleanText = stripCodexAppDirectives(text).trim()
  if (cleanText.length <= ASSISTANT_RESPONSE_CONTEXT_MAX_CHARS) {
    return `Assistant response context:\n${cleanText}`
  }

  return [
    'Assistant response context:',
    cleanText.slice(0, ASSISTANT_RESPONSE_CONTEXT_MAX_CHARS),
    `... truncated ${cleanText.length - ASSISTANT_RESPONSE_CONTEXT_MAX_CHARS} more characters`,
  ].join('\n')
}

export function latestReusableAssistantMessage(messages: CodexMessage[]): CodexMessage | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message.role === 'assistant' && !message.pending && message.content.trim()) return message
  }
  return null
}

export function userPromptChatContext(text: string): string {
  const cleanText = text.trim()
  if (cleanText.length <= USER_PROMPT_CONTEXT_MAX_CHARS) {
    return `User prompt context:\n${cleanText}`
  }

  return [
    'User prompt context:',
    cleanText.slice(0, USER_PROMPT_CONTEXT_MAX_CHARS),
    `... truncated ${cleanText.length - USER_PROMPT_CONTEXT_MAX_CHARS} more characters`,
  ].join('\n')
}

export function latestReusableUserMessage(messages: CodexMessage[]): CodexMessage | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message.role === 'user' && !message.pending && message.content.trim()) return message
  }
  return null
}
