import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import type { RecoveryReason, StartupRecoveryReport, WindowRecoveryOutcome } from '@/shared/recovery'

export interface WindowRecoveryNotice {
  outcome: WindowRecoveryOutcome | null
  status: WindowRecoveryOutcome['status']
  title: string
  description: string
  blocksMutations: boolean
}

interface RecoveryApi {
  report: StartupRecoveryReport | null
  loaded: boolean
  noticeForWindow: (workspaceProjectId: string | undefined, windowId: string) => WindowRecoveryNotice | null
  retry: () => Promise<void>
}

export interface StartupRecoverySummary {
  tone: 'success' | 'warning'
  title: string
  description: string
}

const COPY_BY_REASON: Record<RecoveryReason, { title: string; description: string }> = {
  none: { title: 'Workspace recovered', description: 'This workspace is ready to use.' },
  localControlDeleted: { title: 'Workspace recovered', description: 'Cranberri restored this local workspace after startup.' },
  sessionTargetRestored: { title: 'Workspace recovered', description: 'Cranberri restored this session binding after startup.' },
  projectMissing: { title: 'Project unavailable', description: 'Re-add this project before continuing this session.' },
  projectMismatch: { title: 'Project changed', description: 'Open this session from its original project before continuing.' },
  checkoutMissing: { title: 'Checkout unavailable', description: 'Restore the checkout for this session before continuing.' },
  checkoutUnavailable: { title: 'Checkout unavailable', description: 'Cranberri could not open this session checkout. Check the folder and try again.' },
  checkoutMismatch: { title: 'Checkout changed', description: 'Open this session from its original checkout before continuing.' },
  taskMissing: { title: 'Session task unavailable', description: 'Restore the original task or start a new session before continuing.' },
  taskMismatch: { title: 'Session task changed', description: 'Open the task from its original workspace before continuing.' },
  worktreeMissing: { title: 'Worktree unavailable', description: 'Restore this worktree before continuing the session.' },
  worktreeUnavailable: { title: 'Worktree unavailable', description: 'Cranberri could not open this worktree. Check the folder and try again.' },
  interruptedOperation: { title: 'Setup was interrupted', description: 'Cranberri stopped the unfinished setup. Review this session before continuing.' },
  threadUnchecked: { title: 'Checking session', description: 'Cranberri is verifying this session in the background.' },
  threadMissing: { title: 'Session unavailable', description: 'The Codex session could not be found. Start a new session or restore it before continuing.' },
}

function isQuietThreadVerification(outcome: WindowRecoveryOutcome): boolean {
  return outcome.reason === 'threadUnchecked' && outcome.threadStatus === 'unchecked'
}

export function visibleWindowRecoveryOutcome(
  report: StartupRecoveryReport | null,
  workspaceProjectId: string | undefined,
  windowId: string,
): WindowRecoveryOutcome | null {
  if (!report || !workspaceProjectId) return null
  const outcome = report.windows.find((candidate) => (
    candidate.workspaceProjectId === workspaceProjectId && candidate.windowId === windowId
  ))
  if (!outcome || outcome.status === 'ready' || outcome.status === 'repaired') return null
  if (isQuietThreadVerification(outcome)) return null
  return outcome
}

export function windowRecoveryNotice(
  report: StartupRecoveryReport | null,
  workspaceProjectId: string | undefined,
  windowId: string,
): WindowRecoveryNotice | null {
  if (report?.appState.status === 'needsAttention') {
    return {
      outcome: null,
      status: 'needsAttention',
      title: 'Workspace state unavailable',
      description: 'Cranberri could not safely restore workspace state. Restart after reviewing Diagnostics.',
      blocksMutations: true,
    }
  }
  if (report?.taskStore.status === 'needsAttention') {
    return {
      outcome: null,
      status: 'needsAttention',
      title: 'Session state unavailable',
      description: 'Cranberri could not safely restore session state. Restart after reviewing Diagnostics.',
      blocksMutations: true,
    }
  }
  const outcome = visibleWindowRecoveryOutcome(report, workspaceProjectId, windowId)
  if (!outcome) return null
  return {
    outcome,
    status: outcome.status,
    ...COPY_BY_REASON[outcome.reason],
    blocksMutations: outcome.status === 'needsAttention',
  }
}

