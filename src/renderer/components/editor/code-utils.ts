const EXTENSION_LANGUAGES: Record<string, string> = {
  cjs: 'javascript',
  css: 'css',
  html: 'html',
  js: 'javascript',
  jsx: 'jsx',
  json: 'json',
  jsonl: 'json',
  md: 'markdown',
  mdx: 'markdown',
  mjs: 'javascript',
  ts: 'typescript',
  tsx: 'tsx',
  yaml: 'yaml',
  yml: 'yaml',
}

const MARKDOWN_LANGUAGE_ALIASES: Record<string, string> = {
  js: 'javascript',
  jsx: 'jsx',
  md: 'markdown',
  sh: 'bash',
  ts: 'typescript',
  tsx: 'tsx',
}

export function languageFromFileName(filePath?: string | null): string | undefined {
  if (!filePath) return undefined
  const cleanPath = filePath.split(/[?#]/)[0]
  const fileName = cleanPath.split('/').pop() ?? cleanPath
  if (fileName === 'Dockerfile') return 'dockerfile'
  const extension = fileName.includes('.') ? fileName.split('.').pop()?.toLowerCase() : undefined
  return extension ? EXTENSION_LANGUAGES[extension] : undefined
}

export function languageFromMarkdownClass(className?: string): string | undefined {
  const match = className?.match(/language-([a-zA-Z0-9_-]+)/)
  const raw = match?.[1]?.toLowerCase()
  if (!raw) return undefined
  return MARKDOWN_LANGUAGE_ALIASES[raw] ?? raw
}

export function displayLanguage(language?: string, filePath?: string | null): string {
  return language ?? languageFromFileName(filePath) ?? 'text'
}

export function boundedCodeText(code: string, maxLines: number): { text: string; truncated: boolean; lineCount: number } {
  const lines = code.split('\n')
  if (lines.length <= maxLines) return { text: code, truncated: false, lineCount: lines.length }
  return {
    text: lines.slice(0, maxLines).join('\n'),
    truncated: true,
    lineCount: lines.length,
  }
}

export interface FocusedCodePreviewLine {
  number: number
  text: string
  focused: boolean
}

export interface FocusedCodePreview {
  lines: FocusedCodePreviewLine[]
  lineCount: number
  truncatedBefore: boolean
  truncatedAfter: boolean
  focusLine: number | null
}

export function focusedCodePreview(code: string, maxLines: number, focusLine?: number | null): FocusedCodePreview {
  const lines = code.split('\n')
  const lineCount = lines.length
  const boundedMaxLines = Math.max(1, Math.floor(maxLines))
  const normalizedFocusLine = focusLine && Number.isFinite(focusLine)
    ? Math.min(Math.max(Math.floor(focusLine), 1), lineCount)
    : null
  const startIndex = normalizedFocusLine && lineCount > boundedMaxLines
    ? Math.min(Math.max(normalizedFocusLine - Math.ceil(boundedMaxLines / 2), 0), lineCount - boundedMaxLines)
    : 0
  const endIndex = Math.min(lineCount, startIndex + boundedMaxLines)

  return {
    lines: lines.slice(startIndex, endIndex).map((text, index) => {
      const number = startIndex + index + 1
      return { number, text, focused: number === normalizedFocusLine }
    }),
    lineCount,
    truncatedBefore: startIndex > 0,
    truncatedAfter: endIndex < lineCount,
    focusLine: normalizedFocusLine,
  }
}
