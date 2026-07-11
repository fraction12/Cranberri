import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { BottomPanelContent, RightRailTabs } from './RailShell'

describe('RightRailTabs', () => {
  it('renders icon-only tabs with accessible labels and the current agent count', () => {
    const html = renderToStaticMarkup(
      <RightRailTabs activeTab="agents" agentCount={2} onSelectTab={vi.fn()} />,
    )

    expect(html).toContain('role="tablist"')
    expect(html).toContain('aria-label="Right rail"')
    expect(html).toContain('aria-selected="true"')
    expect(html).toContain('aria-label="Files"')
    expect(html).toContain('aria-label="Diff"')
    expect(html).toContain('aria-label="Agents, 2 active"')
    expect(html).not.toContain('>Files<')
    expect(html).not.toContain('>Diff<')
    expect(html).not.toContain('>Agents<')
    expect(html).not.toContain('>2<')
    expect(html).toContain('type-control')
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
