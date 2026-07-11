export const COMPOSER_SCRIM_CLEARANCE = 72

export function composerBottomInset(borderBoxHeight: number): number {
  return Math.ceil(Math.max(0, borderBoxHeight)) + COMPOSER_SCRIM_CLEARANCE
}
