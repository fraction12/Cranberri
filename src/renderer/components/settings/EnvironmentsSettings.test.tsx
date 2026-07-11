import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { EnvironmentsSettings, type EnvironmentSettingsItem } from './EnvironmentsSettings'
import type { Project } from '@/shared/projects'

const project: Project = { id: 'p1', name: 'Cranberri', gitCommonDir: '/repo/.git', localCheckoutId: 'c1', pinnedLocalBranch: 'main', defaultEnvironmentId: 'env1', controlTaskId: 'control', localLeaseTaskId: null }
const environment: EnvironmentSettingsItem = { id: 'env1', projectId: 'p1', revision: 'new', trustedRevision: null, profile: { version: 1, name: 'Local setup', setup: { script: 'npm install', platform: {} }, inherit: [], actions: [] } }

describe('EnvironmentsSettings', () => {
  it('shows an empty project state without claiming unavailable functionality', () => {
    const html = renderToStaticMarkup(<EnvironmentsSettings />)
    expect(html).toContain('No project selected')
    expect(html).not.toContain('unavailable')
  })

  it('shows default, trust, editor, test, delete, and advanced controls', () => {
    const html = renderToStaticMarkup(<EnvironmentsSettings projects={[project]} activeProjectId="p1" environments={[environment]} />)
    expect(html).toContain('Default environment')
    expect(html).toContain('Needs review')
    expect(html).toContain('Setup script')
    expect(html).toContain('Test Local setup')
    expect(html).toContain('Delete Local setup')
    expect(html).toContain('Advanced')
    expect(html).not.toContain('<hr')
  })
})
