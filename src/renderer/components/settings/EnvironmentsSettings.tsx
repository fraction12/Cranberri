import { CheckCircle2, FlaskConical, Plus, ShieldAlert, Trash2 } from 'lucide-react'
import type { EnvironmentProfile } from '@/shared/environments'
import type { Project } from '@/shared/projects'
import { buttonStyle, cn, compactFieldStyle, iconButton } from '../../lib/ui'
import { typeStyle } from '../../lib/typography'
import { SettingsDisclosure, SettingsList, SettingsPage, SettingsRow } from './settings-page'

export interface EnvironmentSettingsItem { id: string; projectId: string; profile: EnvironmentProfile; revision: string; trustedRevision: string | null }
export function EnvironmentsSettings({ projects = [], activeProjectId, environments = [], onProjectChange, onCreate, onUpdate, onTrust, onTest, onDelete, onSetDefault }: {
  projects?: readonly Project[]; activeProjectId?: string | null; environments?: readonly EnvironmentSettingsItem[]; onProjectChange?: (id: string) => void; onCreate?: () => void; onUpdate?: (item: EnvironmentSettingsItem, profile: EnvironmentProfile) => void; onTrust?: (item: EnvironmentSettingsItem) => void; onTest?: (item: EnvironmentSettingsItem) => void; onDelete?: (item: EnvironmentSettingsItem) => void; onSetDefault?: (id: string | null) => void
}) {
  const project = projects.find((item) => item.id === activeProjectId) ?? projects[0]
  const items = project ? environments.filter((item) => item.projectId === project.id) : []
  return <SettingsPage title="Environments" description="Reusable setup for isolated tasks." actions={<button type="button" disabled={!project} className={buttonStyle({ tone: 'secondary', size: 'compact' })} onClick={onCreate}><Plus className="h-3.5 w-3.5" />Add</button>}>
    {projects.length > 1 && <label className="block"><span className={typeStyle({ role: 'label', tone: 'secondary' })}>Project</span><select aria-label="Environment project" className={cn(compactFieldStyle, 'mt-1 w-full')} value={project?.id ?? ''} onChange={(event) => onProjectChange?.(event.target.value)}>{projects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
    {!project ? <EmptyState title="No project selected" detail="Add a project to create an environment." /> : <>
      <SettingsList><SettingsRow label="Default environment"><select aria-label="Default environment" className={compactFieldStyle} value={project.defaultEnvironmentId ?? ''} onChange={(event) => onSetDefault?.(event.target.value || null)}><option value="">No environment</option>{items.map((item) => <option key={item.id} value={item.id}>{item.profile.name}</option>)}</select></SettingsRow></SettingsList>
      {items.length === 0 ? <EmptyState title="No environments" detail="Add a profile when this project needs setup before Codex starts." /> : <div className="space-y-2">{items.map((item) => <EnvironmentEditor key={item.id} item={item} onUpdate={onUpdate} onTrust={onTrust} onTest={onTest} onDelete={onDelete} />)}</div>}
    </>}
  </SettingsPage>
}
function EmptyState({ title, detail }: { title: string; detail: string }) { return <div className="rounded-md bg-app-bg/60 px-4 py-8 text-center"><p className={typeStyle({ role: 'body', tone: 'primary' })}>{title}</p><p className={cn('mx-auto mt-1 max-w-sm', typeStyle({ role: 'metadata', tone: 'secondary' }))}>{detail}</p></div> }
function EnvironmentEditor({ item, onUpdate, onTrust, onTest, onDelete }: { item: EnvironmentSettingsItem; onUpdate?: (item: EnvironmentSettingsItem, profile: EnvironmentProfile) => void; onTrust?: (item: EnvironmentSettingsItem) => void; onTest?: (item: EnvironmentSettingsItem) => void; onDelete?: (item: EnvironmentSettingsItem) => void }) {
  const trusted = item.revision === item.trustedRevision
  return <div className="rounded-md bg-app-bg/55 p-3"><div className="flex items-center gap-2"><div className="min-w-0 flex-1"><input aria-label="Environment name" className={cn(compactFieldStyle, 'w-full')} value={item.profile.name} onChange={(event) => onUpdate?.(item, { ...item.profile, name: event.target.value })} /><span className={cn('mt-1 flex items-center gap-1', typeStyle({ role: 'metadata', tone: trusted ? 'success' : 'warning' }))}>{trusted ? <CheckCircle2 className="h-3 w-3" /> : <ShieldAlert className="h-3 w-3" />}{trusted ? 'Trusted' : 'Needs review'}</span></div><button type="button" className={iconButton()} aria-label={`Test ${item.profile.name}`} title="Test environment" onClick={() => onTest?.(item)}><FlaskConical className="h-3.5 w-3.5" /></button><button type="button" className={iconButton({ tone: 'danger' })} aria-label={`Delete ${item.profile.name}`} title="Delete environment" onClick={() => onDelete?.(item)}><Trash2 className="h-3.5 w-3.5" /></button></div>
    <label className="mt-3 block"><span className={typeStyle({ role: 'label', tone: 'secondary' })}>Setup</span><textarea aria-label="Setup script" className={cn(compactFieldStyle, typeStyle({ role: 'code', family: 'mono' }), 'mt-1 h-24 w-full resize-y py-2')} value={item.profile.setup.script} onChange={(event) => onUpdate?.(item, { ...item.profile, setup: { ...item.profile.setup, script: event.target.value } })} /></label>
    <SettingsDisclosure title="Advanced" description={`${item.profile.inherit.length} variables · ${item.profile.actions.length} actions`}><p className={typeStyle({ role: 'metadata', tone: 'secondary' })}>Platform overrides, inherited variable names, and actions are stored in this profile.</p></SettingsDisclosure>
    {!trusted && <button type="button" className={cn(buttonStyle({ tone: 'primary', size: 'compact' }), 'mt-2')} onClick={() => onTrust?.(item)}>Review and trust</button>}
  </div>
}
