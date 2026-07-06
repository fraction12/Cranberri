import { useEffect, useState } from 'react'
import { Archive, FolderGit2, Plus, RotateCcw, Trash2, X } from 'lucide-react'
import { useRepos } from '../state/repos'
import { useCodex } from '../state/codex'
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

function openSession(session: CodexSessionSummary, archived = false) {
  window.dispatchEvent(new CustomEvent('cranberri:open-codex-session', { detail: { session, archived } }))
}

function SessionRow({
  session,
  archived,
  onArchive,
  onUnarchive,
  onDelete,
}: {
  session: CodexSessionSummary
  archived?: boolean
  onArchive: (session: CodexSessionSummary) => void
  onUnarchive: (session: CodexSessionSummary) => void
  onDelete: (session: CodexSessionSummary) => void
}) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)

  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    window.addEventListener('click', close)
    window.addEventListener('keydown', close)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('keydown', close)
    }
  }, [menu])

  return (
    <>
      <button
        type="button"
        onClick={() => openSession(session, archived)}
        onContextMenu={(event) => {
          event.preventDefault()
          setMenu({ x: event.clientX, y: event.clientY })
        }}
        className="group/session w-full rounded px-2 py-1.5 text-left hover:bg-app-surface-2/60"
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
          <button className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-app-surface-2" onClick={() => openSession(session, archived)}>
            Open
          </button>
          {archived ? (
            <button className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-app-surface-2" onClick={() => onUnarchive(session)}>
              <RotateCcw className="h-3.5 w-3.5" />
              Unarchive
            </button>
          ) : (
            <button className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-app-surface-2" onClick={() => onArchive(session)}>
              <Archive className="h-3.5 w-3.5" />
              Archive
            </button>
          )}
          <button className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-app-danger hover:bg-app-danger hover:text-white" onClick={() => onDelete(session)}>
            <Trash2 className="h-3.5 w-3.5" />
            Delete
          </button>
        </div>
      )}
    </>
  )
}

function RepoSessions({ repoPath }: { repoPath: string }) {
  const { archiveSession, unarchiveSession, deleteSession } = useCodex()
  const [recent, setRecent] = useState<CodexSessionSummary[]>([])
  const [archived, setArchived] = useState<CodexSessionSummary[]>([])
  const [showArchived, setShowArchived] = useState(false)
  const [loading, setLoading] = useState(false)

  const refresh = async () => {
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
  }

  useEffect(() => {
    refresh().catch((error) => console.error('Failed to load Codex sessions:', error))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoPath])

  const archive = async (session: CodexSessionSummary) => {
    await archiveSession(session.id)
    await refresh()
  }

  const unarchive = async (session: CodexSessionSummary) => {
    await unarchiveSession(session.id)
    await refresh()
  }

  const remove = async (session: CodexSessionSummary) => {
    if (!window.confirm(`Delete Codex session "${sessionTitle(session)}"? This cannot be undone.`)) return
    await deleteSession(session.id)
    await refresh()
  }

  return (
    <div className="ml-6 mt-1 space-y-1 border-l border-app-border/70 pl-2">
      <div className="flex items-center justify-between pr-1 text-[10px] font-semibold uppercase tracking-wider text-app-text-muted">
        <span>Sessions</span>
        {loading && <span>…</span>}
      </div>
      {recent.length === 0 && !loading && <div className="px-2 py-1 text-[11px] text-app-text-muted">No Codex sessions</div>}
      {recent.map((session) => (
        <SessionRow key={session.id} session={session} onArchive={archive} onUnarchive={unarchive} onDelete={remove} />
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
            <SessionRow key={session.id} session={session} archived onArchive={archive} onUnarchive={unarchive} onDelete={remove} />
          ))}
        </>
      )}
    </div>
  )
}

export function RepoRail() {
  const { repos, activeRepoId, addRepo, removeRepo, setActiveRepo } = useRepos()

  return (
    <div className="w-64 h-full flex flex-col border-r border-app-border bg-app-surface py-2 px-3 overflow-hidden">
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

      <div className="flex flex-col gap-1 overflow-y-auto">
        {repos.map((repo) => (
          <div key={repo.id}>
            <div
              onClick={() => setActiveRepo(repo.id)}
              className={`group flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer ${
                activeRepoId === repo.id ? 'bg-app-surface-2' : 'hover:bg-app-surface-2/50'
              }`}
              title={repo.path}
            >
              <FolderGit2 className="w-4 h-4 shrink-0 text-app-text-muted" />
              <span className="text-sm truncate flex-1">{repo.name}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  removeRepo(repo.id)
                }}
                className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-app-danger hover:text-white transition-opacity"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
            {activeRepoId === repo.id && <RepoSessions repoPath={repo.path} />}
          </div>
        ))}
      </div>
    </div>
  )
}
