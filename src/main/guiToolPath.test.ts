import { describe, expect, it } from 'vitest'
import { withGuiToolPath } from './guiToolPath'

describe('withGuiToolPath', () => {
  it('adds Homebrew and system tool directories before a GUI-style PATH', () => {
    const env = withGuiToolPath({ PATH: '/usr/bin:/bin', HOME: '/Users/example' })

    expect(env.PATH?.split(':').slice(0, 6)).toEqual([
      '/opt/homebrew/bin',
      '/usr/local/bin',
      '/usr/bin',
      '/bin',
      '/usr/sbin',
      '/sbin',
    ])
    expect(env.HOME).toBe('/Users/example')
  })

  it('does not duplicate existing entries', () => {
    const env = withGuiToolPath({ PATH: '/opt/homebrew/bin:/usr/bin:/custom/bin' })

    expect(env.PATH?.split(':')).toEqual([
      '/opt/homebrew/bin',
      '/usr/local/bin',
      '/usr/bin',
      '/bin',
      '/usr/sbin',
      '/sbin',
      '/custom/bin',
    ])
  })
})
