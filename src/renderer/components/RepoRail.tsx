import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Activity, Archive, ChevronRight, FolderGit2, Gauge, Laptop, Loader2, MoreHorizontal, Pencil, Pin, PinOff, Plus, RotateCcw, Stethoscope, Trash2, TreePine, Wrench } from 'lucide-react'
import { toast } from 'sonner'
import { useRepos } from '../state/repos'
import { useCodexActions, useCodexWindows } from '../state/codex'
import { useAppState } from '../state/appState'
import { useOptionalTasks } from '../state/tasks'
import { useWorkspace } from '../state/workspace'
import { localProjectExecutionContext } from '../state/workspace-model'
import { pinnedSessionRecords, removePinnedSessions, togglePinnedSession } from '../state/pinned-sessions'
import { codexThreadSummary } from '../state/session-search'
import { invalidateSessions, sessionInvalidationMatches, subscribeSessionInvalidation } from '../state/session-invalidation'
import { UsageMeter } from './UsageMeter'
import { ConfirmDialog } from './ConfirmDialog'
import { mergeHydratedPinnedSessions, shouldAutoLoadRepoSessions } from './repo-sessions-state'
import { buttonStyle, cn, dialogSurface, fieldStyle, menuSurface } from '../lib/ui'
import { typeStyle } from '../lib/typography'
import { NewSessionMenu } from './chat/NewSessionMenu'
import { RepoPinnedBranchMenu } from './RepoPinnedBranchMenu'
import type { CodexSessionSummary } from '@/shared/codex'
import type { CranberriHealthReport } from '@/shared/health'
import { IconButton } from './ui/IconButton'

