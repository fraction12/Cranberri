import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { WorktreesSettings } from './WorktreesSettings'

describe('WorktreesSettings', () => {
  it('renders the global root, retention, and cap controls with bounded inputs', () => {
    const html = renderToStaticMarkup(<WorktreesSettings settings={{ root: '/tmp/worktrees', retentionDays: 7, cap: 15 }} onChange={() => undefined} />)
    expect(html).toContain('/tmp/worktrees')
    expect(html).toContain('min="1" max="90"')
    expect(html).toContain('min="1" max="15"')
    expect(html).not.toContain('<hr')
  })
})
