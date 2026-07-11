import { describe, expect, it } from 'vitest'
import { COMPOSER_SCRIM_CLEARANCE, composerBottomInset } from './composer-layout'

describe('composer layout', () => {
  it('reserves the full rendered composer plus its scrim clearance', () => {
    expect(composerBottomInset(116.2)).toBe(117 + COMPOSER_SCRIM_CLEARANCE)
    expect(composerBottomInset(-10)).toBe(COMPOSER_SCRIM_CLEARANCE)
  })
})