function relativeTime(value: number): string {
  const ms = value > 10_000_000_000 ? value : value * 1000
  const seconds = Math.max(1, Math.round((Date.now() - ms) / 1000))
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

function sessionTitle(session: CodexSessionSummary): string {
  return session.title || session.preview || 'Untitled session'
}

function openSession(session: CodexSessionSummary, repoPath: string, archived = false) {
  window.dispatchEvent(new CustomEvent('cranberri:open-codex-session', { detail: { session, repoPath, archived } }))
}

const RAIL_MENU_ITEM = cn(
  'flex min-h-8 select-none items-center gap-2 rounded-md px-2 outline-none data-[highlighted]:bg-app-surface-2',
  typeStyle({ role: 'control', tone: 'primary' }),
)

function afterMenuCloses(action: () => void): void {
  requestAnimationFrame(action)
}

function SessionRow({
  session,
  archived,
  onArchive,
  onUnarchive,
  onDelete,
  onRename,
  onOptionsTrigger,
  onTogglePinned,
  active,
  pinned,
  location,
  repoPath,
}: {
  session: CodexSessionSummary
  archived?: boolean
  active?: boolean
  pinned?: boolean
  location?: 'local' | 'worktree'
  repoPath: string
  onArchive: (session: CodexSessionSummary) => void
  onUnarchive: (session: CodexSessionSummary) => void
  onDelete: (session: CodexSessionSummary) => void
  onRename: (session: CodexSessionSummary) => void
  onOptionsTrigger: (trigger: HTMLButtonElement) => void
  onTogglePinned: (session: CodexSessionSummary) => void
}) {
  return (
    <div
      data-session-id={session.id}
      data-session-location={location}
      className={cn('group/session flex w-full items-center rounded-md', active ? 'bg-app-surface-2' : 'hover:bg-app-surface-2/60')}
    >
      <button
        type="button"
        onClick={() => openSession(session, repoPath, archived)}
        className="min-w-0 flex-1 rounded-md px-2 py-1.5 text-left"
        title={sessionTitle(session)}
        aria-label={`${sessionTitle(session)}, ${location ?? 'Local'} session`}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="flex min-w-0 items-center gap-1.5">
            {location === 'local' ? <span title="Local session"><Laptop className="h-3 w-3 shrink-0 text-app-text-muted" /><span className="sr-only">Local</span></span> : location === 'worktree' ? <span title="Worktree session"><TreePine className="h-3 w-3 shrink-0 text-app-text-muted" /><span className="sr-only">Worktree</span></span> : null}
            {pinned && <Pin className="h-3 w-3 shrink-0 text-app-accent" />}
            <span className={cn('truncate', typeStyle({ role: 'control', tone: active ? 'primary' : 'secondary' }))}>{sessionTitle(session)}</span>
          </span>
          <span className={cn('shrink-0', typeStyle({ role: 'micro', tone: 'secondary' }))}>{relativeTime(session.recencyAt ?? session.updatedAt ?? session.createdAt)}</span>
        </div>
      </button>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <IconButton
            type="button"
            onFocus={(event) => onOptionsTrigger(event.currentTarget)}
            onPointerDown={(event) => onOptionsTrigger(event.currentTarget)}
            className="mr-1 opacity-0 group-hover/session:opacity-100 focus-visible:opacity-100"
            label={`Options for ${sessionTitle(session)}`}
          >
            <MoreHorizontal className="h-3.5 w-3.5" />
          </IconButton>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content align="start" sideOffset={4} collisionPadding={8} className={cn(menuSurface, 'z-[1400] w-44')}>
            <DropdownMenu.Item className={RAIL_MENU_ITEM} onSelect={() => afterMenuCloses(() => onRename(session))}><Pencil className="h-3.5 w-3.5 text-app-text-muted" />Rename</DropdownMenu.Item>
            <DropdownMenu.Item className={RAIL_MENU_ITEM} onSelect={() => onTogglePinned(session)}>
              {pinned ? <PinOff className="h-3.5 w-3.5 text-app-text-muted" /> : <Pin className="h-3.5 w-3.5 text-app-text-muted" />}
              {pinned ? 'Unpin' : 'Pin'}
            </DropdownMenu.Item>
            {archived ? (
              <DropdownMenu.Item className={RAIL_MENU_ITEM} onSelect={() => onUnarchive(session)}><RotateCcw className="h-3.5 w-3.5 text-app-text-muted" />Unarchive</DropdownMenu.Item>
            ) : (
              <DropdownMenu.Item className={RAIL_MENU_ITEM} onSelect={() => onArchive(session)}><Archive className="h-3.5 w-3.5 text-app-text-muted" />Archive</DropdownMenu.Item>
            )}
            {archived && <DropdownMenu.Item className={cn(RAIL_MENU_ITEM, typeStyle({ role: 'control', tone: 'danger' }), 'data-[highlighted]:bg-app-danger/10')} onSelect={() => afterMenuCloses(() => onDelete(session))}><Trash2 className="h-3.5 w-3.5" />Delete archived session</DropdownMenu.Item>}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  )
}

function RepoSessions({ projectId, repoPath, isActiveRepo, closeSessionWindows }: {
  projectId: string
  repoPath: string
  isActiveRepo: boolean
  closeSessionWindows: (projectId: string, identity: { threadId: string; taskId?: string | null }) => void
}) {
  const { openThreadIds } = useCodexWindows()
  const { archiveSession, unarchiveSession, deleteSession, renameSession } = useCodexActions()
  const tasksApi = useOptionalTasks()
  const { state: appState, updateAppState } = useAppState()
  const [recent, setRecent] = useState<CodexSessionSummary[]>([])
  const [archived, setArchived] = useState<CodexSessionSummary[]>([])
  const [showArchived, setShowArchived] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [renameTarget, setRenameTarget] = useState<CodexSessionSummary | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [renaming, setRenaming] = useState(false)
  const [renameError, setRenameError] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<CodexSessionSummary | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const dialogReturnFocusRef = useRef<HTMLButtonElement | null>(null)
  const pinnedRecords = useMemo(() => pinnedSessionRecords(appState, projectId), [appState, projectId])
  const pinnedIds = useMemo(() => pinnedRecords.map((record) => record.id), [pinnedRecords])
  const pinnedIdSet = new Set(pinnedIds)
  const pinnedSessions = pinnedIds
    .map((id) => recent.find((session) => session.id === id) ?? archived.find((session) => session.id === id))
    .filter((session): session is CodexSessionSummary => Boolean(session))
  const recentSessions = recent.filter((session) => !pinnedIdSet.has(session.id))
  const archivedSessions = archived.filter((session) => !pinnedIdSet.has(session.id))
  const locationForSession = (session: CodexSessionSummary): 'local' | 'worktree' => {
    const taskLocation = tasksApi?.tasks.find((task) => task.threadId === session.id)?.location
    if (taskLocation) return taskLocation
    return session.cwd && tasksApi?.managedWorktrees?.some((worktree) => worktree.path === session.cwd)
      ? 'worktree'
      : 'local'
  }

  const rememberSessionOptionsTrigger = useCallback((trigger: HTMLButtonElement) => {
    dialogReturnFocusRef.current = trigger
  }, [])

  const restoreSessionOptionsFocus = useCallback(() => {
    const target = dialogReturnFocusRef.current
    requestAnimationFrame(() => {
      if (target?.isConnected) target.focus()
    })
  }, [])

  const removePinnedIds = useCallback((ids: string[]) => {
    updateAppState((current) => removePinnedSessions(current, projectId, ids))
  }, [projectId, updateAppState])

  const taskForSession = useCallback(async (threadId: string) => {
    const cached = tasksApi?.tasks.find((candidate) => candidate.threadId === threadId)
    if (cached) return cached
    const snapshot = await window.cranberri.tasks.snapshot()
    return snapshot.tasks.find((candidate) => candidate.threadId === threadId) ?? null
  }, [tasksApi])

  const refresh = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const [recentResult, archivedResult] = await Promise.all([
        window.cranberri.tasks.history({ projectId, archived: false, limit: 8 }),
        window.cranberri.tasks.history({ projectId, archived: true, limit: 8 }),
      ])
      const loadedIds = new Set([...recentResult.sessions, ...archivedResult.sessions].map((session) => session.id))
      const hydratedPinnedResults = await Promise.all(pinnedRecords
        .filter((record) => !loadedIds.has(record.id))
        .map(async (record) => {
          const primaryArchived = record.archived ?? false
          const fallbackArchived = !primaryArchived
          try {
            const { thread } = await window.cranberri.codex.readThread(repoPath, record.id, primaryArchived)
            return { id: record.id, session: { ...codexThreadSummary(thread), archived: primaryArchived } }
          } catch {
            try {
              const { thread } = await window.cranberri.codex.readThread(repoPath, record.id, fallbackArchived)
              return { id: record.id, session: { ...codexThreadSummary(thread), archived: fallbackArchived } }
            } catch {
              return { id: record.id, session: null }
            }
          }
        }))
      const missingPinnedIds = hydratedPinnedResults
        .filter((result) => !result.session)
        .map((result) => result.id)
      if (missingPinnedIds.length) removePinnedIds(missingPinnedIds)
      const merged = mergeHydratedPinnedSessions(
        recentResult.sessions,
        archivedResult.sessions,
        hydratedPinnedResults.map((result) => result.session).filter((session): session is CodexSessionSummary => Boolean(session)),
      )
      setRecent(merged.recent)
      setArchived(merged.archived)
      setLoaded(true)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load Codex sessions'
      setLoadError(message)
      throw error
    } finally {
      setLoading(false)
    }
  }, [pinnedRecords, projectId, removePinnedIds, repoPath])

  useEffect(() => {
    if (!shouldAutoLoadRepoSessions({ loaded, loading, loadError })) return
    const timer = window.setTimeout(() => {
      refresh().catch((error) => console.error('Failed to load Codex sessions:', error))
    }, 250)
    return () => window.clearTimeout(timer)
  }, [loaded, loadError, loading, refresh])

  useEffect(() => {
    return subscribeSessionInvalidation((invalidation) => {
      if (!loaded) return
      if (sessionInvalidationMatches(invalidation, projectId, repoPath)) {
        refresh().catch((error) => console.error('Failed to refresh Codex sessions:', error))
      }
    })
  }, [loaded, projectId, refresh, repoPath])

  const archive = async (session: CodexSessionSummary) => {
    try {
      setRecent((prev) => prev.filter((item) => item.id !== session.id))
      setArchived((prev) => [session, ...prev.filter((item) => item.id !== session.id)])
      const task = await taskForSession(session.id)
      const warning = await archiveSession(session.id, repoPath)
      closeSessionWindows(projectId, { threadId: session.id, taskId: task?.id })
      await tasksApi?.refresh()
      if (warning) toast.warning(warning)
      else toast.success('Session archived')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to archive session')
      await refresh().catch(() => undefined)
      return
    }
    await refresh().catch(() => toast.error('Session archived, but the list could not be refreshed'))
  }

  const unarchive = async (session: CodexSessionSummary) => {
    try {
      setArchived((prev) => prev.filter((item) => item.id !== session.id))
      setRecent((prev) => [session, ...prev.filter((item) => item.id !== session.id)])
      const task = await taskForSession(session.id)
      let warning: string | null = null
      if (task) {
        const result = await window.cranberri.tasks.unarchive(task.id)
        await tasksApi?.refresh()
        invalidateSessions({ projectId, repoPath, threadId: session.id })
        warning = result.warning?.message ?? null
      } else {
        warning = await unarchiveSession(session.id, repoPath)
      }
      if (warning) toast.warning(warning)
      else toast.success('Session restored')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to restore session')
      await refresh().catch(() => undefined)
      return
    }
    await refresh().catch(() => toast.error('Session restored, but the list could not be refreshed'))
  }

  const remove = (session: CodexSessionSummary) => {
    setDeleteTarget(session)
    setDeleteError(null)
  }

  const confirmRemove = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    setDeleteError(null)
    const session = deleteTarget
    setRecent((prev) => prev.filter((item) => item.id !== session.id))
    setArchived((prev) => prev.filter((item) => item.id !== session.id))
    try {
      const task = await taskForSession(session.id)
      await deleteSession(session.id, repoPath)
      closeSessionWindows(projectId, { threadId: session.id, taskId: task?.id })
      removePinnedIds([session.id])
      setDeleteTarget(null)
      toast.success('Session deleted')
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : 'Failed to delete session')
      await refresh().catch(() => undefined)
      return
    } finally {
      setDeleting(false)
    }
    await refresh().catch(() => toast.error('Session deleted, but the list could not be refreshed'))
  }

  const rename = (session: CodexSessionSummary) => {
    setRenameTarget(session)
    setRenameValue(sessionTitle(session))
    setRenameError(null)
  }

  const togglePinned = (session: CodexSessionSummary) => {
    updateAppState((current) => togglePinnedSession(current, projectId, session))
  }

  const submitRename = async () => {
    if (!renameTarget) return
    const name = renameValue.trim()
    if (!name || name === sessionTitle(renameTarget)) {
      setRenameTarget(null)
      restoreSessionOptionsFocus()
      return
    }
    setRenaming(true)
    setRenameError(null)
    try {
      await renameSession(renameTarget.id, name, repoPath)
      invalidateSessions({ projectId, repoPath, threadId: renameTarget.id })
      setRecent((prev) => prev.map((item) => item.id === renameTarget.id ? { ...item, title: name } : item))
      setArchived((prev) => prev.map((item) => item.id === renameTarget.id ? { ...item, title: name } : item))
      setRenameTarget(null)
      restoreSessionOptionsFocus()
      toast.success('Session renamed')
    } catch (error) {
      setRenameError(error instanceof Error ? error.message : 'Failed to rename session')
      return
    } finally {
      setRenaming(false)
    }
    await refresh().catch(() => toast.error('Session renamed, but the list could not be refreshed'))
  }

  return (
    <div className="ml-6 mt-1 flex min-h-0 flex-col pl-2">
      <div className="max-h-64 space-y-1 overflow-y-auto pr-1">
        {!loaded && !loading && !loadError && (
          <button
            type="button"
            onClick={() => refresh().catch((error) => console.error('Failed to load Codex sessions:', error))}
            className={cn('w-full rounded px-2 py-1 text-left hover:bg-app-surface-2/50 hover:text-app-text', typeStyle({ role: 'control', tone: 'secondary' }))}
          >
            Load sessions
          </button>
        )}
        {loadError && !loading && (
          <button
            type="button"
            onClick={() => refresh().catch((error) => console.error('Failed to load Codex sessions:', error))}
            className={cn('w-full rounded px-2 py-1 text-left hover:bg-app-danger hover:text-app-on-danger', typeStyle({ role: 'status', tone: 'danger' }))}
            title={loadError}
          >
            Session load failed. Retry
          </button>
        )}
        {loaded && recent.length === 0 && archived.length === 0 && !loading && <div className={cn('px-2 py-1', typeStyle({ role: 'metadata', tone: 'secondary' }))}>No Codex sessions</div>}
        {pinnedSessions.length > 0 && (
          <div className={cn('px-2 pt-1', typeStyle({ role: 'label', tone: 'secondary' }))}>Pinned</div>
        )}
        {pinnedSessions.map((session) => (
          <SessionRow key={`pinned-${session.id}`} session={session} repoPath={repoPath} archived={session.archived} pinned location={locationForSession(session)} active={isActiveRepo && openThreadIds.includes(session.id)} onArchive={archive} onUnarchive={unarchive} onDelete={remove} onRename={rename} onOptionsTrigger={rememberSessionOptionsTrigger} onTogglePinned={togglePinned} />
        ))}
        {pinnedSessions.length > 0 && recentSessions.length > 0 && (
          <div className={cn('px-2 pt-1', typeStyle({ role: 'label', tone: 'secondary' }))}>Recent</div>
        )}
        {recentSessions.map((session) => (
          <SessionRow key={session.id} session={session} repoPath={repoPath} pinned={pinnedIdSet.has(session.id)} location={locationForSession(session)} active={isActiveRepo && openThreadIds.includes(session.id)} onArchive={archive} onUnarchive={unarchive} onDelete={remove} onRename={rename} onOptionsTrigger={rememberSessionOptionsTrigger} onTogglePinned={togglePinned} />
        ))}
        {archivedSessions.length > 0 && (
          <>
            <button
              type="button"
              onClick={() => setShowArchived((value) => !value)}
              className={cn('w-full rounded px-2 py-1 text-left hover:bg-app-surface-2/50', typeStyle({ role: 'control', tone: 'secondary' }))}
            >
              {showArchived ? 'Hide' : 'Show'} archived ({archivedSessions.length})
            </button>
            {showArchived && archivedSessions.map((session) => (
              <SessionRow key={session.id} session={session} repoPath={repoPath} archived pinned={pinnedIdSet.has(session.id)} location={locationForSession(session)} active={isActiveRepo && openThreadIds.includes(session.id)} onArchive={archive} onUnarchive={unarchive} onDelete={remove} onRename={rename} onOptionsTrigger={rememberSessionOptionsTrigger} onTogglePinned={togglePinned} />
            ))}
          </>
        )}
        {loading && <div className={cn('flex items-center gap-2 px-2 py-2', typeStyle({ role: 'status', tone: 'secondary' }))}><Loader2 className="h-3.5 w-3.5 animate-spin" />Loading sessions</div>}
      </div>
      {renameTarget && (
        <Dialog.Root open onOpenChange={(open) => {
          if (open || renaming) return
          setRenameTarget(null)
          setRenameError(null)
          restoreSessionOptionsFocus()
        }}>
          <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 z-[1500] bg-[var(--app-overlay)]" />
            <Dialog.Content asChild>
              <form
                className={cn(dialogSurface, 'fixed left-1/2 top-[28%] z-[1501] w-[min(380px,calc(100vw-32px))] -translate-x-1/2 p-5')}
                onSubmit={(event) => {
                  event.preventDefault()
                  void submitRename()
                }}
              >
                <Dialog.Title className={typeStyle({ role: 'overlayTitle', tone: 'primary' })}>Rename session</Dialog.Title>
                <Dialog.Description className={cn('mt-1', typeStyle({ role: 'body', tone: 'secondary' }))}>Update the Codex task name.</Dialog.Description>
                <input
                  autoFocus
                  aria-label="Session name"
                  value={renameValue}
                  onChange={(event) => { setRenameValue(event.target.value); setRenameError(null) }}
                  className={cn(fieldStyle, 'mt-4 w-full')}
                  placeholder="Session name"
                />
                {renameError && <div className={cn('mt-3 break-words rounded-md bg-app-danger/8 px-3 py-2', typeStyle({ role: 'status', tone: 'danger' }))} role="alert">{renameError}</div>}
                <div className="mt-5 flex justify-end gap-2">
                  <Dialog.Close asChild><button type="button" disabled={renaming} className={buttonStyle({ tone: 'ghost', size: 'small' })}>Cancel</button></Dialog.Close>
                  <button type="submit" disabled={renaming || !renameValue.trim()} className={buttonStyle({ tone: 'primary', size: 'small' })}>
                    {renaming && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    {renaming ? 'Renaming' : 'Rename'}
                  </button>
                </div>
              </form>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      )}
      {deleteTarget && (
        <ConfirmDialog
          title="Delete archived session"
          description={`Permanently delete "${sessionTitle(deleteTarget)}" and its saved work? This cannot be undone.`}
          confirmLabel="Delete permanently"
          busyLabel="Deleting..."
          busy={deleting}
          danger
          error={deleteError}
          onCancel={() => {
            if (deleting) return
            setDeleteTarget(null)
            setDeleteError(null)
            restoreSessionOptionsFocus()
          }}
          onConfirm={() => {
            void confirmRemove()
          }}
        />
      )}
    </div>
  )
}

