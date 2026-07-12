import type { CranberriAppState, PinnedCodexSessionRecord } from '@/shared/appState'
import type { CodexSessionSummary } from '@/shared/codex'

export function pinnedSessionRecords(state: CranberriAppState, projectId: string): PinnedCodexSessionRecord[] {
  return state.pinnedCodexSessionsByProjectId[projectId] ?? []
}

export function pinnedSessionIds(state: CranberriAppState, projectId: string): string[] {
  return pinnedSessionRecords(state, projectId).map((record) => record.id)
}

export function togglePinnedSession(state: CranberriAppState, projectId: string, session: CodexSessionSummary): CranberriAppState {
  const records = pinnedSessionRecords(state, projectId)
  const nextRecords = records.some((record) => record.id === session.id)
    ? records.filter((record) => record.id !== session.id)
    : [pinnedRecordFromSession(session), ...records]
  return writePinnedSessionRecords(state, projectId, nextRecords)
}

export function removePinnedSessions(state: CranberriAppState, projectId: string, ids: string[]): CranberriAppState {
  if (ids.length === 0) return state
  const idSet = new Set(ids)
  const nextRecords = pinnedSessionRecords(state, projectId).filter((record) => !idSet.has(record.id))
  return writePinnedSessionRecords(state, projectId, nextRecords)
}

function pinnedRecordFromSession(session: CodexSessionSummary): PinnedCodexSessionRecord {
  return {
    id: session.id,
    title: session.title || session.preview || undefined,
    archived: session.archived,
    updatedAt: session.updatedAt,
  }
}

function writePinnedSessionRecords(state: CranberriAppState, projectId: string, records: PinnedCodexSessionRecord[]): CranberriAppState {
  const uniqueRecords = records.filter((record, index) => records.findIndex((item) => item.id === record.id) === index)
  const nextRecordMap = { ...state.pinnedCodexSessionsByProjectId }

  if (uniqueRecords.length) {
    nextRecordMap[projectId] = uniqueRecords
  } else {
    delete nextRecordMap[projectId]
  }

  return {
    ...state,
    pinnedCodexSessionsByProjectId: nextRecordMap,
  }
}
