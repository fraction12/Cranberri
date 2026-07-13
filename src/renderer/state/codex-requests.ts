import type { CodexThread } from '@/shared/codex'
import type {
  CodexHumanServerRequestResponse,
  CodexPendingHumanServerRequest,
  CodexRequestId,
  CodexRequestOutcomeEntry,
} from '@/shared/codex-requests'

export function codexRequestKey(id: CodexRequestId): string {
  return `${typeof id}:${String(id)}`
}

export function upsertPendingHumanRequest(
  requests: readonly CodexPendingHumanServerRequest[] | undefined,
  pending: CodexPendingHumanServerRequest,
): CodexPendingHumanServerRequest[] {
  const current = requests ?? []
  const key = codexRequestKey(pending.request.id)
  const existingIndex = current.findIndex((candidate) => codexRequestKey(candidate.request.id) === key)
  if (existingIndex === -1) return [...current, pending]
  if (current[existingIndex] === pending) return [...current]
  const next = [...current]
  next[existingIndex] = pending
  return next
}

export function removePendingHumanRequest(
  requests: readonly CodexPendingHumanServerRequest[] | undefined,
  requestId: CodexRequestId,
): CodexPendingHumanServerRequest[] {
  const key = codexRequestKey(requestId)
  return (requests ?? []).filter((candidate) => codexRequestKey(candidate.request.id) !== key)
}

export function attachPendingHumanRequests(
  thread: CodexThread,
  requests: readonly CodexPendingHumanServerRequest[] | undefined,
): CodexThread {
  if (!requests?.length) return thread
  return requests.reduce((current, pending) => ({
    ...current,
    pendingHumanRequests: upsertPendingHumanRequest(current.pendingHumanRequests, pending),
  }), thread)
}

export function codexRequestOutcomeKey(outcome: CodexRequestOutcomeEntry): string {
  return [
    outcome.method,
    typeof outcome.requestId,
    String(outcome.requestId),
    outcome.threadId,
    outcome.turnId ?? '',
    outcome.itemId ?? '',
  ].join(':')
}

export function upsertHumanRequestOutcome(
  outcomes: readonly CodexRequestOutcomeEntry[] | undefined,
  outcome: CodexRequestOutcomeEntry,
): CodexRequestOutcomeEntry[] {
  const key = codexRequestOutcomeKey(outcome)
  return [...(outcomes ?? []).filter((candidate) => codexRequestOutcomeKey(candidate) !== key), outcome]
    .sort((left, right) => left.completedAt - right.completedAt)
}

export function attachHumanRequestOutcomes(
  thread: CodexThread,
  outcomes: readonly CodexRequestOutcomeEntry[] | undefined,
): CodexThread {
  if (!outcomes?.length) return thread
  return outcomes.reduce((current, outcome) => ({
    ...current,
    humanRequestOutcomes: upsertHumanRequestOutcome(current.humanRequestOutcomes, outcome),
  }), thread)
}

export function pendingHumanRequestMatchesResponse(
  pending: CodexPendingHumanServerRequest,
  response: CodexHumanServerRequestResponse,
): boolean {
  return codexRequestKey(pending.request.id) === codexRequestKey(response.id)
    && pending.request.method === response.method
}

export function findPendingHumanRequest(
  thread: CodexThread | undefined,
  response: CodexHumanServerRequestResponse,
): CodexPendingHumanServerRequest | undefined {
  return thread?.pendingHumanRequests?.find((pending) => pendingHumanRequestMatchesResponse(pending, response))
}
