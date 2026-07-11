import { describe, expect, it } from 'vitest'
import {
  availableRailWidth,
  CENTER_MIN_WIDTH,
  LEFT_RAIL_MIN_WIDTH,
  RAIL_RESIZER_WIDTH,
  railMaxWidth,
  RIGHT_RAIL_MIN_WIDTH,
} from './app-layout'

describe('rail layout sizing', () => {
  it('allows either rail to grow at the normal desktop width', () => {
    const available = availableRailWidth(1291)

    expect(railMaxWidth(available, RIGHT_RAIL_MIN_WIDTH, LEFT_RAIL_MIN_WIDTH)).toBeGreaterThan(LEFT_RAIL_MIN_WIDTH)
    expect(railMaxWidth(available, LEFT_RAIL_MIN_WIDTH, RIGHT_RAIL_MIN_WIDTH)).toBeGreaterThan(RIGHT_RAIL_MIN_WIDTH)
  })

  it('keeps both rails and a usable center inside the production minimum width', () => {
    const available = availableRailWidth(900)

    expect(
      LEFT_RAIL_MIN_WIDTH + RIGHT_RAIL_MIN_WIDTH + CENTER_MIN_WIDTH + (RAIL_RESIZER_WIDTH * 2),
    ).toBeLessThanOrEqual(900)
    expect(railMaxWidth(available, RIGHT_RAIL_MIN_WIDTH, LEFT_RAIL_MIN_WIDTH)).toBeGreaterThanOrEqual(LEFT_RAIL_MIN_WIDTH)
    expect(railMaxWidth(available, LEFT_RAIL_MIN_WIDTH, RIGHT_RAIL_MIN_WIDTH)).toBeGreaterThanOrEqual(RIGHT_RAIL_MIN_WIDTH)
  })
})
