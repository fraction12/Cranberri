import { describe, expect, it } from 'vitest'
import { browserViewportFrame, browserViewportProfile } from './browser-viewport'

describe('browser viewport profiles', () => {
  it('uses responsive dimensions by default', () => {
    expect(browserViewportProfile(undefined).mode).toBe('responsive')
    expect(browserViewportFrame(undefined, { width: 1200, height: 800 })).toMatchObject({
      width: '100%',
      height: '100%',
      label: 'Responsive',
    })
  })

  it('returns fixed device dimensions when available space allows them', () => {
    expect(browserViewportFrame('mobile', { width: 1200, height: 1000 })).toMatchObject({
      width: '390px',
      height: '844px',
      label: 'Mobile 390x844',
    })
  })

  it('clamps fixed device dimensions to the available pane', () => {
    expect(browserViewportFrame('desktop', { width: 900.8, height: 620.4 })).toMatchObject({
      width: '900px',
      height: '620px',
      label: 'Desktop 1440x900',
    })
  })
})
