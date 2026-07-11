import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertCircle, CheckCircle2, Copy, ExternalLink, FolderOpen, RefreshCw, Settings, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { diagnosticsPathRows, type DiagnosticsPathRow } from './diagnostics-paths'
import { SettingsDisclosure, SettingsPage, SettingsSection } from './settings/settings-page'
import type { CranberriDiagnosticsReport, CranberriHealthLevel } from '@/shared/health'
import type { NativeHelperSettingsTarget } from '@/shared/nativeHelpers'

export function DiagnosticsSection() {
  const [report, setReport] = useState<CranberriDiagnosticsReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  const refresh = useCallback(async (notify = false) => {
    setLoading(true)
    setLoadError(null)
    try {
      setReport(await window.cranberri.health.diagnostics())
      if (notify) toast.success('Diagnostics refreshed')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not read diagnostics'
      if (notify) toast.error(message)
      else setLoadError(message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const paths = useMemo(() => report ? diagnosticsPathRows(report) : [], [report])
  const systemChecks = report?.health.checks.filter((check) => !check.id.startsWith('native-helper-')) ?? []
  const attentionChecks = systemChecks.filter((check) => check.level !== 'ok')
  const attentionHelpers = report?.nativeHelpers.filter((helper) => helper.availability !== 'available') ?? []
  const attentionCount = attentionChecks.length + attentionHelpers.length
  const passedChecks = systemChecks.filter((check) => check.level === 'ok').length

  const clearTelemetry = async () => {
    try {
      await window.cranberri.telemetry.clear()
      toast.success('Local diagnostics history cleared')
      await refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not clear diagnostics history')
    }
  }

  const runPathAction = async (action: 'copy' | 'open' | 'reveal', row: DiagnosticsPathRow) => {
    if (!row.actionable) return
    try {
      if (action === 'copy') await navigator.clipboard.writeText(row.value)
      else if (action === 'open') await window.cranberri.openPath(row.value)
      else await window.cranberri.revealPath(row.value)
      toast.success(`${action === 'copy' ? 'Copied' : action === 'open' ? 'Opened' : 'Revealed'} ${row.label.toLowerCase()}`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : `Could not ${action} ${row.label.toLowerCase()}`)
    }
  }

  const openHelperSettings = async (target: NativeHelperSettingsTarget, label: string) => {
    try {
      await window.cranberri.nativeHelpers.openSettings(target)
      toast.success(`Opened ${label} settings`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : `Could not open ${label} settings`)
    }
  }

  return (
    <SettingsPage
      title="Diagnostics"
      description={report ? `Checked ${new Date(report.checkedAt).toLocaleTimeString()}` : 'Check Cranberri and its local dependencies.'}
      actions={(
        <button
          type="button"
          onClick={() => void refresh(true)}
          disabled={loading}
          className="flex h-8 w-8 items-center justify-center rounded-md text-app-text-muted hover:bg-app-surface-2 hover:text-app-text disabled:opacity-50"
          aria-label="Refresh diagnostics"
          title="Refresh diagnostics"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      )}
    >
      {loadError && <div role="alert" className="rounded-md bg-app-danger/5 px-3 py-3 text-xs text-app-danger">{loadError}</div>}
      {!report && !loadError && <div className="text-sm text-app-text-muted">Reading diagnostics...</div>}

      {report && (
        <>
          <div className="flex items-start gap-3 rounded-md bg-app-bg px-3 py-3">
            {attentionCount > 0
              ? <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-app-warning" />
              : <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-app-success" />}
            <div className="min-w-0">
              <div className="text-sm font-medium text-app-text">{attentionCount > 0 ? `${attentionCount} item${attentionCount === 1 ? '' : 's'} need attention` : 'Everything looks good'}</div>
              <div className="mt-0.5 text-caption text-app-text-muted">Cranberri {report.build.version} · {report.build.commit.slice(0, 7)} · {report.runtime.platform}/{report.runtime.arch}</div>
            </div>
          </div>

          {attentionCount > 0 && (
            <SettingsSection title="Needs attention">
              <div className="space-y-1">
                {attentionChecks.map((check) => <DiagnosticRow key={check.id} label={check.label} detail={check.detail} status={check.level} />)}
                {attentionHelpers.map((helper) => (
                  <DiagnosticRow
                    key={helper.id}
                    label={helper.label}
                    detail={helper.detail}
                    status={helper.availability}
                    action={helper.settingsTarget ? (
                      <button type="button" onClick={() => void openHelperSettings(helper.settingsTarget!, helper.label)} className="rounded-md p-1.5 text-app-text-muted hover:bg-app-surface-2 hover:text-app-text" aria-label={`Open ${helper.label} settings`} title="Open settings">
                        <Settings className="h-3.5 w-3.5" />
                      </button>
                    ) : undefined}
                  />
                ))}
              </div>
            </SettingsSection>
          )}

          <div className="space-y-3">
            <SettingsDisclosure title="System checks" description={`${passedChecks}/${systemChecks.length} passed`}>
              <div className="space-y-1">
                {systemChecks.map((check) => <DiagnosticRow key={check.id} label={check.label} detail={check.detail} status={check.level} />)}
              </div>
            </SettingsDisclosure>

            <SettingsDisclosure title="Files and logs" description={`${paths.length} locations`}>
              <div className="space-y-1">
                {paths.map((row) => <PathRow key={row.label} row={row} onAction={(action) => void runPathAction(action, row)} />)}
              </div>
            </SettingsDisclosure>

            <SettingsDisclosure title="Recent events" description={`${report.recentEvents.length} local`}>
              <div className="space-y-2">
                <div className="flex justify-end">
                  <button type="button" onClick={() => void clearTelemetry()} className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-caption text-app-text-muted hover:bg-app-surface-2 hover:text-app-text">
                    <Trash2 className="h-3 w-3" /> Clear history
                  </button>
                </div>
                <div className="max-h-52 space-y-1 overflow-auto">
                  {report.recentEvents.length === 0 ? <div className="py-3 text-xs text-app-text-muted">No local events recorded.</div> : report.recentEvents.map((event) => (
                    <div key={event.id} className="rounded-md bg-app-bg px-2 py-2.5">
                      <div className="flex items-center justify-between gap-3 text-xs">
                        <span className="font-medium text-app-text">{event.source} / {event.type}</span>
                        <span className="shrink-0 text-app-text-muted">{new Date(event.timestamp).toLocaleTimeString()}</span>
                      </div>
                      <pre className="mt-1.5 max-h-24 overflow-hidden whitespace-pre-wrap break-words font-mono text-micro text-app-text-muted">{JSON.stringify(event.payload, null, 2)}</pre>
                    </div>
                  ))}
                </div>
              </div>
            </SettingsDisclosure>
          </div>
        </>
      )}
    </SettingsPage>
  )
}

function DiagnosticRow({ label, detail, status, action }: { label: string; detail: string; status: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 rounded-md px-2 py-2.5 hover:bg-app-bg">
      <div className="min-w-0 flex-1">
        <div className="text-sm text-app-text">{label}</div>
        <div className="mt-0.5 truncate text-caption text-app-text-muted" title={detail}>{detail}</div>
      </div>
      {action}
      <span className={`shrink-0 text-micro font-medium capitalize ${statusClass(status)}`}>{friendlyStatus(status)}</span>
    </div>
  )
}

function PathRow({ row, onAction }: { row: DiagnosticsPathRow; onAction: (action: 'copy' | 'open' | 'reveal') => void }) {
  return (
    <div className="flex items-center gap-2 rounded-md px-2 py-2 hover:bg-app-bg">
      <div className="w-20 shrink-0 text-xs text-app-text-muted">{row.label}</div>
      <div className="min-w-0 flex-1 truncate font-mono text-caption text-app-text" title={row.value}>{row.value}</div>
      <PathButton label={`Copy ${row.label}`} disabled={!row.actionable} onClick={() => onAction('copy')} icon={Copy} />
      <PathButton label={`Open ${row.label}`} disabled={!row.actionable} onClick={() => onAction('open')} icon={ExternalLink} />
      <PathButton label={`Reveal ${row.label}`} disabled={!row.actionable} onClick={() => onAction('reveal')} icon={FolderOpen} />
    </div>
  )
}

function PathButton({ label, disabled, onClick, icon: Icon }: { label: string; disabled: boolean; onClick: () => void; icon: React.ElementType }) {
  return (
    <button type="button" disabled={disabled} onClick={onClick} className="rounded-md p-1 text-app-text-muted hover:bg-app-surface-2 hover:text-app-text disabled:opacity-30" aria-label={label} title={label}>
      <Icon className="h-3.5 w-3.5" />
    </button>
  )
}

function statusClass(status: string): string {
  if (status === 'ok' || status === 'available') return 'text-app-success'
  if (status === 'error') return 'text-app-danger'
  return 'text-app-warning'
}

function friendlyStatus(status: string): string {
  if (status === 'ok' || status === 'available') return 'Ready'
  if (status === 'disabled') return 'Permission needed'
  if (status === 'unavailable') return 'Unavailable'
  if (status === 'warning') return 'Attention'
  return 'Failed'
}

export function diagnosticsHealthLabel(level: CranberriHealthLevel): string {
  if (level === 'ok') return 'Ready'
  if (level === 'warning') return 'Needs attention'
  return 'Failed'
}
