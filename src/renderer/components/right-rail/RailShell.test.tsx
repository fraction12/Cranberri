import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { BottomPanelContent, RightRailTabs } from './RailShell'

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
    expect(html).toContain('type-control')
    expect(html).toContain('type-micro')
  })

  it('uses the shared panel and empty-state roles', () => {
    const html = renderToStaticMarkup(
      <BottomPanelContent bottomPanel="issue" repoPath={null} onOpenToolsSettings={vi.fn()} />,
    )

    expect(html).toContain('type-panel-title')
    expect(html).toContain('type-body')
    expect(html).toContain('text-app-text-secondary')
  })
})
