import type { CranberriAppState, PinnedCodexSessionRecord } from '@/shared/appState'
import type { CodexSessionSummary } from '@/shared/codex'

export function pinnedSessionRecords(state: CranberriAppState, repoPath: string): PinnedCodexSessionRecord[] {
  const records = state.pinnedCodexSessionsByRepoPath[repoPath] ?? []
  const recordIds = new Set(records.map((record) => record.id))
  const legacyRecords = (state.pinnedCodexSessionIdsByRepoPath[repoPath] ?? [])
    .filter((id) => !recordIds.has(id))
    .map((id) => ({ id }))
  return [...records, ...legacyRecords]
}

export function pinnedSessionIds(state: CranberriAppState, repoPath: string): string[] {
  return pinnedSessionRecords(state, repoPath).map((record) => record.id)
}

export function togglePinnedSession(state: CranberriAppState, repoPath: string, session: CodexSessionSummary): CranberriAppState {
  const records = pinnedSessionRecords(state, repoPath)
  const nextRecords = records.some((record) => record.id === session.id)
    ? records.filter((record) => record.id !== session.id)
    : [pinnedRecordFromSession(session), ...records]
  return writePinnedSessionRecords(state, repoPath, nextRecords)
}

export function removePinnedSessions(state: CranberriAppState, repoPath: string, ids: string[]): CranberriAppState {
  if (ids.length === 0) return state
  const idSet = new Set(ids)
  const nextRecords = pinnedSessionRecords(state, repoPath).filter((record) => !idSet.has(record.id))
  return writePinnedSessionRecords(state, repoPath, nextRecords)
}

function pinnedRecordFromSession(session: CodexSessionSummary): PinnedCodexSessionRecord {
  return {
    id: session.id,
    title: session.title || session.preview || undefined,
    archived: session.archived,
    updatedAt: session.updatedAt,
  }
}

function writePinnedSessionRecords(state: CranberriAppState, repoPath: string, records: PinnedCodexSessionRecord[]): CranberriAppState {
  const uniqueRecords = records.filter((record, index) => records.findIndex((item) => item.id === record.id) === index)
  const nextRecordMap = { ...state.pinnedCodexSessionsByRepoPath }
  const nextIdMap = { ...state.pinnedCodexSessionIdsByRepoPath }

  if (uniqueRecords.length) {
    nextRecordMap[repoPath] = uniqueRecords
    nextIdMap[repoPath] = uniqueRecords.map((record) => record.id)
  } else {
    delete nextRecordMap[repoPath]
    delete nextIdMap[repoPath]
  }

  return {
    ...state,
    pinnedCodexSessionsByRepoPath: nextRecordMap,
    pinnedCodexSessionIdsByRepoPath: nextIdMap,
  }
}
