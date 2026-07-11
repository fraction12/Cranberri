import { FolderOpen } from 'lucide-react'
import type { AppSettings } from '@/shared/settings'
import { MANAGED_WORKTREE_CAP_RANGE, WORKTREE_RETENTION_DAYS_RANGE } from '@/shared/settings'
import { compactFieldStyle, iconButton } from '../../lib/ui'
import { SettingsList, SettingsPage, SettingsRow } from './settings-page'

export function WorktreesSettings({ settings, onChange }: { settings: AppSettings['worktrees']; onChange: (next: Partial<AppSettings['worktrees']>) => void | Promise<void> }) {
  return <SettingsPage title="Worktrees" description="Where isolated tasks live and how long inactive checkouts are kept."><SettingsList>
    <SettingsRow label="Location" description="Cranberri-managed worktrees only."><div className="flex items-center gap-1"><input aria-label="Worktree location" className={`${compactFieldStyle} w-64`} value={settings.root} onChange={(event) => onChange({ root: event.target.value })} /><button type="button" disabled className={iconButton()} aria-label="Choose worktree location" title="Choose worktree location"><FolderOpen className="h-3.5 w-3.5" /></button></div></SettingsRow>
    <SettingsRow label="Keep inactive worktrees" description="Eligible archived worktrees are moved to Trash after this period."><NumberField label="Retention days" value={settings.retentionDays} min={WORKTREE_RETENTION_DAYS_RANGE.min} max={WORKTREE_RETENTION_DAYS_RANGE.max} onChange={(retentionDays) => onChange({ retentionDays })} suffix="days" /></SettingsRow>
    <SettingsRow label="Maximum worktrees" description="Protected or active worktrees never count as disposable."><NumberField label="Maximum worktrees" value={settings.cap} min={MANAGED_WORKTREE_CAP_RANGE.min} max={MANAGED_WORKTREE_CAP_RANGE.max} onChange={(cap) => onChange({ cap })} /></SettingsRow>
  </SettingsList></SettingsPage>
}
function NumberField({ label, value, min, max, suffix, onChange }: { label: string; value: number; min: number; max: number; suffix?: string; onChange: (value: number) => void | Promise<void> }) { return <label className="flex items-center gap-2"><input aria-label={label} type="number" className={`${compactFieldStyle} w-20`} value={value} min={min} max={max} onChange={(event) => onChange(Math.min(max, Math.max(min, Number(event.target.value))))} />{suffix && <span>{suffix}</span>}</label> }
