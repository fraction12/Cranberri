import { useCallback, useEffect, useRef, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { Activity, AlertTriangle, Command, Download, FileText, GitBranch, Keyboard, Loader2, PackageOpen, Palette, PlugZap, RotateCcw, Wrench, X } from 'lucide-react'
import { useSettings } from '../state/settings'
import { useUpdate } from '../state/update'
import { cn, dialogSurface } from '../lib/ui'
import { typeStyle } from '../lib/typography'
import { CodexResourcesSection } from './CodexResourcesSection'
import { ConfirmDialog } from './ConfirmDialog'
import { DiagnosticsSection } from './DiagnosticsSection'
import { AppearanceSettings } from './settings/AppearanceSettings'
import { GeneralSettings } from './settings/GeneralSettings'
import { SettingsList, SettingsPage, SettingsRow } from './settings/settings-page'
import { ToolsSettingsPane } from './settings/tools-settings-pane'
import { UpdatesSettings } from './settings/UpdatesSettings'
import { WorktreesSettings } from './settings/WorktreesSettings'
import { EnvironmentsSettings } from './settings/EnvironmentsSettings'
import { useTasks } from '../state/tasks'
import { useRepos } from '../state/repos'
import { toast } from 'sonner'
import type { EnvironmentProfile, EnvironmentRecord } from '@/shared/environments'
import { IconButton } from './ui/IconButton'

interface SettingsDialogProps {
  open: boolean
  onClose: () => void
  initialTab?: SettingsTabValue
}

export type SettingsTabValue = 'general' | 'appearance' | 'worktrees' | 'environments' | 'tools' | 'apps' | 'updates' | 'diagnostics' | 'shortcuts' | 'about'

const TABS: Array<{ value: SettingsTabValue; label: string; icon: React.ElementType }> = [
  { value: 'general', label: 'General', icon: Command },
  { value: 'appearance', label: 'Appearance', icon: Palette },
  { value: 'worktrees', label: 'Worktrees', icon: GitBranch },
  { value: 'environments', label: 'Environments', icon: PackageOpen },
  { value: 'tools', label: 'Tools', icon: Wrench },
  { value: 'apps', label: 'Extensions', icon: PlugZap },
  { value: 'updates', label: 'Updates', icon: Download },
  { value: 'diagnostics', label: 'Diagnostics', icon: Activity },
  { value: 'shortcuts', label: 'Shortcuts', icon: Keyboard },
  { value: 'about', label: 'About', icon: FileText },
]

export function SettingsDialog({ open, onClose, initialTab = 'general' }: SettingsDialogProps) {
  const { settings, loading, status, retry, updateSection } = useSettings()
  const update = useUpdate()
  const [activeTab, setActiveTab] = useState<SettingsTabValue>(initialTab)
  const [version, setVersion] = useState('...')
  const contentRef = useRef<HTMLElement>(null)

  useEffect(() => {
    if (!open) return
    setActiveTab(initialTab)
    window.cranberri.getVersion().then(setVersion).catch(() => setVersion('Unavailable'))
  }, [initialTab, onClose, open])

  useEffect(() => {
    contentRef.current?.scrollTo({ top: 0 })
  }, [activeTab])

  return (
    <Dialog.Root open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[2000] bg-[var(--app-overlay)] data-[state=closed]:animate-none" />
        <Dialog.Content
          className={cn(
            dialogSurface,
            'fixed left-1/2 top-1/2 z-[2001] flex h-[min(680px,calc(100vh-32px))] w-[min(860px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden',
          )}
          aria-describedby={undefined}
        >
          <header className="flex h-12 shrink-0 items-center justify-between px-4">
            <Dialog.Title className={typeStyle({ role: 'overlayTitle', tone: 'primary' })}>Settings</Dialog.Title>
            <Dialog.Close asChild>
              <IconButton type="button" label="Close settings">
                <X className="h-4 w-4" />
              </IconButton>
            </Dialog.Close>
          </header>

          <div className="flex min-h-0 flex-1 bg-app-surface">
            <nav className="w-48 shrink-0 bg-app-bg/70 px-2.5 py-3" aria-label="Settings pages">
              {TABS.map((tab) => (
                <SidebarButton key={tab.value} active={activeTab === tab.value} {...tab} onClick={setActiveTab} />
              ))}
            </nav>

            <main ref={contentRef} className="min-w-0 flex-1 overflow-y-auto px-7 py-6" aria-live="polite">
              {loading ? (
                <div className={cn('flex items-center gap-2', typeStyle({ role: 'status', tone: 'secondary' }))}>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading settings
                </div>
              ) : status === 'error' ? (
                <div role="alert" className="flex max-w-md items-start gap-3 rounded-md bg-app-status-warning/10 px-3 py-3">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-app-status-warning" aria-hidden="true" />
                  <div className="min-w-0">
                    <div className={typeStyle({ role: 'status', tone: 'warning' })}>Settings unavailable</div>
                    <div className={cn('mt-1', typeStyle({ role: 'metadata', tone: 'secondary' }))}>
                      Cranberri could not safely load your settings. Your current settings have not been changed.
                    </div>
                    <button
                      type="button"
                      className={cn('mt-3 inline-flex items-center gap-1.5 rounded-md bg-app-surface-2 px-2.5 py-1.5 hover:bg-app-surface-3', typeStyle({ role: 'control' }))}
                      onClick={() => { void retry() }}
                    >
                      <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                      Retry
                    </button>
                  </div>
                </div>
              ) : (
                <SettingsContent
                  activeTab={activeTab}
                  version={version}
                  update={update}
                  settings={settings}
                  updateSection={updateSection}
                  onNavigate={setActiveTab}
                />
              )}
            </main>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function SettingsContent({ activeTab, version, update, settings, updateSection, onNavigate }: {
  activeTab: SettingsTabValue
  version: string
  update: ReturnType<typeof useUpdate>
  settings: ReturnType<typeof useSettings>['settings']
  updateSection: ReturnType<typeof useSettings>['updateSection']
  onNavigate: (tab: SettingsTabValue) => void
}) {
  if (activeTab === 'general') return <GeneralSettings />
  if (activeTab === 'appearance') return <AppearanceSettings />
  if (activeTab === 'worktrees') return <WorktreesSettings settings={settings.worktrees} onChange={(next) => updateSection('worktrees', next)} />
  if (activeTab === 'environments') return <LiveEnvironmentsSettings />
  if (activeTab === 'tools') return <ToolsSettingsPane onNavigate={onNavigate} />
  if (activeTab === 'apps') return <CodexResourcesSection />
  if (activeTab === 'updates') return <UpdatesSettings update={update} settings={settings} updateSection={updateSection} />
  if (activeTab === 'diagnostics') return <DiagnosticsSection />
  if (activeTab === 'shortcuts') return <ShortcutsSettings />
  return <AboutSettings version={version} />
}

function LiveEnvironmentsSettings() {
  const tasks = useTasks()
  const { activeProjectId, refresh: refreshProjects } = useRepos()
  const [projectId, setProjectId] = useState(activeProjectId)
  const [records, setRecords] = useState<EnvironmentRecord[]>([])
  const [pendingDelete, setPendingDelete] = useState<{ id: string; name: string } | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const load = useCallback(async (target = projectId) => {
    if (!target) { setRecords([]); return }
    setRecords((await window.cranberri.environments.list(target)).environments)
  }, [projectId])

  useEffect(() => { void load().catch((error) => toast.error(error instanceof Error ? error.message : 'Failed to load environments')) }, [load])

  const save = async (environmentId: string, profile: EnvironmentProfile) => {
    if (!projectId) return
    await window.cranberri.environments.save({ projectId, environmentId, profile })
    await load()
    toast.success('Environment saved')
  }

  return <>
    <EnvironmentsSettings
    projects={tasks.projects}
    activeProjectId={projectId}
    environments={records.map((record) => ({
      id: record.manifest.environmentId,
      projectId: record.manifest.projectId,
      revision: record.manifest.currentRevision,
      trustedRevision: record.manifest.trustedRevision,
      profile: record.profile,
    }))}
    onProjectChange={setProjectId}
    onCreate={() => {
      const environmentId = `environment-${Date.now()}`
      void save(environmentId, { version: 1, name: 'Local setup', setup: { script: 'npm install', platform: {} }, inherit: [], actions: [] })
    }}
    onUpdate={(item, profile) => { void save(item.id, profile).catch((error) => toast.error(error instanceof Error ? error.message : 'Failed to save environment')) }}
    onTrust={(item) => {
      if (!projectId) return
      void window.cranberri.environments.trust(projectId, item.id, item.revision).then(() => load()).then(() => toast.success('Environment trusted')).catch((error) => toast.error(error instanceof Error ? error.message : 'Failed to trust environment'))
    }}
    onTest={(item) => {
      if (!projectId) return
      void window.cranberri.environments.startTest({ projectId, environmentId: item.id, revision: item.revision }).then(() => toast.success('Environment test started')).catch((error) => toast.error(error instanceof Error ? error.message : 'Environment test failed'))
    }}
    onDelete={(item) => {
      if (!projectId) return
      setDeleteError(null)
      setPendingDelete({ id: item.id, name: item.profile.name })
    }}
    onSetDefault={(environmentId) => {
      if (!projectId) return
      void window.cranberri.environments.setDefault(projectId, environmentId).then(async () => {
        await Promise.all([tasks.refresh(), refreshProjects()])
        toast.success(environmentId ? 'Default environment updated' : 'Default environment cleared')
      }).catch((error) => toast.error(error instanceof Error ? error.message : 'Failed to update default environment'))
    }}
    />
    {pendingDelete && <ConfirmDialog
      title="Delete environment?"
      description={`${pendingDelete.name} will be removed from this project.`}
      confirmLabel="Delete"
      busy={deleting}
      busyLabel="Deleting"
      danger
      error={deleteError}
      onCancel={() => { setPendingDelete(null); setDeleteError(null) }}
      onConfirm={() => {
        if (!projectId || deleting) return
        setDeleting(true)
        setDeleteError(null)
        void window.cranberri.environments.delete(projectId, pendingDelete.id)
          .then(() => load())
          .then(() => {
            setPendingDelete(null)
            toast.success('Environment deleted')
          })
          .catch((error) => {
            console.error('Failed to delete environment:', error)
            setDeleteError('Environment could not be deleted. Try again.')
          })
          .finally(() => setDeleting(false))
      }}
    />}
  </>
}

function SidebarButton({ active, value, icon: Icon, label, onClick }: {
  active: boolean
  value: SettingsTabValue
  icon: React.ElementType
  label: string
  onClick: (value: SettingsTabValue) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onClick(value)}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'mb-0.5 flex h-9 w-full items-center gap-2 rounded-md px-3 text-left transition-colors duration-fast ease-standard',
        typeStyle({ role: 'control', tone: active ? 'primary' : 'secondary' }),
        active
          ? 'bg-app-surface-2/85 shadow-sm'
          : 'hover:bg-app-surface-2/50 hover:text-app-text',
      )}
    >
      <Icon className="h-4 w-4" />
      {label}
    </button>
  )
}

