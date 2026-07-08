import { useEffect, useMemo, useState } from 'react'
import { Activity, CheckCircle2, Copy, ExternalLink, FileText, FolderOpen, RefreshCw, Settings, Trash2 } from 'lucide-react'
import { diagnosticsPathRows, type DiagnosticsPathRow } from './diagnostics-paths'
import type { CranberriDiagnosticsReport, CranberriHealthLevel } from '@/shared/health'
import type { NativeHelperSettingsTarget } from '@/shared/nativeHelpers'

export function DiagnosticsSection() {
  const [report, setReport] = useState<CranberriDiagnosticsReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const refresh = async () => {
    setLoading(true)
    setError(null)
    setNotice(null)
    try {
      setReport(await window.cranberri.health.diagnostics())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to read diagnostics')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  const paths = useMemo(() => {
    if (!report) return []
    return diagnosticsPathRows(report)
  }, [report])

  const clearTelemetry = async () => {
    setNotice(null)
    await window.cranberri.telemetry.clear()
    await refresh()
  }

  const copyPath = async (row: DiagnosticsPathRow) => {
    if (!row.actionable) return
    setError(null)
    try {
      await navigator.clipboard.writeText(row.value)
      setNotice(`Copied ${row.label} path`)
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to copy ${row.label}`)
    }
  }

  const openPath = async (row: DiagnosticsPathRow) => {
    if (!row.actionable) return
    setError(null)
    try {
      await window.cranberri.openPath(row.value)
      setNotice(`Opened ${row.label}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to open ${row.label}`)
    }
  }

  const revealPath = async (row: DiagnosticsPathRow) => {
    if (!row.actionable) return
    setError(null)
    try {
      await window.cranberri.revealPath(row.value)
      setNotice(`Revealed ${row.label}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to reveal ${row.label}`)
    }
  }

  const openHelperSettings = async (target: NativeHelperSettingsTarget, label: string) => {
    setError(null)
    try {
      await window.cranberri.nativeHelpers.openSettings(target)
      setNotice(`Opened ${label} settings`)
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to open ${label} settings`)
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-app-text-muted">
            <Activity className="h-3.5 w-3.5" />
            Diagnostics
          </div>
          <div className="mt-1 text-xs text-app-text-muted">
            {report ? `Checked ${new Date(report.checkedAt).toLocaleTimeString()}` : 'Reading local app diagnostics…'}
          </div>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-lg bg-app-surface-2 px-3 py-2 text-xs font-medium hover:bg-app-surface-2/80 disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-app-danger/30 bg-app-danger/10 p-3 text-xs text-app-danger">{error}</div>
      )}
      {notice && !error && (
        <div className="rounded-lg border border-app-border bg-app-surface-2 p-3 text-xs text-app-text-muted">{notice}</div>
      )}

      {report && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <Metric label="Health" value={report.health.level} level={report.health.level} />
            <Metric label="Packaged" value={report.runtime.packaged ? 'yes' : 'no'} />
            <Metric label="Version" value={report.build.version} />
            <Metric label="Commit" value={report.build.commit.slice(0, 7)} />
            <Metric label="Platform" value={`${report.runtime.platform}/${report.runtime.arch}`} />
            <Metric label="Electron" value={report.runtime.electron} />
          </div>

          <div className="space-y-2">
            <PanelHeader icon={CheckCircle2} label="Checks" />
            <div className="space-y-2">
              {report.health.checks.map((check) => (
                <div key={check.id} className="rounded-lg border border-app-border bg-app-bg p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0 text-sm font-medium">{check.label}</div>
                    <span className={`shrink-0 text-[10px] font-semibold uppercase ${levelClass(check.level)}`}>{check.level}</span>
                  </div>
                  <div className="mt-1 truncate text-xs text-app-text-muted" title={check.detail}>{check.detail}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <PanelHeader icon={FileText} label="Paths" />
            <div className="rounded-lg border border-app-border bg-app-bg">
              {paths.map((row) => (
                <PathRow
                  key={row.label}
                  row={row}
                  onCopy={() => void copyPath(row)}
                  onOpen={() => void openPath(row)}
                  onReveal={() => void revealPath(row)}
                />
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <PanelHeader icon={Activity} label="Native helpers" />
            <div className="space-y-2">
              {report.nativeHelpers.map((helper) => (
                <div key={helper.id} className="rounded-lg border border-app-border bg-app-bg p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0 text-sm font-medium">{helper.label}</div>
                    <div className="flex shrink-0 items-center gap-2">
                      {helper.settingsTarget && (
                        <button
                          type="button"
                          onClick={() => void openHelperSettings(helper.settingsTarget!, helper.label)}
                          className="rounded p-1 text-app-text-muted hover:bg-app-surface-2 hover:text-app-text"
                          aria-label={`Open ${helper.label} settings`}
                        >
                          <Settings className="h-3.5 w-3.5" />
                        </button>
                      )}
                      <span className={`text-[10px] font-semibold uppercase ${availabilityClass(helper.availability)}`}>
                        {helper.availability}
                      </span>
                    </div>
                  </div>
                  <div className="mt-1 truncate text-xs text-app-text-muted" title={helper.detail}>{helper.detail}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <PanelHeader icon={Activity} label="Recent events" />
              <button
                type="button"
                onClick={() => void clearTelemetry()}
                className="inline-flex items-center gap-1.5 rounded bg-app-surface-2 px-2 py-1 text-[11px] text-app-text-muted hover:text-app-text"
              >
                <Trash2 className="h-3 w-3" />
                Clear
              </button>
            </div>
            <div className="max-h-52 overflow-auto rounded-lg border border-app-border bg-app-bg">
              {report.recentEvents.length === 0 ? (
                <div className="p-3 text-xs text-app-text-muted">No local events recorded yet.</div>
              ) : report.recentEvents.map((event) => (
                <div key={event.id} className="border-b border-app-border/70 p-3 last:border-b-0">
                  <div className="flex items-center justify-between gap-3 text-xs">
                    <span className="font-medium">{event.source} / {event.type}</span>
                    <span className="shrink-0 text-app-text-muted">{new Date(event.timestamp).toLocaleTimeString()}</span>
                  </div>
                  <pre className="mt-2 max-h-24 overflow-hidden whitespace-pre-wrap break-words rounded bg-app-surface px-2 py-1.5 font-mono text-[10px] text-app-text-muted">
                    {JSON.stringify(event.payload, null, 2)}
                  </pre>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function Metric({ label, value, level }: { label: string; value: string; level?: CranberriHealthLevel }) {
  return (
    <div className="rounded-lg border border-app-border bg-app-bg p-3">
      <div className="text-[10px] uppercase tracking-wider text-app-text-muted">{label}</div>
      <div className={`mt-1 truncate text-sm font-medium ${level ? levelClass(level) : ''}`} title={value}>{value}</div>
    </div>
  )
}

function PanelHeader({ icon: Icon, label }: { icon: React.ElementType; label: string }) {
  return (
    <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-app-text-muted">
      <Icon className="h-3.5 w-3.5" />
      {label}
    </div>
  )
}

function PathRow({
  row,
  onCopy,
  onOpen,
  onReveal,
}: {
  row: DiagnosticsPathRow
  onCopy: () => void
  onOpen: () => void
  onReveal: () => void
}) {
  return (
    <div className="flex items-center gap-2 border-b border-app-border/70 px-3 py-2 last:border-b-0">
      <div className="w-24 shrink-0 text-xs text-app-text-muted">{row.label}</div>
      <div className="min-w-0 flex-1 truncate font-mono text-[11px]" title={row.value}>{row.value}</div>
      <button
        type="button"
        disabled={!row.actionable}
        onClick={onCopy}
        className="rounded p-1 text-app-text-muted hover:bg-app-surface-2 hover:text-app-text disabled:cursor-not-allowed disabled:opacity-40"
        aria-label={`Copy ${row.label} path`}
      >
        <Copy className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        disabled={!row.actionable}
        onClick={onOpen}
        className="rounded p-1 text-app-text-muted hover:bg-app-surface-2 hover:text-app-text disabled:cursor-not-allowed disabled:opacity-40"
        aria-label={`Open ${row.label} path`}
      >
        <ExternalLink className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        disabled={!row.actionable}
        onClick={onReveal}
        className="rounded p-1 text-app-text-muted hover:bg-app-surface-2 hover:text-app-text disabled:cursor-not-allowed disabled:opacity-40"
        aria-label={`Reveal ${row.label} path`}
      >
        <FolderOpen className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

function levelClass(level: CranberriHealthLevel): string {
  if (level === 'ok') return 'text-app-accent'
  if (level === 'warning') return 'text-app-accent'
  return 'text-app-danger'
}

function availabilityClass(availability: CranberriDiagnosticsReport['nativeHelpers'][number]['availability']): string {
  if (availability === 'available') return 'text-app-accent'
  if (availability === 'disabled' || availability === 'unavailable') return 'text-app-text-muted'
  return 'text-app-danger'
}
