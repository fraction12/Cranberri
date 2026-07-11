import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { TaskTargetSelector } from './TaskTargetSelector'
import { EnvironmentSelector } from './EnvironmentSelector'
import { TaskSetupStatus } from './TaskSetupStatus'
import { BranchSelector } from './BranchSelector'

describe('task target controls', () => {
  it('presents Worktree as the compact default target', () => {
    const html = renderToStaticMarkup(<TaskTargetSelector value="worktree" onChange={() => undefined} />)
    expect(html).toContain('Task location: Worktree')
    expect(html).toContain('Worktree')
  })

  it('keeps No environment reachable when no profile is usable', () => {
    const html = renderToStaticMarkup(<EnvironmentSelector value={null} options={[]} onChange={() => undefined} />)
    expect(html).toContain('Environment: No environment')
  })

  it('only renders the Local change option when eligible', () => {
    const eligible = renderToStaticMarkup(<BranchSelector value="HEAD" options={[{ ref: 'HEAD', label: 'main' }]} includeLocalEligible onChange={() => undefined} />)
    const ineligible = renderToStaticMarkup(<BranchSelector value="main" options={[{ ref: 'main', label: 'main' }]} onChange={() => undefined} />)
    expect(eligible).toContain('Base branch: main')
    expect(ineligible).not.toContain('Include Local changes')
  })

  it('uses concise setup and recovery states', () => {
    expect(renderToStaticMarkup(<TaskSetupStatus phase="creating" />)).toContain('Creating worktree...')
    const failed = renderToStaticMarkup(<TaskSetupStatus phase="setupFailed" onRetry={() => undefined} onInspect={() => undefined} />)
    expect(failed).toContain('Environment setup failed')
    expect(failed).toContain('View setup logs')
    expect(failed).not.toContain('SHA')
  })
})
