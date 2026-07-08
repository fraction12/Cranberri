import type { AgentProcessInfo } from '@/shared/processes'

export const OPEN_PROCESS_BROWSER_EVENT = 'cranberri:open-process-browser'

interface ProcessBrowserEventDetail {
  process: AgentProcessInfo
  url: string
  windowId: string
}

const LOCAL_URL_RE = /\bhttps?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::\d+)?(?:\/[^\s]*)?/i
const HOST_PORT_RE = /\b(?:localhost|127\.0\.0\.1|0\.0\.0\.0):(\d{2,5})\b/i
const PORT_FLAG_RE = /(?:--port|-p)\s+(\d{2,5})\b/i
const PORT_ENV_RE = /\bPORT=(\d{2,5})\b/i

export function processBrowserWindowId(processInfo: Pick<AgentProcessInfo, 'id'>): string {
  return `browser-process-${processInfo.id.replace(/[^a-zA-Z0-9_.-]+/g, '-')}`
}

export function inferProcessBrowserUrl(processInfo: Pick<AgentProcessInfo, 'command' | 'kind'>): string {
  if (processInfo.kind !== 'dev-server') return 'about:blank'
  const command = processInfo.command
  const explicit = command.match(LOCAL_URL_RE)?.[0]
  if (explicit) return explicit.replace('0.0.0.0', 'localhost')
  const hostPort = command.match(HOST_PORT_RE)?.[1]
  if (hostPort) return `http://localhost:${hostPort}`
  const flagPort = command.match(PORT_FLAG_RE)?.[1]
  if (flagPort) return `http://localhost:${flagPort}`
  const envPort = command.match(PORT_ENV_RE)?.[1]
  if (envPort) return `http://localhost:${envPort}`
  if (/vite|electron-vite/i.test(command)) return 'http://localhost:5173'
  if (/next dev/i.test(command)) return 'http://localhost:3000'
  return 'about:blank'
}

export function createOpenProcessBrowserEvent(processInfo: AgentProcessInfo): CustomEvent<ProcessBrowserEventDetail> {
  return new CustomEvent(OPEN_PROCESS_BROWSER_EVENT, {
    detail: {
      process: processInfo,
      url: inferProcessBrowserUrl(processInfo),
      windowId: processBrowserWindowId(processInfo),
    },
  })
}

export function processBrowserDetailFromEvent(event: Event): ProcessBrowserEventDetail | null {
  const detail = (event as CustomEvent<Partial<ProcessBrowserEventDetail>>).detail
  if (!detail?.process || !detail.windowId || !detail.url) return null
  return detail as ProcessBrowserEventDetail
}
