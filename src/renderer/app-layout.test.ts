import { describe, expect, it } from 'vitest'
import { availableRailWidth, railMaxWidth } from './app-layout'

describe('rail layout sizing', () => {
  it('allows either rail to grow at the normal desktop width', () => {
    const available = availableRailWidth(1291)

    expect(railMaxWidth(available, 320, 256)).toBeGreaterThan(256)
    expect(railMaxWidth(available, 256, 320)).toBeGreaterThan(320)
  })

  it('preserves minimum rail widths when the window is constrained', () => {
    const available = availableRailWidth(900)

    expect(railMaxWidth(available, 320, 256)).toBe(256)
    expect(railMaxWidth(available, 256, 320)).toBe(320)
  })
})
