import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { StartupRecoveryReport, WindowRecoveryOutcome } from '@/shared/recovery'
import { StartupRecoveryNotice } from '../components/chat/StartupRecoveryNotice'
import {
  recoveryAllowsUpdateHealth,
  startupRecoverySummary,
  visibleWindowRecoveryOutcome,
  windowRecoveryNotice,
} from './recovery'

const BASE_WINDOW: WindowRecoveryOutcome = {
  windowId: 'chat-1',
  workspaceProjectId: 'project-1',
  status: 'needsAttention',
  reason: 'worktreeMissing',
  message: 'internal recovery detail',
  bindingRevision: 2,
  threadStatus: 'available',
}

function reportWith(outcome: WindowRecoveryOutcome): StartupRecoveryReport {
  return {
    appState: { status: 'ready', source: 'primary', message: 'ready' },
    taskStore: { status: 'ready', revision: 3, repairedTaskIds: [] },
    windows: [outcome],
  }
}

describe('startup recovery window mapping', () => {
  it('matches a recovery outcome by project and window identity', () => {
    const report = reportWith(BASE_WINDOW)

    expect(visibleWindowRecoveryOutcome(report, 'project-1', 'chat-1')).toEqual(BASE_WINDOW)
    expect(visibleWindowRecoveryOutcome(report, 'project-2', 'chat-1')).toBeNull()
    expect(visibleWindowRecoveryOutcome(report, 'project-1', 'chat-2')).toBeNull()
  })

  it('keeps ready, repaired, and unchecked-thread outcomes quiet', () => {
    expect(visibleWindowRecoveryOutcome(reportWith({ ...BASE_WINDOW, status: 'ready', reason: 'none' }), 'project-1', 'chat-1')).toBeNull()
    expect(visibleWindowRecoveryOutcome(reportWith({ ...BASE_WINDOW, status: 'repaired', reason: 'localControlDeleted' }), 'project-1', 'chat-1')).toBeNull()
    expect(visibleWindowRecoveryOutcome(
      reportWith({ ...BASE_WINDOW, status: 'retryable', reason: 'threadUnchecked', threadStatus: 'unchecked' }),
      'project-1',
      'chat-1',
    )).toBeNull()
  })

  it('blocks mutations only for unresolved attention states', () => {
    expect(windowRecoveryNotice(reportWith(BASE_WINDOW), 'project-1', 'chat-1')?.blocksMutations).toBe(true)
    expect(windowRecoveryNotice(
      reportWith({ ...BASE_WINDOW, status: 'retryable', reason: 'interruptedOperation' }),
      'project-1',
      'chat-1',
    )?.blocksMutations).toBe(false)
  })

  it('fails closed when persisted app or session state is globally unavailable', () => {
    const appStateReport: StartupRecoveryReport = {
      ...reportWith(BASE_WINDOW),
      appState: { status: 'needsAttention', source: 'unavailable', message: 'corrupt primary and backup' },
      windows: [],
    }
    const taskStoreReport: StartupRecoveryReport = {
      ...reportWith(BASE_WINDOW),
      taskStore: { status: 'needsAttention', revision: 0, repairedTaskIds: [] },
      windows: [],
    }

    expect(windowRecoveryNotice(appStateReport, 'project-1', 'chat-1')).toMatchObject({
      title: 'Workspace state unavailable',
      blocksMutations: true,
    })
    expect(windowRecoveryNotice(taskStoreReport, 'project-1', 'chat-1')).toMatchObject({
      title: 'Session state unavailable',
      blocksMutations: true,
    })
    expect(startupRecoverySummary(appStateReport)).toMatchObject({
      title: 'Cranberri needs attention',
      description: 'Review the recovery message before continuing.',
    })
  })

  it('renders product copy without exposing internal recovery details', () => {
    const notice = windowRecoveryNotice(reportWith(BASE_WINDOW), 'project-1', 'chat-1')
    expect(notice).not.toBeNull()
    const html = renderToStaticMarkup(<StartupRecoveryNotice notice={notice!} onRetry={() => undefined} onClose={() => undefined} />)

    expect(html).toContain('Worktree unavailable')
    expect(html).toContain('Restore this worktree before continuing the session.')
    expect(html).toContain('role="alert"')
    expect(html).not.toContain('internal recovery detail')
    expect(html).toContain('Retry')
    expect(html).toContain('Close tab')
  })

  it('summarizes repairs and attention without counting quiet verification', () => {
    expect(startupRecoverySummary(reportWith(BASE_WINDOW))).toEqual({
      tone: 'warning',
      title: 'Startup recovery needs attention',
      description: 'Open the affected chat to review the recovery details.',
    })
    expect(startupRecoverySummary(reportWith({
      ...BASE_WINDOW,
      status: 'repaired',
      reason: 'localControlDeleted',
    }))).toEqual({
      tone: 'success',
      title: 'Workspace restored',
      description: 'Cranberri repaired interrupted startup state.',
    })
    expect(startupRecoverySummary(reportWith({
      ...BASE_WINDOW,
      status: 'retryable',
      reason: 'threadUnchecked',
      threadStatus: 'unchecked',
    }))).toBeNull()
  })

  it('allows updater health once authoritative stores load, even when a window needs recovery', () => {
    expect(recoveryAllowsUpdateHealth(null)).toBe(false)
    expect(recoveryAllowsUpdateHealth(reportWith({ ...BASE_WINDOW, status: 'ready', reason: 'none' }))).toBe(true)
    expect(recoveryAllowsUpdateHealth(reportWith({
      ...BASE_WINDOW,
      status: 'retryable',
      reason: 'threadUnchecked',
      threadStatus: 'unchecked',
    }))).toBe(true)
    expect(recoveryAllowsUpdateHealth(reportWith({
      ...BASE_WINDOW,
      status: 'retryable',
      reason: 'interruptedOperation',
    }))).toBe(true)
    expect(recoveryAllowsUpdateHealth(reportWith(BASE_WINDOW))).toBe(true)
    expect(recoveryAllowsUpdateHealth({
      ...reportWith(BASE_WINDOW),
      appState: { status: 'needsAttention', source: 'unavailable', message: 'corrupt primary and backup' },
    })).toBe(false)
    expect(recoveryAllowsUpdateHealth({
      ...reportWith(BASE_WINDOW),
      taskStore: { status: 'needsAttention', revision: 0, repairedTaskIds: [] },
    })).toBe(false)
  })
})
