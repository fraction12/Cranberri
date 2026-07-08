import type { DiffResult, GitFileStatus } from '@/shared/git'

const MAX_REPO_CONTEXT_CHARS = 16000

function boundedTail(value: string, maxChars = MAX_REPO_CONTEXT_CHARS): string {
  const text = value.trim()
  if (text.length <= maxChars) return text
  return `${text.slice(-maxChars).trimStart()}\n\n[Repo context truncated: ${text.length - maxChars} chars omitted from the beginning]`
}

function changeLine(change: DiffResult['files'][number]['chunks'][number]['changes'][number]): string {
  const content = change.line.replace(/^[+\- ]/, '')
  if (change.type === 'add') return `+${content}`
  if (change.type === 'del') return `-${content}`
  return ` ${content}`
}

function diffFileText(file: DiffResult['files'][number]): string {
  return [
    `diff -- ${file.from && file.from !== file.to ? `${file.from} => ${file.to}` : file.to}`,
    `additions: ${file.additions}, deletions: ${file.deletions}`,
    ...file.chunks.map((chunk) => [
      `@@ -${chunk.oldStart},${chunk.oldLines} +${chunk.newStart},${chunk.newLines} @@`,
      ...chunk.changes.map(changeLine),
    ].join('\n')),
  ].join('\n')
}

function diffText(diff: DiffResult | null | undefined): string {
  const file = diff?.files[0]
  if (!file) return ''
  return file.chunks.map((chunk) => [
    `@@ -${chunk.oldStart},${chunk.oldLines} +${chunk.newStart},${chunk.newLines} @@`,
    ...chunk.changes.map(changeLine),
  ].join('\n')).join('\n\n')
}

export function repoFileChatContext(options: {
  repoPath: string
  file: GitFileStatus
  workingContent?: string | null
  headContent?: string | null
  diff?: DiffResult | null
}): string {
  const renderedDiff = diffText(options.diff)
  const preferredContent = options.file.status === 'deleted'
    ? options.headContent
    : options.workingContent ?? options.headContent
  const body = [
    renderedDiff ? 'Diff hunks:' : null,
    renderedDiff || null,
    preferredContent != null ? `${renderedDiff ? '\n' : ''}${options.file.status === 'deleted' ? 'HEAD content:' : 'Working content:'}` : null,
    preferredContent ?? null,
  ].filter((line): line is string => Boolean(line)).join('\n')

  return [
    'Repo file context:',
    `Repo: ${options.repoPath}`,
    `Path: ${options.file.path}`,
    `Status: ${options.file.status}`,
    '',
    boundedTail(body) || '[No file content or diff available]',
  ].join('\n')
}

export function repoChangesChatContext(options: {
  repoPath: string
  status: GitFileStatus[]
  diff?: DiffResult | null
}): string {
  const statusText = options.status.length
    ? options.status.map((file) => `- ${file.status}: ${file.path}`).join('\n')
    : 'No changed files.'
  const diffSummary = options.diff?.files.length
    ? options.diff.files.map((file) => `- ${file.to}: +${file.additions}/-${file.deletions}`).join('\n')
    : ''
  const diffBody = options.diff?.files.length
    ? options.diff.files.map(diffFileText).join('\n\n')
    : ''

  const body = [
    'Changed files:',
    statusText,
    diffSummary ? '\nDiff summary:' : null,
    diffSummary || null,
    diffBody ? '\nDiff hunks:' : null,
    diffBody || null,
  ].filter((line): line is string => Boolean(line)).join('\n')

  return [
    options.diff ? 'Repo diff context:' : 'Repo status context:',
    `Repo: ${options.repoPath}`,
    '',
    boundedTail(body) || '[No repo changes available]',
  ].join('\n')
}

export function repoChangesReviewChatContext(options: {
  repoPath: string
  status: GitFileStatus[]
  diff?: DiffResult | null
}): string {
  return [
    'Review these repo changes.',
    '',
    'Prioritize correctness bugs, regressions, missing tests, security/privacy issues, and risky edge cases.',
    'Lead with actionable findings and include file/path references when the diff gives enough evidence.',
    'If the changes look good, say so clearly and mention any residual risk or test gap.',
    '',
    repoChangesChatContext(options),
  ].join('\n')
}

export function repoChangesExplanationChatContext(options: {
  repoPath: string
  status: GitFileStatus[]
  diff?: DiffResult | null
}): string {
  return [
    'Explain these repo changes.',
    '',
    'Summarize what changed, why it likely matters, and how the pieces fit together.',
    'Call out user-visible behavior, important implementation details, test coverage, and risks or unknowns.',
    'Keep it readable for a maintainer who has not been following the work.',
    '',
    repoChangesChatContext(options),
  ].join('\n')
}

export function repoChangesTestPlanChatContext(options: {
  repoPath: string
  status: GitFileStatus[]
  diff?: DiffResult | null
}): string {
  return [
    'Write or update tests for these repo changes.',
    '',
    'Start by identifying the behavior changed by the diff, then add or update focused tests that would fail without the current implementation.',
    'Prefer the existing test style and the narrowest useful coverage. If tests are not appropriate, explain the reason and suggest the strongest replacement verification.',
    'After editing, run the relevant focused tests and report what passed or failed.',
    '',
    repoChangesChatContext(options),
  ].join('\n')
}

export function repoChangesPullRequestChatContext(options: {
  repoPath: string
  status: GitFileStatus[]
  diff?: DiffResult | null
}): string {
  return [
    'Draft a pull request description for these repo changes.',
    '',
    'Use the diff to write a concise PR title and body. Include Summary, Testing, and Risks sections.',
    'Call out user-visible behavior changes, important implementation details, and any follow-up work that should not block the PR.',
    'Do not invent verification. If the diff does not show tests or checks, say what should be run.',
    '',
    repoChangesChatContext(options),
  ].join('\n')
}
