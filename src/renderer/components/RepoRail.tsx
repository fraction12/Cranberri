import { useCallback, useEffect, useState } from 'react'
import { Archive, ChevronRight, FolderGit2, Plus, RotateCcw, Trash2 } from 'lucide-react'
import { useRepos } from '../state/repos'
import { useCodex } from '../state/codex'
import { UsageMeter } from './UsageMeter'
import type { CodexSessionSummary } from '@/shared/codex'

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

const CLOSE_RAIL_MENUS_EVENT = 'cranberri:close-rail-menus'

function closeRailMenus() {
  window.dispatchEvent(new CustomEvent(CLOSE_RAIL_MENUS_EVENT))
}

function openSession(session: CodexSessionSummary, archived = false) {
  closeRailMenus()
  window.dispatchEvent(new CustomEvent('cranberri:open-codex-session', { detail: { session, archived } }))
}

function SessionRow({
  session,
  archived,
  onArchive,
  onUnarchive,
  onDelete,
  onRename,
  active,
}: {
  session: CodexSessionSummary
  archived?: boolean
  active?: boolean
  onArchive: (session: CodexSessionSummary) => void
  onUnarchive: (session: CodexSessionSummary) => void
  onDelete: (session: CodexSessionSummary) => void
  onRename: (session: CodexSessionSummary) => void
}) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)

  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    window.addEventListener('click', close)
    window.addEventListener('keydown', close)
    window.addEventListener(CLOSE_RAIL_MENUS_EVENT, close)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('keydown', close)
      window.removeEventListener(CLOSE_RAIL_MENUS_EVENT, close)
    }
  }, [menu])

  return (
    <>
      <button
        type="button"
        onClick={() => openSession(session, archived)}
        onContextMenu={(event) => {
          event.preventDefault()
          closeRailMenus()
          setMenu({ x: event.clientX, y: event.clientY })
        }}
        className={`group/session w-full rounded px-2 py-1.5 text-left ${active ? 'bg-app-surface-2 text-app-text' : 'hover:bg-app-surface-2/60'}`}
        title={session.preview || sessionTitle(session)}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-xs text-app-text">{sessionTitle(session)}</span>
          <span className="shrink-0 text-[10px] text-app-text-muted">{relativeTime(session.recencyAt ?? session.updatedAt ?? session.createdAt)}</span>
        </div>
        {session.preview && <div className="mt-0.5 truncate text-[11px] text-app-text-muted">{session.preview}</div>}
      </button>
      {menu && (
        <div
          className="fixed z-50 w-44 rounded-lg border border-app-border bg-app-surface p-1 text-xs shadow-xl"
          style={{ left: menu.x, top: menu.y }}
          onClick={(event) => event.stopPropagation()}
        >
          <button className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-app-surface-2" onClick={() => { onRename(session); setMenu(null) }}>
            Rename…
          </button>
          {archived ? (
            <button className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-app-surface-2" onClick={() => { onUnarchive(session); setMenu(null) }}>
              <RotateCcw className="h-3.5 w-3.5" />
              Unarchive
            </button>
          ) : (
            <button className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-app-surface-2" onClick={() => { onArchive(session); setMenu(null) }}>
              <Archive className="h-3.5 w-3.5" />
              Archive
            </button>
          )}
          <button className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-app-danger hover:bg-app-danger hover:text-white" onClick={() => { onDelete(session); setMenu(null) }}>
            <Trash2 className="h-3.5 w-3.5" />
            Delete
          </button>
        </div>
      )}
    </>
  )
}