export function startupRecoverySummary(report: StartupRecoveryReport | null): StartupRecoverySummary | null {
  if (!report) return null
  const affectedWindowCount = report.windows.filter((outcome) => (
    outcome.status === 'needsAttention' && !isQuietThreadVerification(outcome)
  )).length
  const attentionCount = affectedWindowCount
    + (report.appState.status === 'needsAttention' ? 1 : 0)
    + (report.taskStore.status === 'needsAttention' ? 1 : 0)
  if (attentionCount > 0) {
    const globalAttention = report.appState.status === 'needsAttention' || report.taskStore.status === 'needsAttention'
    return {
      tone: 'warning',
      title: globalAttention ? 'Cranberri needs attention' : 'Startup recovery needs attention',
      description: globalAttention
        ? 'Review the recovery message before continuing.'
        : affectedWindowCount > 0
        ? 'Open the affected chat to review the recovery details.'
        : 'Cranberri could not safely restore all startup state.',
    }
  }

  const repairedCount = report.windows.filter((outcome) => outcome.status === 'repaired').length
    + (report.appState.status === 'repaired' ? 1 : 0)
    + (report.taskStore.status === 'repaired' ? 1 : 0)
  if (repairedCount === 0) return null
  return {
    tone: 'success',
    title: repairedCount === 1 ? 'Workspace restored' : 'Workspaces restored',
    description: 'Cranberri repaired interrupted startup state.',
  }
}

export function recoveryAllowsUpdateHealth(report: StartupRecoveryReport | null): boolean {
  if (!report) return false
  const settled = (status: WindowRecoveryOutcome['status']) => status === 'ready' || status === 'repaired'
  if (!settled(report.appState.status) || !settled(report.taskStore.status)) return false
  return report.windows.every((outcome) => (
    settled(outcome.status)
    || (outcome.status === 'retryable' && isQuietThreadVerification(outcome))
  ))
}

const RecoveryContext = createContext<RecoveryApi | null>(null)

export function RecoveryProvider({ children }: { children: React.ReactNode }) {
  const [report, setReport] = useState<StartupRecoveryReport | null>(null)
  const [loaded, setLoaded] = useState(false)

  const retry = useCallback(async () => {
    const next = await window.cranberri.recovery.retry()
    setReport(next)
    const summary = startupRecoverySummary(next)
    if (summary?.tone === 'warning') toast.warning(summary.title, { description: summary.description })
    else toast.success('Recovery check complete')
  }, [])

  useEffect(() => {
    let cancelled = false
    window.cranberri.recovery.read()
      .then((next) => {
        if (cancelled) return
        setReport(next)
        const summary = startupRecoverySummary(next)
        if (!summary) return
        const notify = summary.tone === 'warning' ? toast.warning : toast.success
        notify(summary.title, {
          id: 'startup-recovery-summary',
          description: summary.description,
        })
      })
      .catch((error) => console.error('Failed to read startup recovery report:', error))
      .finally(() => {
        if (!cancelled) setLoaded(true)
      })
    return () => { cancelled = true }
  }, [])

  const value = useMemo<RecoveryApi>(() => ({
    report,
    loaded,
    noticeForWindow: (workspaceProjectId, windowId) => windowRecoveryNotice(report, workspaceProjectId, windowId),
    retry,
  }), [loaded, report, retry])

  return <RecoveryContext.Provider value={value}>{children}</RecoveryContext.Provider>
}

export function useRecovery(): RecoveryApi {
  const context = useContext(RecoveryContext)
  if (!context) throw new Error('useRecovery must be used inside RecoveryProvider')
  return context
}
