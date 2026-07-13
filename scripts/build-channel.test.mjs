import { describe, expect, it } from 'vitest'
import { resolveBuildChannel } from './build-channel.mjs'

describe('resolveBuildChannel', () => {
  it('defaults ordinary builds to development', () => {
    expect(resolveBuildChannel({ packaged: false })).toBe('development')
  })

  it('defaults packaged directory builds to isolated UAT', () => {
    expect(resolveBuildChannel({ packaged: true })).toBe('uat')
  })

  it('accepts an explicit release channel', () => {
    expect(resolveBuildChannel({ packaged: true, requested: 'release' })).toBe('release')
  })

  it('rejects unknown channels', () => {
    expect(() => resolveBuildChannel({ packaged: true, requested: 'production-ish' }))
      .toThrow('Unknown Cranberri build channel')
  })
})