function RepoSessions({ repoPath }: { repoPath: string }) {
  const { openThreadIds, archiveSession, unarchiveSession, deleteSession, renameSession } = useCodex()
  const [recent, setRecent] = useState<CodexSessionSummary[]>([])
  const [archived, setArchived] = useState<CodexSessionSummary[]>([])
  const [showArchived, setShowArchived] = useState(false)
  const [loading, setLoading] = useState(false)
  const [renameTarget, setRenameTarget] = useState<CodexSessionSummary | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [renaming, setRenaming] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const [recentResult, archivedResult] = await Promise.all([
        window.cranberri.codex.listThreads(repoPath, { archived: false, limit: 8 }),
        window.cranberri.codex.listThreads(repoPath, { archived: true, limit: 8 }),
      ])
      setRecent(recentResult.sessions)
      setArchived(archivedResult.sessions)
    } finally {
      setLoading(false)
    }
  }, [repoPath])

  useEffect(() => {
    refresh().catch((error) => console.error('Failed to load Codex sessions:', error))
  }, [refresh])

  useEffect(() => {
    const onSessionsChanged = (event: Event) => {
      const changedRepoPath = (event as CustomEvent).detail?.repoPath
      if (!changedRepoPath || changedRepoPath === repoPath) {
        refresh().catch((error) => console.error('Failed to refresh Codex sessions:', error))
      }
    }
    window.addEventListener('cranberri:codex-sessions-changed', onSessionsChanged)
    return () => window.removeEventListener('cranberri:codex-sessions-changed', onSessionsChanged)
  }, [refresh, repoPath])

  const archive = async (session: CodexSessionSummary) => {
    setRecent((prev) => prev.filter((item) => item.id !== session.id))
    setArchived((prev) => [session, ...prev.filter((item) => item.id !== session.id)])
    await archiveSession(session.id)
    await refresh()
  }

  const unarchive = async (session: CodexSessionSummary) => {
    setArchived((prev) => prev.filter((item) => item.id !== session.id))
    setRecent((prev) => [session, ...prev.filter((item) => item.id !== session.id)])
    await unarchiveSession(session.id)
    await refresh()
  }

  const remove = async (session: CodexSessionSummary) => {
    if (!window.confirm(`Delete Codex session "${sessionTitle(session)}"? This cannot be undone.`)) return
    setRecent((prev) => prev.filter((item) => item.id !== session.id))
    setArchived((prev) => prev.filter((item) => item.id !== session.id))
    await deleteSession(session.id)
    await refresh()
  }

  const rename = (session: CodexSessionSummary) => {
    setRenameTarget(session)
    setRenameValue(sessionTitle(session))
  }

  const submitRename = async () => {
    if (!renameTarget) return
    const name = renameValue.trim()
    if (!name || name === sessionTitle(renameTarget)) {
      setRenameTarget(null)
      return
    }
    setRenaming(true)
    try {
      await renameSession(renameTarget.id, name)
      setRecent((prev) => prev.map((item) => item.id === renameTarget.id ? { ...item, title: name } : item))
      setArchived((prev) => prev.map((item) => item.id === renameTarget.id ? { ...item, title: name } : item))
      await refresh()
      setRenameTarget(null)
    } finally {
      setRenaming(false)
    }
  }

  return (
    <div className="ml-6 mt-1 flex min-h-0 flex-1 flex-col pl-2">
      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
        {recent.length === 0 && !loading && <div className="px-2 py-1 text-[11px] text-app-text-muted">No Codex sessions</div>}
        {recent.map((session) => (
          <SessionRow key={session.id} session={session} active={openThreadIds.includes(session.id)} onArchive={archive} onUnarchive={unarchive} onDelete={remove} onRename={rename} />
        ))}
        {archived.length > 0 && (
          <>
            <button
              type="button"
              onClick={() => setShowArchived((value) => !value)}
              className="w-full rounded px-2 py-1 text-left text-[11px] text-app-text-muted hover:bg-app-surface-2/50"
            >
              {showArchived ? 'Hide' : 'Show'} archived ({archived.length})
            </button>
            {showArchived && archived.map((session) => (
              <SessionRow key={session.id} session={session} archived active={openThreadIds.includes(session.id)} onArchive={archive} onUnarchive={unarchive} onDelete={remove} onRename={rename} />
            ))}
          </>
        )}
        {loading && <div className="px-2 py-2 text-[11px] text-app-text-muted">Loading…</div>}
      </div>
      {renameTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45" onClick={() => !renaming && setRenameTarget(null)}>
          <form
            className="w-[360px] rounded-xl border border-app-border bg-app-surface p-4 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
            onSubmit={(event) => {
              event.preventDefault()
              submitRename().catch((error) => console.error('Failed to rename Codex session:', error))
            }}
          >
            <div className="text-sm font-medium text-app-text">Rename session</div>
            <div className="mt-1 text-xs text-app-text-muted">This updates the Codex thread name through the SDK.</div>
            <input
              autoFocus
              value={renameValue}
              onChange={(event) => setRenameValue(event.target.value)}
              className="mt-4 w-full rounded-lg border border-app-border bg-app-bg px-3 py-2 text-sm text-app-text outline-none focus:border-app-text-muted"
              placeholder="Session name"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                disabled={renaming}
                onClick={() => setRenameTarget(null)}
                className="rounded-lg px-3 py-1.5 text-xs text-app-text-muted hover:bg-app-surface-2 hover:text-app-text disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={renaming || !renameValue.trim()}
                className="rounded-lg border border-app-border bg-app-surface-2 px-3 py-1.5 text-xs font-medium text-app-text hover:bg-app-border disabled:opacity-50"
              >
                {renaming ? 'Renaming…' : 'Rename'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}

export function RepoRail() {
  const { repos, activeRepoId, addRepo, removeRepo, setActiveRepo } = useRepos()
  const [expandedRepoIds, setExpandedRepoIds] = useState<Record<string, boolean>>({})
  const [repoMenu, setRepoMenu] = useState<{ repoId: string; x: number; y: number } | null>(null)

  useEffect(() => {
    if (!repoMenu) return
    const close = () => setRepoMenu(null)
    window.addEventListener('click', close)
    window.addEventListener('keydown', close)
    window.addEventListener(CLOSE_RAIL_MENUS_EVENT, close)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('keydown', close)
      window.removeEventListener(CLOSE_RAIL_MENUS_EVENT, close)
    }
  }, [repoMenu])

  const toggleRepoSessions = (repoId: string) => {
    setExpandedRepoIds((prev) => ({ ...prev, [repoId]: !prev[repoId] }))
  }

  return (
    <div className="h-full w-full flex flex-col border-r border-app-border bg-app-surface py-2 px-3 overflow-hidden">
      <div className="flex items-center justify-between mb-3 shrink-0">
        <span className="text-xs font-semibold uppercase text-app-text-muted tracking-wider">Repos</span>
        <button
          onClick={addRepo}
          className="p-1.5 rounded hover:bg-app-surface-2"
          title="Add repo"
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-hidden">
        {repos.map((repo) => (
          <div key={repo.id} className={activeRepoId === repo.id && expandedRepoIds[repo.id] ? 'flex min-h-0 flex-1 flex-col' : 'shrink-0'}>
            <div
              onClick={() => setActiveRepo(repo.id)}
              onContextMenu={(event) => {
                event.preventDefault()
                closeRailMenus()
                setRepoMenu({ repoId: repo.id, x: event.clientX, y: event.clientY })
              }}
              className={`group flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer ${
                activeRepoId === repo.id ? 'bg-app-surface-2' : 'hover:bg-app-surface-2/50'
              }`}
              title={repo.path}
            >
              <FolderGit2 className="w-4 h-4 shrink-0 text-app-text-muted" />
              <span className="text-sm truncate flex-1">{repo.name}</span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  setActiveRepo(repo.id)
                  toggleRepoSessions(repo.id)
                }}
                className="ml-auto p-1 rounded text-app-text-muted hover:bg-app-surface-2 hover:text-app-text"
                title={expandedRepoIds[repo.id] ? 'Collapse sessions' : 'Expand sessions'}
              >
                <ChevronRight className={`w-3 h-3 transition-transform ${expandedRepoIds[repo.id] ? 'rotate-90' : ''}`} />
              </button>
            </div>
            {activeRepoId === repo.id && expandedRepoIds[repo.id] && <RepoSessions repoPath={repo.path} />}
          </div>
        ))}
      </div>
      <UsageMeter />
      {repoMenu && (
        <div
          className="fixed z-50 w-40 rounded-lg border border-app-border bg-app-surface p-1 text-xs shadow-xl"
          style={{ left: repoMenu.x, top: repoMenu.y }}
          onClick={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-app-danger hover:bg-app-danger hover:text-white"
            onClick={() => {
              removeRepo(repoMenu.repoId)
              setRepoMenu(null)
            }}
          >
            <Trash2 className="h-3.5 w-3.5" />
            Remove repo
          </button>
        </div>
      )}
    </div>
  )
}
