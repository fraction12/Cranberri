import type { BrowserElementInspection, BrowserScreenshot, BrowserSnapshot } from '@/shared/browser'

const MAX_BROWSER_CONTEXT_CHARS = 12000

function trimmed(value: string): string {
  return value.trim()
}

function boundedText(value: string, maxChars = MAX_BROWSER_CONTEXT_CHARS): string {
  const text = trimmed(value)
  if (text.length <= maxChars) return text
  return `${text.slice(0, maxChars).trimEnd()}\n\n[Browser context truncated: ${text.length - maxChars} chars omitted]`
}

export function browserSnapshotChatContext(snapshot: BrowserSnapshot): string {
  const title = trimmed(snapshot.title) || 'Untitled page'
  const bodyText = boundedText(snapshot.text) || '[No visible text captured]'
  return [
    'Browser page context:',
    `Title: ${title}`,
    `URL: ${snapshot.url}`,
    `Viewport: ${snapshot.viewport.width}x${snapshot.viewport.height}`,
    '',
    'Visible page text:',
    bodyText,
  ].join('\n')
}

export function browserInspectionChatContext(inspection: BrowserElementInspection): string {
  const selector = trimmed(inspection.selector) || inspection.tagName
  const elementText = boundedText(inspection.text, 4000) || '[No element text captured]'
  const attrs = Object.entries(inspection.attributes)
    .slice(0, 12)
    .map(([key, value]) => `${key}="${value}"`)
    .join(' ')
  return [
    'Browser element context:',
    `Title: ${trimmed(inspection.title) || 'Untitled page'}`,
    `URL: ${inspection.url}`,
    `Element: ${inspection.tagName}${selector ? ` (${selector})` : ''}`,
    `Rect: ${Math.round(inspection.rect.width)}x${Math.round(inspection.rect.height)} at ${Math.round(inspection.rect.x)},${Math.round(inspection.rect.y)}`,
    attrs ? `Attributes: ${attrs}` : null,
    `Styles: display=${inspection.styles.display}; font=${inspection.styles.fontSize}/${inspection.styles.fontWeight}; color=${inspection.styles.color}; background=${inspection.styles.backgroundColor}`,
    '',
    'Element text:',
    elementText,
  ].filter((line): line is string => line !== null).join('\n')
}

export function browserScreenshotChatContext(screenshot: BrowserScreenshot, page: { title: string; url: string }): string {
  return [
    'Browser screenshot context:',
    `Title: ${trimmed(page.title) || 'Untitled page'}`,
    `URL: ${page.url}`,
    `Image: ${screenshot.width}x${screenshot.height}`,
    screenshot.path ? `Local image: ${screenshot.path}` : null,
    '',
    'Use the attached screenshot as visual context for this page.',
  ].filter((line): line is string => line !== null).join('\n')
}
