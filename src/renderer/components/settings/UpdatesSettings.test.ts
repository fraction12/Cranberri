import { describe, expect, it } from 'vitest'
import type { UpdateInfo } from '@/shared/update'
import { updateStatusCopy } from './UpdatesSettings'

function status(overrides: Partial<UpdateInfo>): UpdateInfo {
  return {
    status: 'unknown',
    currentCommit: '1234567890',
    latestCommit: 'abcdef0123',
    commitsBehind: null,
    sourceRepoPath: null,
    sourceRepoDirty: null,
    blockedReason: null,
    blockedMessage: null,
    phase: null,
    phaseMessage: null,
    failedPhase: null,
    failureMessage: null,
    logPath: null,
    ...overrides,
  }
}

describe('updateStatusCopy', () => {
  it('summarizes an up-to-date beta build without redundant rows', () => {
    expect(updateStatusCopy(status({ status: 'upToDate' }), 'beta')).toEqual({
      title: 'Cranberri is up to date',
      description: 'Running 1234567 · origin/main abcdef0',
      tone: 'success',
    })
  })

  it('uses a concise available-update count', () => {
    expect(updateStatusCopy(status({ status: 'updateAvailable', commitsBehind: 3 }), 'stable')).toMatchObject({
      title: '3 commits available',
      tone: 'warning',
    })
  })

  it('keeps actionable failures in the status summary', () => {
    expect(updateStatusCopy(status({ status: 'failed', failureMessage: 'Could not fetch the release.' }), 'stable')).toEqual({
      title: 'Update check failed',
      description: 'Could not fetch the release.',
      tone: 'danger',
    })
  })
})
