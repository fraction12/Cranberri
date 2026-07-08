import type { BrowserPageState, BrowserScreenshot, BrowserSnapshot } from '@/shared/browser'

export interface LatestBrowserScreenshotContext {
  screenshot: BrowserScreenshot
  pageState: Pick<BrowserPageState, 'title' | 'url'>
}

export const BROWSER_SNAPSHOT_CONTEXT_CAPTURED_EVENT = 'cranberri:browser-snapshot-context-captured'
export const BROWSER_SCREENSHOT_CONTEXT_CAPTURED_EVENT = 'cranberri:browser-screenshot-context-captured'

export function createBrowserSnapshotContextCapturedEvent(snapshot: BrowserSnapshot): CustomEvent<BrowserSnapshot> {
  return new CustomEvent(BROWSER_SNAPSHOT_CONTEXT_CAPTURED_EVENT, { detail: snapshot })
}

export function browserSnapshotContextFromEvent(event: Event): BrowserSnapshot | null {
  if (!(event instanceof CustomEvent)) return null
  const detail = event.detail as Partial<BrowserSnapshot> | null | undefined
  if (!detail || typeof detail.windowId !== 'string' || typeof detail.url !== 'string' || typeof detail.text !== 'string') {
    return null
  }
  return detail as BrowserSnapshot
}

export function createBrowserScreenshotContextCapturedEvent(capture: LatestBrowserScreenshotContext): CustomEvent<LatestBrowserScreenshotContext> {
  return new CustomEvent(BROWSER_SCREENSHOT_CONTEXT_CAPTURED_EVENT, { detail: capture })
}

export function browserScreenshotContextFromEvent(event: Event): LatestBrowserScreenshotContext | null {
  if (!(event instanceof CustomEvent)) return null
  const detail = event.detail as Partial<LatestBrowserScreenshotContext> | null | undefined
  if (!detail?.screenshot || typeof detail.screenshot.windowId !== 'string' || typeof detail.screenshot.path !== 'string') {
    return null
  }
  if (!detail.pageState || typeof detail.pageState.title !== 'string' || typeof detail.pageState.url !== 'string') {
    return null
  }
  return detail as LatestBrowserScreenshotContext
}