function healthLevelLabel(report: CranberriHealthReport | null): string {
  if (!report) return 'Checking'
  if (report.level === 'ok') return 'Healthy'
  if (report.level === 'warning') return 'Needs attention'
  return 'Broken'
}

function healthTone(level: CranberriHealthReport['level'] | 'unknown'): 'success' | 'warning' | 'danger' | 'secondary' {
  if (level === 'ok') return 'success'
  if (level === 'warning') return 'warning'
  if (level === 'error') return 'danger'
  return 'secondary'
}

function healthIconClass(level: CranberriHealthReport['level'] | 'unknown'): string {
  if (level === 'ok') return 'text-app-status-success'
  if (level === 'warning') return 'text-app-status-warning'
  if (level === 'error') return 'text-app-status-danger'
  return 'text-app-text-secondary'
}

function HealthCard() {
  const [report, setReport] = useState<CranberriHealthReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [doctorRunning, setDoctorRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setReport(await window.cranberri.health.read())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to read Cranberri health')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh().catch((err) => setError(err instanceof Error ? err.message : 'Failed to read Cranberri health'))
  }, [refresh])

  const runDoctor = async () => {
    setDoctorRunning(true)
    setError(null)
    try {
      setReport(await window.cranberri.health.doctor())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Cranberri doctor failed')
    } finally {
      setDoctorRunning(false)
    }
  }

  return (
    <div data-health-card="true" className="mt-2 flex max-h-[min(68vh,36rem)] flex-col rounded-md bg-app-bg/70 p-3">
      <div className={cn('mb-2 flex items-center gap-1.5', typeStyle({ role: 'panelTitle', tone: 'primary' }))}>
        <Activity className={`h-3.5 w-3.5 ${healthIconClass(report?.level ?? 'unknown')}`} />
        <span>Cranberri health</span>
        {(loading || doctorRunning) && <Loader2 className="ml-auto h-3 w-3 animate-spin text-app-text-muted" />}
      </div>
      <div className={typeStyle({ role: 'status', tone: healthTone(report?.level ?? 'unknown') })}>{healthLevelLabel(report)}</div>
      {error && <div className={cn('mt-1 break-words', typeStyle({ role: 'status', tone: 'danger' }))}>{error}</div>}
      {report && (
        <div className="mt-2 min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
          {report.checks.map((check) => (
            <div key={check.id} className="rounded-md px-1 py-1.5 hover:bg-app-surface-2/45">
              <div className="flex items-start justify-between gap-2">
                <span className={cn('line-clamp-2 break-words', typeStyle({ role: 'metadata', tone: 'primary' }))}>{check.label}</span>
                <span className={cn('shrink-0 capitalize', typeStyle({ role: 'status', tone: healthTone(check.level) }))}>{check.level}</span>
              </div>
              <div className={cn('mt-0.5 line-clamp-2 break-words', typeStyle({ role: 'metadata', tone: 'secondary' }))}>{check.detail}</div>
            </div>
          ))}
        </div>
      )}
      <div className="mt-2 grid shrink-0 grid-cols-2 gap-2 bg-app-bg/95 pt-1">
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={loading || doctorRunning}
          className={buttonStyle({ tone: 'secondary', size: 'compact' })}
        >
          Refresh
        </button>
        <button
          type="button"
          onClick={() => void runDoctor()}
          disabled={loading || doctorRunning}
          className={buttonStyle({ tone: 'secondary', size: 'compact' })}
        >
          <Wrench className="h-3 w-3" />
          Doctor
        </button>
      </div>
    </div>
  )
}

