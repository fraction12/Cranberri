import { describe, expect, it } from 'vitest'
import { browserScreenshotPath, browserSessionPartition, normalizeBrowserInspectionPayload, normalizeBrowserProfileId, normalizeBrowserUrl } from './browser'

describe('browser helpers', () => {
  it('normalizes browser URLs to supported protocols', () => {
    expect(normalizeBrowserUrl('localhost:5173')).toBe('http://localhost:5173/')
    expect(normalizeBrowserUrl('http://localhost:5173')).toBe('http://localhost:5173/')
    expect(normalizeBrowserUrl('about:blank')).toBe('about:blank')
    expect(() => normalizeBrowserUrl('javascript:alert(1)')).toThrow('Unsupported browser URL protocol')
  })

  it('derives stable safe session partitions from profile ids', () => {
    expect(normalizeBrowserProfileId('Repo Cranberri / Main')).toBe('repo-cranberri-main')
    expect(browserSessionPartition('Repo Cranberri / Main')).toBe('persist:cranberri-browser:repo-cranberri-main')
    expect(browserSessionPartition('   ')).toBe('persist:cranberri-browser:default')
  })

  it('derives safe screenshot capture paths under user data', () => {
    expect(browserScreenshotPath('/tmp/cranberri', 'Browser / One', 123)).toBe('/tmp/cranberri/browser-captures/Browser-One-123.png')
    expect(browserScreenshotPath('/tmp/cranberri', '   ', 456)).toBe('/tmp/cranberri/browser-captures/browser-456.png')
  })

  it('normalizes inspected element payloads with page metadata', () => {
    expect(normalizeBrowserInspectionPayload('browser-1', {
      selector: '#submit',
      tagName: 'button',
      text: 'Send',
      rect: { x: 10, y: 20, width: 80, height: 32 },
      styles: {
        display: 'inline-flex',
        fontFamily: 'Inter',
        fontSize: '14px',
        fontWeight: '600',
        color: 'rgb(0, 0, 0)',
        backgroundColor: 'rgb(34, 197, 94)',
        margin: '0px',
        padding: '8px',
        borderRadius: '6px',
      },
      attributes: { type: 'submit' },
    }, {
      url: 'https://example.com/form',
      title: 'Example',
    })).toMatchObject({
      windowId: 'browser-1',
      url: 'https://example.com/form',
      title: 'Example',
      selector: '#submit',
      attributes: { type: 'submit' },
    })
  })
})
