import { describe, expect, it } from 'vitest'
import { nextTabIndex } from './tab-navigation'

describe('tab navigation', () => {
  it('wraps directional navigation and supports Home and End', () => {
    expect(nextTabIndex(2, 3, 'ArrowRight')).toBe(0)
    expect(nextTabIndex(0, 3, 'ArrowLeft')).toBe(2)
    expect(nextTabIndex(1, 3, 'Home')).toBe(0)
    expect(nextTabIndex(1, 3, 'End')).toBe(2)
  })

  it('ignores unrelated keys and invalid collections', () => {
    expect(nextTabIndex(1, 3, 'Enter')).toBeNull()
    expect(nextTabIndex(-1, 3, 'ArrowRight')).toBeNull()
    expect(nextTabIndex(0, 0, 'ArrowRight')).toBeNull()
  })
})
