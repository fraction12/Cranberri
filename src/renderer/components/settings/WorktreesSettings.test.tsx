import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { WorktreesSettings } from './WorktreesSettings'

describe('WorktreesSettings', () => {
  it('renders the global root and physical checkout cap without legacy retention controls', () => {
    const html = renderToStaticMarkup(<WorktreesSettings settings={{ root: '/tmp/worktrees', retentionDays: 7, cap: 15 }} onChange={() => undefined} />)
    expect(html).toContain('/tmp/worktrees')
    expect(html).toContain('min="1" max="15"')
    expect(html).not.toContain('Retention days')
    expect(html).not.toContain('Keep inactive worktrees')
    expect(html).not.toContain('<hr')
  })
})
