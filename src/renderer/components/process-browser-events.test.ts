import { describe, expect, it } from 'vitest'
import {
  OPEN_PROCESS_BROWSER_EVENT,
  createOpenProcessBrowserEvent,
  inferProcessBrowserUrl,
  processBrowserDetailFromEvent,
  processBrowserWindowId,
} from './process-browser-events'
import type { AgentProcessInfo } from '@/shared/processes'

const DEV_SERVER: AgentProcessInfo = {
  id: 'child:1234',
  pid: 1234,
  command: 'npm run dev -- --port 5174',
  repoPath: '/repo',
  kind: 'dev-server',
  source: 'terminal',
  status: 'running',
  startedAt: 1,
}

describe('process browser events', () => {
  it('infers useful local URLs for dev-server commands', () => {
    expect(inferProcessBrowserUrl(DEV_SERVER)).toBe('http://localhost:5174')
    expect(inferProcessBrowserUrl({ ...DEV_SERVER, command: 'vite http://0.0.0.0:5178/' })).toBe('http://localhost:5178/')
    expect(inferProcessBrowserUrl({ ...DEV_SERVER, command: 'next dev' })).toBe('http://localhost:3000')
    expect(inferProcessBrowserUrl({ ...DEV_SERVER, kind: 'agent' })).toBe('about:blank')
  })

  it('creates stable browser open events for Workspace', () => {
    const event = createOpenProcessBrowserEvent(DEV_SERVER)

    expect(event.type).toBe(OPEN_PROCESS_BROWSER_EVENT)
    expect(processBrowserWindowId(DEV_SERVER)).toBe('browser-process-child-1234')
    expect(processBrowserDetailFromEvent(event)).toMatchObject({
      windowId: 'browser-process-child-1234',
      url: 'http://localhost:5174',
      process: DEV_SERVER,
    })
  })
})
