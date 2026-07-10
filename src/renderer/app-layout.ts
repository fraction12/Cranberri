export const LEFT_RAIL_MIN_WIDTH = 256
export const RIGHT_RAIL_MIN_WIDTH = 320
export const CENTER_MIN_WIDTH = 520
export const RAIL_RESIZER_WIDTH = 7

export function availableRailWidth(layoutWidth: number): number {
  return Math.max(
    LEFT_RAIL_MIN_WIDTH + RIGHT_RAIL_MIN_WIDTH,
    layoutWidth - CENTER_MIN_WIDTH - (RAIL_RESIZER_WIDTH * 2),
  )
}

export function railMaxWidth(availableWidth: number, otherRailWidth: number, minimumWidth: number): number {
  return Math.max(minimumWidth, availableWidth - otherRailWidth)
}
