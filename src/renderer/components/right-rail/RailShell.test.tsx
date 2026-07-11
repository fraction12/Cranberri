import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { RightRailTabs } from './RailShell'

describe('RightRailTabs', () => {
  it('renders Agents as a first-class tab with the current agent count', () => {
    const html = renderToStaticMarkup(
      <RightRailTabs activeTab="agents" agentCount={2} onSelectTab={vi.fn()} />,
    )

    expect(html).toContain('role="tablist"')
    expect(html).toContain('aria-label="Right rail"')
    expect(html).toContain('aria-selected="true"')
    expect(html).toContain('Agents')
    expect(html).toContain('>2<')
  })
})
