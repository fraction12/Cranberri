import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { BrowserWindow } from './BrowserWindow'

const browserWindow = {
  id: 'browser-1',
  type: 'browser' as const,
  title: 'Browser',
  browser: {
    url: 'about:blank',
    profileId: 'default',
    viewportMode: 'responsive' as const,
  },
}

describe('BrowserWindow', () => {
  it('labels the address field and uses semantic browser chrome typography', () => {
    const html = renderToStaticMarkup(
      <BrowserWindow
        windowState={browserWindow}
        active={false}
        obscured={false}
        onPageState={vi.fn()}
        onViewportModeChange={vi.fn()}
        onSendToChat={vi.fn()}
      />,
    )

    expect(html).toContain('aria-label="Browser address"')
    expect(html).toContain('type-control')
    expect(html).toContain('type-status')
  })
})