function LeftRailFooter() {
  const [openPanel, setOpenPanel] = useState<'usage' | 'health' | null>(null)

  return (
    <>
      {openPanel === 'usage' && (
        <div className="mt-2 rounded-md bg-app-bg/70">
          <UsageMeter />
        </div>
      )}
      {openPanel === 'health' && <HealthCard />}
      <div className="mt-2 flex h-9 shrink-0 items-center gap-1 px-1">
        <IconButton
          type="button"
          onClick={() => setOpenPanel((panel) => panel === 'usage' ? null : 'usage')}
          tone={openPanel === 'usage' ? 'active' : 'neutral'}
          label="Usage remaining"
        >
          <Gauge className="h-4 w-4" />
        </IconButton>
        <IconButton
          type="button"
          onClick={() => setOpenPanel((panel) => panel === 'health' ? null : 'health')}
          tone={openPanel === 'health' ? 'active' : 'neutral'}
          label="Cranberri health"
        >
          <Stethoscope className="h-4 w-4" />
        </IconButton>
      </div>
    </>
  )
}

export function RepoRail() {
  const { repos, activeRepoId, addRepo, removeRepo, setActiveRepo, setPinnedBranch } = useRepos()
  const { state: appState, updateAppState } = useAppState()
  const tasksApi = useOptionalTasks()
  const { openChat, bindWindowToTask, closeSessionWindows } = useWorkspace()
  const { bindTaskWindow } = useCodexActions()
  const expandedProjectIds = appState.expandedProjectIds
  const [removeRepoTarget, setRemoveRepoTarget] = useState<{ id: string; name: string } | null>(null)
  const [removingRepo, setRemovingRepo] = useState(false)
  const [removeRepoError, setRemoveRepoError] = useState<string | null>(null)
  const addRepoButtonRef = useRef<HTMLButtonElement | null>(null)
  const removeRepoReturnFocusRef = useRef<HTMLButtonElement | null>(null)

  const restoreRemoveRepoFocus = useCallback((preferAddButton = false) => {
    const target = preferAddButton
      ? addRepoButtonRef.current
      : removeRepoReturnFocusRef.current ?? addRepoButtonRef.current
    requestAnimationFrame(() => {
      if (target?.isConnected) target.focus()
    })
  }, [])

  const toggleRepoSessions = (repoId: string) => {
    updateAppState((current) => ({
      ...current,
      expandedProjectIds: { ...current.expandedProjectIds, [repoId]: !current.expandedProjectIds[repoId] },
    }))
  }

  const confirmRemoveRepo = async () => {
    if (!removeRepoTarget || removingRepo) return
    setRemovingRepo(true)
    setRemoveRepoError(null)
    try {
      await removeRepo(removeRepoTarget.id)
      setRemoveRepoTarget(null)
      restoreRemoveRepoFocus(true)
      toast.success('Repository removed')
    } catch (error) {
      setRemoveRepoError(error instanceof Error ? error.message : 'Failed to remove repository')
    } finally {
      setRemovingRepo(false)
    }
  }

  const openTask = useCallback(async (taskId: string) => {
    if (!tasksApi) return
    const task = tasksApi.tasks.find((candidate) => candidate.id === taskId)
    const context = tasksApi.executionContextForTask(taskId)
    if (!task || !context) {
      toast.error('This task checkout is unavailable')
      return
    }
    if (activeRepoId !== task.projectId) await setActiveRepo(task.projectId)
    tasksApi.setActiveTask(task.id)
    const windowId = `task-${task.id}`
    openChat(windowId, task.location === 'local' ? 'Local session' : 'Worktree task', task.projectId, context, task.location)
    bindWindowToTask(windowId, context)
    if (task.threadId) {
      try {
        await bindTaskWindow(windowId, task)
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Failed to open task')
      }
    }
  }, [activeRepoId, bindTaskWindow, bindWindowToTask, openChat, setActiveRepo, tasksApi])

  const openNewSession = useCallback(async (projectId: string, target: 'local' | 'worktree') => {
    const project = repos.find((candidate) => candidate.id === projectId)
    if (!project) {
      toast.error('This repository is unavailable')
      return
    }
    if (activeRepoId !== projectId) await setActiveRepo(projectId)
    tasksApi?.setActiveTask(null)
    openChat(undefined, target === 'local' ? 'New local session' : 'New worktree session', projectId, localProjectExecutionContext(project), target)
  }, [activeRepoId, openChat, repos, setActiveRepo, tasksApi])

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-app-surface px-2.5 py-2">
      <div className="mb-2 flex h-7 shrink-0 items-center justify-between px-1">
        <span className={typeStyle({ role: 'panelTitle', tone: 'primary' })}>Repos</span>
        <IconButton
          ref={addRepoButtonRef}
          onClick={addRepo}
          label="Add repo"
        >
          <Plus className="h-4 w-4" />
        </IconButton>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto overflow-x-hidden pr-1">
        {repos.length === 0 && (
          <div className="flex min-h-32 flex-col items-center justify-center gap-3 px-3 text-center">
            <FolderGit2 className="h-5 w-5 text-app-text-subtle" />
            <div className={typeStyle({ role: 'body', tone: 'secondary' })}>No repositories</div>
            <button type="button" onClick={addRepo} className={buttonStyle({ tone: 'secondary', size: 'compact' })}>
              <Plus className="h-3.5 w-3.5" />
              Add repository
            </button>
          </div>
        )}
        {repos.map((repo) => (
          <div key={repo.id} data-repo-id={repo.id} className="shrink-0">
            <div
              className={cn(
                'group flex h-8 items-center rounded-md transition-colors duration-fast ease-standard',
                typeStyle({ role: 'control', tone: activeRepoId === repo.id ? 'primary' : 'secondary' }),
                activeRepoId === repo.id ? 'bg-app-surface-2' : 'hover:bg-app-surface-2/60 hover:text-app-text',
              )}
              title={repo.path}
            >
              <button
                type="button"
                onClick={() => setActiveRepo(repo.id)}
                className="flex h-full min-w-0 flex-1 items-center gap-2 rounded-md pl-2 text-left"
                aria-label={`Open ${repo.name}`}
              >
                <FolderGit2 className="h-4 w-4 shrink-0 opacity-75" />
                <span className="min-w-0 flex-1 truncate">{repo.name}</span>
              </button>
              <NewSessionMenu
                label={`New session in ${repo.name}`}
                className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                onLocal={() => { void openNewSession(repo.id, 'local') }}
                onWorktree={() => { void openNewSession(repo.id, 'worktree') }}
              />
              <DropdownMenu.Root>
                <DropdownMenu.Trigger asChild>
                  <button
                    type="button"
                    onFocus={(event) => { removeRepoReturnFocusRef.current = event.currentTarget }}
                    onPointerDown={(event) => { removeRepoReturnFocusRef.current = event.currentTarget }}
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-app-text-subtle opacity-0 hover:bg-app-border/70 hover:text-app-text group-hover:opacity-100 focus-visible:opacity-100"
                    title="Repository options"
                    aria-label={`Options for ${repo.name}`}
                  >
                    <MoreHorizontal className="h-3.5 w-3.5" />
                  </button>
                </DropdownMenu.Trigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.Content align="start" sideOffset={4} collisionPadding={8} className={cn(menuSurface, 'z-[1400] w-60')}>
                    <RepoPinnedBranchMenu projectId={repo.id} repoPath={repo.path} pinnedBranch={repo.pinnedLocalBranch} onPin={(branch) => setPinnedBranch(repo.id, branch)} />
                    <DropdownMenu.Item className={cn(RAIL_MENU_ITEM, typeStyle({ role: 'control', tone: 'danger' }), 'data-[highlighted]:bg-app-danger/10')} onSelect={() => {
                      afterMenuCloses(() => {
                        setRemoveRepoTarget({ id: repo.id, name: repo.name })
                        setRemoveRepoError(null)
                      })
                    }}>
                      <Trash2 className="h-3.5 w-3.5" /> Remove repository
                    </DropdownMenu.Item>
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </DropdownMenu.Root>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  toggleRepoSessions(repo.id)
                }}
                className="mr-1 flex h-6 w-6 shrink-0 items-center justify-center rounded text-app-text-subtle hover:bg-app-border/70 hover:text-app-text"
                title={expandedProjectIds[repo.id] ? 'Collapse sessions' : 'Expand sessions'}
                aria-label={`${expandedProjectIds[repo.id] ? 'Collapse' : 'Expand'} sessions for ${repo.name}`}
              >
                <ChevronRight className={`w-3 h-3 transition-transform ${expandedProjectIds[repo.id] ? 'rotate-90' : ''}`} />
              </button>
            </div>
            {expandedProjectIds[repo.id] && <RepoSessions projectId={repo.id} repoPath={repo.path} isActiveRepo={activeRepoId === repo.id} closeSessionWindows={closeSessionWindows} />}
            {expandedProjectIds[repo.id] && tasksApi && (
              <ProjectTaskRows projectId={repo.id} tasks={tasksApi.rootTasks.filter((task) => task.projectId === repo.id && !task.threadId && task.role !== 'control')} onOpen={(taskId) => { void openTask(taskId) }} />
            )}
          </div>
        ))}
      </div>
      <LeftRailFooter />
      {removeRepoTarget && (
        <ConfirmDialog
          title="Remove repository"
          description={`Remove ${removeRepoTarget.name} from Cranberri? Files on disk will not be changed.`}
          confirmLabel="Remove"
          busyLabel="Removing..."
          busy={removingRepo}
          danger
          error={removeRepoError}
          onCancel={() => {
            if (removingRepo) return
            setRemoveRepoTarget(null)
            setRemoveRepoError(null)
            restoreRemoveRepoFocus()
          }}
          onConfirm={() => { void confirmRemoveRepo() }}
        />
      )}
    </div>
  )
}

function ProjectTaskRows({ projectId, tasks, onOpen }: { projectId: string; tasks: import('@/shared/tasks').Task[]; onOpen: (id: string) => void }) {
  if (tasks.length === 0) return null
  return <div className="ml-8 mt-1 space-y-0.5" data-project-tasks={projectId}>{tasks.map((task) => <TaskRailRow key={task.id} task={task} onOpen={onOpen} />)}</div>
}

function TaskRailRow({ task, onOpen }: { task: import('@/shared/tasks').Task; onOpen: (id: string) => void }) {
  const Icon = task.location === 'local' ? Laptop : TreePine
  const location = task.location === 'local' ? 'Local' : 'Worktree'
  const detail = (task.baseRef ?? 'Detached').replace(/^refs\/(heads|remotes)\//, '')
  return <button type="button" onClick={() => onOpen(task.id)} className="flex min-h-7 w-full items-center gap-1.5 rounded-md px-2 text-left hover:bg-app-surface-2/60" aria-label={`Open ${location} task on ${detail}`}><Icon className="h-3 w-3 shrink-0 text-app-text-muted" /><span className={cn('min-w-0 flex-1 truncate', typeStyle({ role: 'metadata', tone: 'secondary' }))}>{location} · {detail}</span></button>
}
