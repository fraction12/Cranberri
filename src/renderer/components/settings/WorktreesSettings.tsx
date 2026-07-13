import { FolderOpen } from 'lucide-react'
import type { AppSettings } from '@/shared/settings'
import { MANAGED_WORKTREE_CAP_RANGE } from '@/shared/settings'
import { compactFieldStyle } from '../../lib/ui'
import { SettingsList, SettingsPage, SettingsRow } from './settings-page'
import { IconButton } from '../ui/IconButton'

export function WorktreesSettings({ settings, onChange }: { settings: AppSettings['worktrees']; onChange: (next: Partial<AppSettings['worktrees']>) => void | Promise<void> }) {
  return <SettingsPage title="Worktrees" description="Choose where Cranberri creates isolated task checkouts."><SettingsList>
    <SettingsRow label="Location" description="Cranberri-managed worktrees only."><div className="flex items-center gap-1"><input aria-label="Worktree location" className={`${compactFieldStyle} w-64`} value={settings.root} onChange={(event) => onChange({ root: event.target.value })} /><IconButton type="button" disabled label="Choose worktree location"><FolderOpen className="h-3.5 w-3.5" /></IconButton></div></SettingsRow>
    <SettingsRow label="Maximum worktrees" description="Limits physical Cranberri-managed checkouts. Archived sessions do not count."><NumberField label="Maximum worktrees" value={settings.cap} min={MANAGED_WORKTREE_CAP_RANGE.min} max={MANAGED_WORKTREE_CAP_RANGE.max} onChange={(cap) => onChange({ cap })} /></SettingsRow>
  </SettingsList></SettingsPage>
}
function NumberField({ label, value, min, max, suffix, onChange }: { label: string; value: number; min: number; max: number; suffix?: string; onChange: (value: number) => void | Promise<void> }) { return <label className="flex items-center gap-2"><input aria-label={label} type="number" className={`${compactFieldStyle} w-20`} value={value} min={min} max={max} onChange={(event) => onChange(Math.min(max, Math.max(min, Number(event.target.value))))} />{suffix && <span>{suffix}</span>}</label> }
