import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { VoiceDictationButton } from './VoiceDictationButton'

describe('VoiceDictationButton', () => {
  it('renders an accessible idle mic control', () => {
    const html = renderToStaticMarkup(<VoiceDictationButton listening={false} onClick={() => undefined} />)

    expect(html).toContain('aria-label="Start voice dictation"')
    expect(html).toContain('aria-pressed="false"')
    expect(html).toContain('title="Start voice dictation"')
  })

  it('renders an accessible active mic control', () => {
    const html = renderToStaticMarkup(<VoiceDictationButton listening onClick={() => undefined} />)

    expect(html).toContain('aria-label="Stop voice dictation"')
    expect(html).toContain('aria-pressed="true"')
    expect(html).toContain('animate-pulse')
  })
})
