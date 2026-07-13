import { describe, expect, it } from 'vitest'
import { assertReleaseIdentity } from './release-contract.mjs'

describe('assertReleaseIdentity', () => {
  it('accepts a new version tag', () => {
    expect(() => assertReleaseIdentity({
      currentCommit: 'new-commit',
      packageVersion: '0.1.17',
      tag: 'v0.1.17',
      tagCommit: null,
    })).not.toThrow()
  })

  it('allows idempotent validation of the commit already carrying a tag', () => {
    expect(() => assertReleaseIdentity({
      currentCommit: 'same-commit',
      packageVersion: '0.1.17',
      tag: 'v0.1.17',
      tagCommit: 'same-commit',
    })).not.toThrow()
  })

  it('rejects reusing a released version for different code', () => {
    expect(() => assertReleaseIdentity({
      currentCommit: 'new-commit',
      packageVersion: '0.1.16',
      tag: 'v0.1.16',
      tagCommit: 'released-commit',
    })).toThrow('already identifies a different commit')
  })

  it('rejects a tag that does not match the package version', () => {
    expect(() => assertReleaseIdentity({
      currentCommit: 'new-commit',
      packageVersion: '0.1.17',
      tag: 'v0.1.16',
      tagCommit: null,
    })).toThrow('does not match package version')
  })
})
