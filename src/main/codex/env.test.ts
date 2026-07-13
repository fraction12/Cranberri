import { afterEach, describe, expect, it } from 'vitest'
import { parseShellProbe, resetCodexRuntimeForTests, resolveCodexRuntime } from './env'

describe('Codex login-shell runtime', () => {
  afterEach(() => resetCodexRuntimeForTests())

  it('extracts framed path and environment despite shell startup output', () => {
    const result = parseShellProbe([
      'welcome from shell startup',
      '__CRANBERRI_CODEX_PATH__',
      '/Users/example/.local/bin/codex',
      '__CRANBERRI_CODEX_ENV__',
      'PATH=/Users/example/.local/bin:/opt/homebrew/bin\0HOME=/Users/example\0',
    ].join('\n'))

    expect(result.executable).toBe('/Users/example/.local/bin/codex')
    expect(result.env.PATH).toBe('/Users/example/.local/bin:/opt/homebrew/bin')
    expect(result.env.HOME).toBe('/Users/example')
  })

  it('rejects unframed shell output', () => {
    expect(() => parseShellProbe('/opt/homebrew/bin/codex')).toThrow('malformed')
  })

  it('reuses one runtime identity for the app session', async () => {
    const first = resolveCodexRuntime()
    const second = resolveCodexRuntime()
    expect(second).toBe(first)
    const runtime = await first
    expect(runtime.executable).toMatch(/^\//)
    expect(runtime.version).toMatch(/codex/i)
  })
})
