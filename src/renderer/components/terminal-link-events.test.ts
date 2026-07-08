import { describe, expect, it } from 'vitest'
import {
  OPEN_TERMINAL_LINK_BROWSER_EVENT,
  createOpenTerminalLinkBrowserEvent,
  terminalLinkBrowserDetailFromEvent,
  terminalLocalBrowserUrl,
} from './terminal-link-events'

describe('terminal link events', () => {
  it('normalizes local dev URLs for the shared browser surface', () => {
    expect(terminalLocalBrowserUrl('http://localhost:5173/path')).toBe('http://localhost:5173/path')
    expect(terminalLocalBrowserUrl('http://0.0.0.0:5173/')).toBe('http://localhost:5173/')
    expect(terminalLocalBrowserUrl('https://127.0.0.1:8443/login')).toBe('https://127.0.0.1:8443/login')
  })

  it('keeps external and non-web links out of Cranberri browser routing', () => {
    expect(terminalLocalBrowserUrl('https://example.com')).toBeNull()
    expect(terminalLocalBrowserUrl('mailto:test@example.com')).toBeNull()
    expect(terminalLocalBrowserUrl('not a url')).toBeNull()
  })

  it('creates stable browser events from terminal links', () => {
    const event = createOpenTerminalLinkBrowserEvent('http://0.0.0.0:5173/app')

    expect(event?.type).toBe(OPEN_TERMINAL_LINK_BROWSER_EVENT)
    expect(terminalLinkBrowserDetailFromEvent(event as Event)).toEqual({
      url: 'http://localhost:5173/app',
      windowId: 'browser-terminal-http-localhost-5173',
      title: 'localhost:5173',
    })
  })
})
