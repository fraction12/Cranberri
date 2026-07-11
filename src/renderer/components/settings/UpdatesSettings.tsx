import { AlertCircle, CheckCircle2, Download, FolderOpen, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import type { AppSettings } from '@/shared/settings'
import type { UpdateInfo } from '@/shared/update'
import { useUpdate } from '../../state/update'
import { SettingsPage, SettingsSection } from './settings-page'

type UpdateController = ReturnType<typeof useUpdate>
type UpdateSettingsWriter = <Section extends keyof AppSettings>(
  section: Section,
  values: Partial<AppSettings[Section]>,
) => Promise<void>

export function updateStatusCopy(status: UpdateInfo | null, channel: AppSettings['updater']['channel']): {
  title: string
  description: string
  tone: 'default' | 'success' | 'warning' | 'danger'
} {
  if (!status) return { title: 'Not checked yet', description: 'Check for updates to compare this build.', tone: 'default' }
  const current = status.currentCommit?.slice(0, 7)
  const latest = status.latestCommit?.slice(0, 7)
  const refs = current && latest ? `Running ${current} · ${channel === 'beta' ? 'origin/main' : 'latest'} ${latest}` : 'Build details unavailable'
  if (status.status === 'upToDate') return { title: 'Cranberri is up to date', description: refs, tone: 'success' }
  if (status.status === 'updateAvailable') {
    const count = status.commitsBehind
    return { title: count === null ? 'Update available' : `${count} commit${count === 1 ? '' : 's'} available`, description: refs, tone: 'warning' }
  }
  if (status.status === 'failed') return { title: 'Update check failed', description: status.failureMessage || 'Try checking again.', tone: 'danger' }
  if (status.status === 'blocked') return { title: 'Update blocked', description: status.blockedMessage || 'Review the update requirements below.', tone: 'warning' }
  if (status.status === 'checking') return { title: 'Checking for updates', description: refs, tone: 'default' }
  if (status.status === 'building') return { title: 'Building the update', description: refs, tone: 'default' }
  if (status.status === 'readyToInstall') return { title: 'Update ready to install', description: refs, tone: 'success' }
  if (status.status === 'installing') return { title: 'Installing update', description: 'Cranberri will relaunch when installation finishes.', tone: 'default' }
  return { title: 'Update status unavailable', description: 'Check again to refresh update status.', tone: 'default' }
}

export function UpdatesSettings({
  update,
  settings,
  updateSection,
}: {
  update: UpdateController
  settings: AppSettings
  updateSection: UpdateSettingsWriter
}) {
  const statusCopy = updateStatusCopy(update.status, settings.updater.channel)

  const saveUpdater = async (values: Partial<AppSettings['updater']>) => {
    try {
      await updateSection('updater', values)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save update settings')
    }
  }

  const chooseRepo = async () => {
    try {
      const repoPath = await window.cranberri.repos.pickDirectory()
      if (repoPath) await saveUpdater({ sourceRepoPath: repoPath })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not choose the Cranberri repo')
    }
  }

  const checkForUpdates = async () => {
    try {
      const result = await update.check()
      const copy = updateStatusCopy(result, settings.updater.channel)
      if (result.status === 'upToDate') toast.success(copy.title)
      else if (result.status === 'updateAvailable') toast.info(copy.title)
      else if (result.status === 'failed' || result.status === 'blocked') toast.error(copy.title)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not check for updates')
    }
  }

  const installUpdate = async () => {
    try {
      const result = await update.install()
      if (!result.success) toast.error(result.message ?? 'Update failed')
      else if (result.phase === 'upToDate') toast.success(result.message ?? 'Cranberri is up to date')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not install the update')
    }
  }

  const openLog = async () => {
    if (!update.status?.logPath) return
    try {
      await window.cranberri.openPath(update.status.logPath)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not open the update log')
    }
  }

  return (
    <SettingsPage title="Updates" description="Choose how Cranberri receives new builds.">
      <SettingsSection title="Channel">
        <div className="grid grid-cols-2 gap-2" role="group" aria-label="Update channel">
          {(['stable', 'beta'] as const).map((channel) => {
            const selected = settings.updater.channel === channel
            return (
              <button
                key={channel}
                type="button"
                aria-pressed={selected}
                onClick={() => void saveUpdater({ channel })}
                className={`min-h-16 rounded-md border px-3 py-2 text-left ${selected ? 'border-app-accent bg-app-accent/10 text-app-text' : 'border-app-border bg-app-bg text-app-text-muted hover:bg-app-surface-2'}`}
              >
                <div className="text-sm font-medium capitalize">{channel}</div>
                <div className="mt-1 text-caption">{channel === 'stable' ? 'Install published releases.' : 'Build and install origin/main.'}</div>
              </button>
            )
          })}
        </div>

        {settings.updater.channel === 'beta' && (
          <div className="space-y-2 pt-2">
            <label className="block text-xs text-app-text-muted" htmlFor="settings-beta-repo">Local Cranberri repo</label>
            <div className="flex gap-2">
              <input
                id="settings-beta-repo"
                value={settings.updater.sourceRepoPath ?? ''}
                onChange={(event) => void saveUpdater({ sourceRepoPath: event.target.value })}
                placeholder="Choose a local clone"
                className="h-9 min-w-0 flex-1 rounded-md border border-app-border bg-app-bg px-2.5 font-mono text-xs text-app-text outline-none focus:border-app-accent"
              />
              <button
                type="button"
                onClick={() => void chooseRepo()}
                className="inline-flex h-9 items-center gap-1.5 rounded-md bg-app-surface-2 px-3 text-xs font-medium text-app-text hover:bg-app-border"
              >
                <FolderOpen className="h-3.5 w-3.5" />
                Choose
              </button>
            </div>
            <p className="text-caption text-app-text-muted">Cranberri fetches, builds, and installs the latest main branch from this clone.</p>
          </div>
        )}
      </SettingsSection>

      <SettingsSection title="Current build">
        <div className="flex items-start gap-3 rounded-md bg-app-bg px-3 py-3">
          <StatusIcon tone={statusCopy.tone} />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-app-text">{statusCopy.title}</div>
            <div className="mt-0.5 text-caption text-app-text-muted">{statusCopy.description}</div>
          </div>
        </div>

        {update.status?.status === 'failed' && update.status.logPath && (
          <button type="button" onClick={() => void openLog()} className="w-fit text-xs text-app-danger underline underline-offset-4">
            Open update log
          </button>
        )}

        {update.progress && update.status?.status !== 'upToDate' && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-caption text-app-text-muted">
              <span>{update.progress.message}</span>
              {update.progress.percent !== null && <span>{update.progress.percent}%</span>}
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-app-surface-2">
              <div className="h-full rounded-full bg-app-accent transition-all" style={{ width: `${update.progress.percent ?? 0}%` }} />
            </div>
          </div>
        )}

        <div className="flex gap-2 pt-1">
          <button
            type="button"
            onClick={() => void checkForUpdates()}
            disabled={update.checking || update.installing}
            className="inline-flex h-9 items-center gap-2 rounded-md bg-app-surface-2 px-3 text-xs font-medium text-app-text hover:bg-app-border disabled:opacity-50"
          >
            {update.checking && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {update.checking ? 'Checking...' : 'Check for updates'}
          </button>
          {update.status?.status === 'updateAvailable' && (
            <button
              type="button"
              onClick={() => void installUpdate()}
              disabled={update.checking || update.installing}
              className="inline-flex h-9 items-center gap-2 rounded-md bg-app-accent px-3 text-xs font-medium text-app-accent-contrast hover:bg-app-accent/90 disabled:opacity-50"
            >
              <Download className="h-3.5 w-3.5" />
              {update.installing ? 'Installing...' : settings.updater.channel === 'beta' ? 'Build and install' : 'Install update'}
            </button>
          )}
        </div>
      </SettingsSection>
    </SettingsPage>
  )
}

function StatusIcon({ tone }: { tone: ReturnType<typeof updateStatusCopy>['tone'] }) {
  if (tone === 'success') return <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-app-success" />
  if (tone === 'warning' || tone === 'danger') return <AlertCircle className={`mt-0.5 h-4 w-4 shrink-0 ${tone === 'danger' ? 'text-app-danger' : 'text-app-warning'}`} />
  return <Download className="mt-0.5 h-4 w-4 shrink-0 text-app-text-muted" />
}
