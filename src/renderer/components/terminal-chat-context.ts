const MAX_TERMINAL_CONTEXT_CHARS = 12000

function boundedText(value: string, maxChars = MAX_TERMINAL_CONTEXT_CHARS): string {
  const text = value.trim()
  if (text.length <= maxChars) return text
  return `${text.slice(-maxChars).trimStart()}\n\n[Terminal context truncated: ${text.length - maxChars} chars omitted from the beginning]`
}

export function terminalBufferChatContext(options: { terminalId: string; repoPath: string | null; text: string }): string {
  return [
    'Terminal context:',
    `Terminal: ${options.terminalId}`,
    options.repoPath ? `Repo: ${options.repoPath}` : null,
    '',
    'Terminal buffer:',
    boundedText(options.text) || '[No terminal output captured]',
  ].filter((line): line is string => line !== null).join('\n')
}
