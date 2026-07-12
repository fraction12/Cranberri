import { describe, expect, it } from 'vitest'
import type { Task } from '@/shared/tasks'
import {
  releaseProvenanceError,
  signatureStatusFromCodesign,
  supportsMinimumSystemVersion,
  taskUpdateBlockers,
} from './updater-preflight-model'

function task(patch: Partial<Task> = {}): Task {
  return {
    id: 'task', projectId: 'project', threadId: 'thread', checkoutId: 'checkout', worktreeId: null,
    role: 'root', location: 'local', state: 'local', baseRef: 'main', baseSha: null,
    environmentId: null, environmentRevision: null, pendingFirstTurn: null,
    createdAt: 1, updatedAt: 1, archivedAt: null, ...patch,
  }
}

describe('updater quiescence', () => {
  it('allows a settled task catalog', () => {
    expect(taskUpdateBlockers([task()], () => false, [])).toEqual([])
  })

  it('reports Codex, environment, handoff, and worktree transition blockers', () => {
    const handingOff = task({
      state: 'handingOff',
      handoff: { direction: 'toLocal', phase: 'preflight', branch: 'feature', bundlePath: null, startedAt: 1, error: null },
      worktreeTransition: {
        phase: 'provisioning', previousCheckoutId: 'local', previousBaseRef: 'main', previousBaseSha: null,
        previousEnvironmentId: null, previousEnvironmentRevision: null, startedAt: 1, error: null,
      },
    })
    expect(taskUpdateBlockers([handingOff], () => true, ['Codex is running'])).toEqual([
      'Codex is running',
      'Task task is handing off between checkouts',
      'Task task is changing worktree state',
      'Environment setup is running for task task',
    ])
  })
})

describe('updater system compatibility', () => {
  it('accepts equal, older, and unspecified minimum versions', () => {
    expect(supportsMinimumSystemVersion('15.5.0', null)).toBe(true)
    expect(supportsMinimumSystemVersion('15.5.0', '15.5')).toBe(true)
    expect(supportsMinimumSystemVersion('15.5.0', '14.6')).toBe(true)
  })

  it('rejects a candidate requiring a newer macOS version', () => {
    expect(supportsMinimumSystemVersion('15.5.0', '15.6')).toBe(false)
    expect(supportsMinimumSystemVersion('15.5.0', '16.0')).toBe(false)
  })
})

describe('updater release provenance', () => {
  const valid = {
    releaseTag: 'v1.2.3', releaseCommit: 'abc', manifestTag: 'v1.2.3',
    manifestCommit: 'abc', manifestChannel: 'stable' as const,
  }

  it('accepts an exact stable release manifest', () => {
    expect(releaseProvenanceError(valid)).toBeNull()
  })

  it('rejects channel, tag, and commit drift', () => {
    expect(releaseProvenanceError({ ...valid, manifestChannel: 'beta' })).toMatch(/stable-channel/)
    expect(releaseProvenanceError({ ...valid, manifestTag: 'v1.2.4' })).toMatch(/tag/)
    expect(releaseProvenanceError({ ...valid, manifestCommit: 'def' })).toMatch(/commit/)
  })

  it('classifies packaged signature policy', () => {
    expect(signatureStatusFromCodesign(null)).toBe('unsigned')
    expect(signatureStatusFromCodesign('code object is not signed at all')).toBe('unsigned')
    expect(signatureStatusFromCodesign('Signature=adhoc')).toBe('adHoc')
    expect(signatureStatusFromCodesign('Authority=Developer ID Application: Example')).toBe('developerId')
    expect(signatureStatusFromCodesign('Authority=Apple Development: Example')).toBe('other')
  })
})