function ShortcutsSettings() {
  return (
    <SettingsPage title="Shortcuts" description="Keyboard commands available throughout Cranberri.">
      <SettingsList>
        <ShortcutRow label="Open settings" keys={['⌘', ',']} />
        <ShortcutRow label="Open command menu" keys={['⌘', 'K']} />
        <ShortcutRow label="Send message" keys={['Enter']} />
        <ShortcutRow label="New line in composer" keys={['Shift', 'Enter']} />
        <ShortcutRow label="Find in terminal" keys={['⌘', 'F']} />
        <ShortcutRow label="Commit changes" keys={['⌘', 'Enter']} />
      </SettingsList>
    </SettingsPage>
  )
}

function ShortcutRow({ label, keys }: { label: string; keys: string[] }) {
  return (
    <SettingsRow label={label}>
      <div className="flex items-center gap-1">
        {keys.map((key) => <kbd key={key} className={cn('min-w-6 rounded bg-app-bg px-1.5 py-0.5 text-center ring-1 ring-app-border/70', typeStyle({ role: 'metadata', tone: 'secondary', family: 'mono' }))}>{key}</kbd>)}
      </div>
    </SettingsRow>
  )
}

function AboutSettings({ version }: { version: string }) {
  return (
    <SettingsPage title="About" description="Cranberri is a private, chat-first workspace for local repo work.">
      <SettingsList>
        <SettingsRow label="Version"><span className={typeStyle({ role: 'body', tone: 'primary' })}>{version}</span></SettingsRow>
        <SettingsRow label="Data" description="Repos, settings, and task history stay on this Mac."><span className={typeStyle({ role: 'status', tone: 'secondary' })}>Local</span></SettingsRow>
      </SettingsList>
    </SettingsPage>
  )
}
