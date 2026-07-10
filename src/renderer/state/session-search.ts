import type { CodexSdkThreadItem, CodexSessionSummary, CodexSessionThread } from '@/shared/codex'
import { codexWorkerControlDisplayText } from '@/shared/codex-worker-control'

export interface SessionSearchResult {
  session: CodexSessionSummary
  repoPath: string
  archived?: boolean
  thread?: CodexSessionThread
  transcriptMatches?: TranscriptSearchMatch[]
}

export interface LatestSessionContext {
  result: SessionSearchResult
  thread: CodexSessionThread
}

export interface TranscriptSearchMatch {
  turnId: string
  itemId?: string
  role: string
  text: string
  preview: string
}

interface TranscriptItem {
  turnId: string
  itemId?: string
  role: string
  text: string
}

const MAX_SESSION_CONTEXT_CHARS = 14_000
const MAX_MATCH_PREVIEW_CHARS = 220
const MAX_TRANSCRIPT_ITEM_CHARS = 1_600
const MAX_SESSION_SUMMARY_PREVIEW_CHARS = 240

export function searchSessionTranscript(thread: CodexSessionThread, query: string, maxMatches = 5): TranscriptSearchMatch[] {
  const terms = normalizeTerms(query)
  if (terms.length === 0) return []

  return transcriptItems(thread)
    .filter((item) => {
      const haystack = normalizeSearchText(item.text)
      return terms.every((term) => haystack.includes(term))
    })
    .slice(0, maxMatches)
    .map((item) => ({
      turnId: item.turnId,
      itemId: item.itemId,
      role: item.role,
      text: item.text,
      preview: truncateMiddle(oneLine(item.text), MAX_MATCH_PREVIEW_CHARS),
    }))
}

export function sessionThreadMatchesSummary(session: CodexSessionSummary, query: string): boolean {
  const terms = normalizeTerms(query)
  if (terms.length === 0) return true
  const workerKeywords = (session.workers ?? []).flatMap((worker) => [
    worker.threadId,
    worker.nickname,
    worker.role,
    worker.title,
    worker.prompt,
    worker.lastInstruction,
  ])
  const haystack = normalizeSearchText([
    session.title,
    session.preview,
    session.id,
    session.cwd,
    session.path,
    session.parentThreadId,
    session.agentNickname,
    session.agentRole,
    ...workerKeywords,
  ].filter(Boolean).join(' '))
  return terms.every((term) => haystack.includes(term))
}

export function codexThreadSummary(thread: CodexSessionThread): CodexSessionSummary {
  const { turns, ...summary } = thread
  void turns
  return compactSessionSummary(summary)
}

export function compactSessionSummary(session: CodexSessionSummary): CodexSessionSummary {
  if (!session.preview) return session
  const preview = sessionSummaryPreview(session.preview)
  return preview === session.preview ? session : { ...session, preview }
}

export function sessionSummaryPreview(preview: string): string {
  return truncateMiddle(oneLine(preview), MAX_SESSION_SUMMARY_PREVIEW_CHARS)
}

export function sessionChatContext(thread: CodexSessionThread, matches: TranscriptSearchMatch[] = []): string {
  const header = [
    'Codex session context:',
    `Title: ${thread.title || 'Untitled session'}`,
    `Thread: ${thread.id}`,
    thread.sessionId ? `Session: ${thread.sessionId}` : null,
    thread.parentThreadId ? `Parent thread: ${thread.parentThreadId}` : null,
    thread.agentNickname ? `Worker: ${thread.agentNickname}` : null,
    thread.agentRole ? `Worker role: ${thread.agentRole}` : null,
    thread.cwd ? `Repo: ${thread.cwd}` : null,
    thread.archived ? 'Archived: yes' : 'Archived: no',
    `Turns: ${thread.turnCount}`,
    thread.updatedAt ? `Updated: ${new Date(thread.updatedAt).toISOString()}` : null,
    thread.preview ? `Preview: ${oneLine(thread.preview)}` : null,
  ].filter(Boolean).join('\n')

  const matchBlock = matches.length
    ? [
        'Transcript matches:',
        ...matches.map((match) => `- ${match.role} in ${match.turnId}: ${match.preview}`),
      ].join('\n')
    : ''

  const transcript = transcriptItems(thread)
    .slice(-24)
    .map((item) => {
      const text = truncateTail(item.text.trim(), MAX_TRANSCRIPT_ITEM_CHARS)
      return `[${item.turnId}] ${item.role}:\n${text}`
    })
    .join('\n\n')

  return truncateHead([header, matchBlock, transcript ? `Recent transcript:\n${transcript}` : 'Recent transcript: none']
    .filter(Boolean)
    .join('\n\n'), MAX_SESSION_CONTEXT_CHARS, 'Session context')
}

function transcriptItems(thread: CodexSessionThread): TranscriptItem[] {
  return thread.turns.flatMap((turn) => (turn.items ?? [])
    .map((item) => itemToTranscriptItem(turn.id, item))
    .filter((item): item is TranscriptItem => Boolean(item?.text.trim())))
}

function itemToTranscriptItem(turnId: string, item: CodexSdkThreadItem): TranscriptItem | null {
  if (item.type === 'userMessage') {
    return { turnId, itemId: item.id, role: 'user', text: codexWorkerControlDisplayText(contentText(item)) }
  }
  if (item.type === 'agentMessage') {
    return { turnId, itemId: item.id, role: item.phase === 'commentary' || item.phase === 'reasoning' ? 'assistant reasoning' : 'assistant', text: item.text ?? contentText(item) }
  }
  if (item.type === 'reasoning') {
    return { turnId, itemId: item.id, role: 'reasoning', text: [...(item.summary ?? []), contentText(item)].filter(Boolean).join('\n') }
  }
  if (item.type === 'contextCompaction' || item.type === 'compaction') {
    return { turnId, itemId: item.id, role: 'compact', text: 'Context compacted' }
  }
  return null
}

function contentText(item: CodexSdkThreadItem): string {
  return item.content?.map((part) => part.text).filter(Boolean).join('\n') ?? ''
}

function normalizeTerms(query: string): string[] {
  return normalizeSearchText(query).split(' ').filter(Boolean)
}

function normalizeSearchText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function oneLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function truncateMiddle(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value
  const head = Math.floor((maxChars - 5) * 0.6)
  const tail = maxChars - 5 - head
  return `${value.slice(0, head)} ... ${value.slice(-tail)}`
}

function truncateTail(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value
  return `${value.slice(0, maxChars).trimEnd()}\n[Transcript item truncated: ${value.length - maxChars} chars omitted]`
}

function truncateHead(value: string, maxChars: number, label: string): string {
  if (value.length <= maxChars) return value
  return `${value.slice(-maxChars).trimStart()}\n\n[${label} truncated: ${value.length - maxChars} chars omitted from the beginning]`
}
