import { describe, expect, it } from 'vitest'
import type { BrowserSnapshot } from '@/shared/browser'
import {
  browserScreenshotContextFromEvent,
  browserSnapshotContextFromEvent,
  BROWSER_SCREENSHOT_CONTEXT_CAPTURED_EVENT,
  BROWSER_SNAPSHOT_CONTEXT_CAPTURED_EVENT,
  createBrowserScreenshotContextCapturedEvent,
  createBrowserSnapshotContextCapturedEvent,
  type LatestBrowserScreenshotContext,
} from './browser-context-events'

const snapshot: BrowserSnapshot = {
  windowId: 'browser-1',
  url: 'https://example.test',
  title: 'Example',
  viewport: { width: 800, height: 600 },
  text: 'Browser page context body',
}

const screenshot: LatestBrowserScreenshotContext = {
  screenshot: {
    windowId: 'browser-1',
    dataUrl: 'data:image/png;base64,abc',
    width: 800,
    height: 600,
    path: '/tmp/browser.png',
  },
  pageState: {
    title: 'Example',
    url: 'https://example.test',
  },
}

describe('browser context events', () => {
  it('round-trips captured browser page snapshots', () => {
    const event = createBrowserSnapshotContextCapturedEvent(snapshot)

    expect(event.type).toBe(BROWSER_SNAPSHOT_CONTEXT_CAPTURED_EVENT)
    expect(browserSnapshotContextFromEvent(event)).toEqual(snapshot)
  })

  it('round-trips captured browser screenshots', () => {
    const event = createBrowserScreenshotContextCapturedEvent(screenshot)

    expect(event.type).toBe(BROWSER_SCREENSHOT_CONTEXT_CAPTURED_EVENT)
    expect(browserScreenshotContextFromEvent(event)).toEqual(screenshot)
  })

  it('ignores malformed browser context events', () => {
    expect(browserSnapshotContextFromEvent(new Event(BROWSER_SNAPSHOT_CONTEXT_CAPTURED_EVENT))).toBeNull()
    expect(browserSnapshotContextFromEvent(new CustomEvent(BROWSER_SNAPSHOT_CONTEXT_CAPTURED_EVENT, { detail: {} }))).toBeNull()
    expect(browserScreenshotContextFromEvent(new Event(BROWSER_SCREENSHOT_CONTEXT_CAPTURED_EVENT))).toBeNull()
    expect(browserScreenshotContextFromEvent(new CustomEvent(BROWSER_SCREENSHOT_CONTEXT_CAPTURED_EVENT, { detail: {} }))).toBeNull()
  })
})
