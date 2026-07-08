import { describe, expect, it } from 'vitest'
import { browserInspectionChatContext, browserScreenshotChatContext, browserSnapshotChatContext } from './browser-chat-context'
import type { BrowserElementInspection, BrowserScreenshot, BrowserSnapshot } from '@/shared/browser'

const SNAPSHOT: BrowserSnapshot = {
  windowId: 'browser-1',
  url: 'http://localhost:5173/',
  title: 'Preview',
  viewport: { width: 1024, height: 768 },
  text: 'Hello from the visible page',
}

const INSPECTION: BrowserElementInspection = {
  windowId: 'browser-1',
  url: 'http://localhost:5173/',
  title: 'Preview',
  selector: 'main h1',
  tagName: 'H1',
  text: 'Welcome',
  rect: { x: 12.2, y: 20.8, width: 300.4, height: 42.1 },
  styles: {
    display: 'block',
    fontFamily: 'Inter',
    fontSize: '24px',
    fontWeight: '700',
    color: 'rgb(255, 255, 255)',
    backgroundColor: 'rgba(0, 0, 0, 0)',
    margin: '0px',
    padding: '0px',
    borderRadius: '0px',
  },
  attributes: { id: 'hero-title', class: 'title' },
}

const SCREENSHOT: BrowserScreenshot = {
  windowId: 'browser-1',
  dataUrl: 'data:image/png;base64,abc123',
  width: 1024,
  height: 768,
  path: '/tmp/cranberri/browser-captures/browser-1.png',
}

describe('browser chat context', () => {
  it('formats page snapshots as bounded chat context', () => {
    expect(browserSnapshotChatContext(SNAPSHOT)).toContain('Browser page context:')
    expect(browserSnapshotChatContext(SNAPSHOT)).toContain('URL: http://localhost:5173/')
    expect(browserSnapshotChatContext({ ...SNAPSHOT, text: 'x'.repeat(13000) })).toContain('Browser context truncated')
  })

  it('formats element inspections with selector, styles, and text', () => {
    const context = browserInspectionChatContext(INSPECTION)

    expect(context).toContain('Browser element context:')
    expect(context).toContain('Element: H1 (main h1)')
    expect(context).toContain('font=24px/700')
    expect(context).toContain('Welcome')
  })

  it('formats screenshot captures as visual chat context', () => {
    const context = browserScreenshotChatContext(SCREENSHOT, { title: 'Preview', url: 'http://localhost:5173/' })

    expect(context).toContain('Browser screenshot context:')
    expect(context).toContain('Image: 1024x768')
    expect(context).toContain('Local image: /tmp/cranberri/browser-captures/browser-1.png')
  })
})
