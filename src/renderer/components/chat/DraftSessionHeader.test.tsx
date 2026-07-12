import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { DraftSessionHeader } from './DraftSessionHeader'

const common = {
  pinnedBranch: 'main',
  baseRef: 'refs/heads/main',
  branches: [{ ref: 'refs/heads/main', label: 'main' }],
  environments: [],
  environmentId: null,
  onBaseRefChange: () => undefined,
  onEnvironmentChange: () => undefined,
  onIncludeLocalChanges: () => undefined,
  onRetry: () => undefined,
}

describe('DraftSessionHeader', () => {
  it('shows a quiet pinned-checkout identity for new Local sessions', () => {
    const html = renderToStaticMarkup(<DraftSessionHeader {...common} target="local" />)
    expect(html).toContain('Local · main')
    expect(html).not.toContain('Base branch:')
  })

  it('keeps worktree configuration in the header instead of the composer', () => {
    const html = renderToStaticMarkup(<DraftSessionHeader {...common} target="worktree" />)
    expect(html).toContain('New worktree setup')
    expect(html).toContain('Base branch: main')
    expect(html).toContain('Environment: No environment')
    expect(html).not.toContain('Task location:')
  })
})
