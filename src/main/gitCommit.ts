import simpleGit from 'simple-git'
import type { GitCommitMessageDraft } from '@/shared/git'

export interface CommitMessage {
  title: string
  summary: string
}

export const COMMIT_MESSAGE_DRAFT_CONTEXT_MAX_CHARS = 60_000

export function normalizeManualCommitMessage(titleInput: string, summaryInput: string): CommitMessage {
  const title = titleInput.trim()
  const summary = summaryInput.trim()

  if (!title) throw new Error('Commit title is required')
  if (title.includes('\n')) throw new Error('Commit title must be one line')

  return { title, summary }
}

export async function commitRepo(repoPath: string, titleInput: string, summaryInput: string): Promise<CommitMessage & { hash: string }> {
  const git = simpleGit(repoPath)
  await git.add(['-A'])
  const diff = await git.diff(['--cached'])
  if (!diff.trim()) throw new Error('No changes to commit')

  const message = normalizeManualCommitMessage(titleInput, summaryInput)
  const args = message.summary ? { '--message': message.summary } : undefined
  const result = await git.commit(message.title, undefined, args)
  return { ...message, hash: result.commit }
}

export function truncateCommitMessageDraftContext(input: string, maxChars = COMMIT_MESSAGE_DRAFT_CONTEXT_MAX_CHARS): string {
  if (input.length <= maxChars) return input
  return `${input.slice(0, maxChars)}\n\n[truncated ${input.length - maxChars} characters]`
}

export function buildCommitMessageDraftPrompt(options: {
  statusSummary: string
  stagedDiff: string
  unstagedDiff: string
}): string {
  const context = truncateCommitMessageDraftContext([
    'Git status:',
    options.statusSummary.trim() || '(no status output)',
    '',
    'Staged diff:',
    options.stagedDiff.trim() || '(empty)',
    '',
    'Working tree diff:',
    options.unstagedDiff.trim() || '(empty)',
  ].join('\n'))

  return [
    'Draft a concise conventional commit message for these repository changes.',
    'Return only JSON with exactly these string fields: "title" and "summary".',
    'The title must be one line, imperative, and at most 72 characters.',
    'The summary should be one short paragraph or an empty string when the title is enough.',
    '',
    context,
  ].join('\n')
}

export function parseGeneratedCommitMessage(output: string): GitCommitMessageDraft {
  const trimmed = output.trim()
  if (!trimmed) throw new Error('Codex did not return a commit message draft')

  const jsonCandidate = extractJsonObject(trimmed)
  if (jsonCandidate) {
    try {
      const parsed = JSON.parse(jsonCandidate) as Partial<GitCommitMessageDraft>
      return normalizeManualCommitMessage(String(parsed.title ?? ''), String(parsed.summary ?? ''))
    } catch {
      // Fall through to plain-text parsing; some model outputs include helpful text around malformed JSON.
    }
  }

  const lines = trimmed
    .replace(/^```(?:[a-z]+)?\s*/i, '')
    .replace(/```$/i, '')
    .split('\n')
    .map((line) => line.trim())
  const title = lines.find(Boolean) ?? ''
  const summary = lines.slice(lines.findIndex((line) => line === title) + 1).join('\n').trim()
  return normalizeManualCommitMessage(title, summary)
}

function extractJsonObject(output: string): string | null {
  const fenced = output.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim()
  if (fenced?.startsWith('{')) return fenced
  const start = output.indexOf('{')
  const end = output.lastIndexOf('}')
  if (start >= 0 && end > start) return output.slice(start, end + 1)
  return null
}
