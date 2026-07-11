import { describe, expect, it } from 'vitest'
import {
  hashEnvironmentToml,
  normalizeEnvironmentToml,
  parseEnvironmentToml,
  resolveActionScript,
  resolveSetupScript,
} from './parser'

const PROFILE = `
version = 1
name = "Web app"

[setup]
script = """
npm install
npm run build
"""

[cranberri]
inherit = ["AWS_PROFILE", "NODE_ENV"]

[cranberri.platform.macos]
setup_script = "brew bundle && npm install"

[[cranberri.actions]]
id = "dev"
name = "Start development"
script = "npm run dev"

[cranberri.actions.platform]
windows = "npm.cmd run dev"
`

describe('environment TOML parser', () => {
  it('parses, normalizes, and hashes equivalent TOML deterministically', () => {
    const parsed = parseEnvironmentToml(PROFILE)
    expect(parsed).toMatchObject({
      version: 1,
      name: 'Web app',
      setup: { script: 'npm install\nnpm run build' },
      inherit: ['AWS_PROFILE', 'NODE_ENV'],
      actions: [{ id: 'dev', name: 'Start development', script: 'npm run dev' }],
    })

    const normalized = normalizeEnvironmentToml(parsed)
    expect(parseEnvironmentToml(normalized)).toEqual(parsed)
    expect(hashEnvironmentToml(normalized)).toBe(hashEnvironmentToml(normalizeEnvironmentToml(parseEnvironmentToml(normalized))))
  })

  it('uses a platform override and falls back to the common script', () => {
    const profile = parseEnvironmentToml(PROFILE)
    expect(resolveSetupScript(profile, 'macos')).toBe('brew bundle && npm install')
    expect(resolveSetupScript(profile, 'linux')).toBe(profile.setup.script)
    expect(resolveActionScript(profile.actions[0], 'windows')).toBe('npm.cmd run dev')
    expect(resolveActionScript(profile.actions[0], 'linux')).toBe('npm run dev')
  })

  it('rejects malformed and duplicate actions', () => {
    expect(() =>
      parseEnvironmentToml(`
version = 1
name = "Bad"
[setup]
script = "true"
[[cranberri.actions]]
id = "Not valid"
name = "Bad"
script = "true"
`),
    ).toThrow(/action|invalid/i)

    expect(() =>
      parseEnvironmentToml(`
version = 1
name = "Duplicate"
[setup]
script = "true"
[[cranberri.actions]]
id = "dev"
name = "One"
script = "one"
[[cranberri.actions]]
id = "dev"
name = "Two"
script = "two"
`),
    ).toThrow(/duplicate action/i)
  })

  it('imports a minimal Codex-compatible profile', () => {
    const profile = parseEnvironmentToml('version = 1\nname = "Minimal"\n[setup]\nscript = "npm install"\n')
    expect(profile).toEqual({
      version: 1,
      name: 'Minimal',
      setup: { script: 'npm install', platform: {} },
      inherit: [],
      actions: [],
    })
  })
})
