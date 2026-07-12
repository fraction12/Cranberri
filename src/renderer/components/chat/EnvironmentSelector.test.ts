import { describe, expect, it } from 'vitest'
import { selectedEnvironment, type EnvironmentOption } from './EnvironmentSelector'

const options: EnvironmentOption[] = [
  { id: 'default', name: 'Default environment', trusted: true },
  { id: 'untrusted', name: 'Untrusted environment', trusted: false },
]

describe('EnvironmentSelector', () => {
  it('keeps an explicit no-environment selection distinct from the default', () => {
    expect(selectedEnvironment(null, options)).toBeNull()
    expect(selectedEnvironment('default', options)?.name).toBe('Default environment')
  })

  it('does not select an untrusted environment', () => {
    expect(selectedEnvironment('untrusted', options)).toBeNull()
  })
})
