export const OPEN_TERMINAL_LINK_BROWSER_EVENT = 'cranberri:open-terminal-link-browser'

export interface TerminalLinkBrowserEventDetail {
  url: string
  windowId: string
  title: string
}

const LOCAL_BROWSER_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]'])

function stableBrowserWindowId(url: URL): string {
  const port = url.port || (url.protocol === 'https:' ? '443' : '80')
  return `browser-terminal-${url.protocol.replace(':', '')}-${url.hostname.replace(/[^a-zA-Z0-9_.-]+/g, '-')}-${port}`
}

export function terminalLocalBrowserUrl(rawUrl: string): string | null {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  if (!LOCAL_BROWSER_HOSTS.has(url.hostname)) return null
  if (url.hostname === '0.0.0.0') url.hostname = 'localhost'
  return url.toString()
}

export function createOpenTerminalLinkBrowserEvent(rawUrl: string): CustomEvent<TerminalLinkBrowserEventDetail> | null {
  const browserUrl = terminalLocalBrowserUrl(rawUrl)
  if (!browserUrl) return null
  const url = new URL(browserUrl)
  return new CustomEvent(OPEN_TERMINAL_LINK_BROWSER_EVENT, {
    detail: {
      url: browserUrl,
      windowId: stableBrowserWindowId(url),
      title: `${url.hostname}${url.port ? `:${url.port}` : ''}`,
    },
  })
}

export function terminalLinkBrowserDetailFromEvent(event: Event): TerminalLinkBrowserEventDetail | null {
  const detail = (event as CustomEvent<Partial<TerminalLinkBrowserEventDetail>>).detail
  if (!detail?.url || !detail.windowId || !detail.title) return null
  return detail as TerminalLinkBrowserEventDetail
}
