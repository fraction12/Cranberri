import { describe, expect, it } from 'vitest'
import {
  MINIMUM_GPT_56_CODEX_VERSION,
  codexCliNeedsUpdate,
  parseCodexCliVersion,
} from './version'

describe('Codex CLI compatibility', () => {
  it('parses stable and prerelease CLI output', () => {
    expect(parseCodexCliVersion('codex-cli 0.144.0')).toBe('0.144.0')
    expect(parseCodexCliVersion('codex-cli 0.144.0-alpha.4')).toBe('0.144.0-alpha.4')
    expect(parseCodexCliVersion('not codex')).toBeNull()
  })

  it('requires the GPT-5.6-compatible stable CLI', () => {
    expect(MINIMUM_GPT_56_CODEX_VERSION).toBe('0.144.0')
    expect(codexCliNeedsUpdate('codex-cli 0.142.0-alpha.9')).toBe(true)
    expect(codexCliNeedsUpdate('codex-cli 0.144.0-alpha.4')).toBe(true)
    expect(codexCliNeedsUpdate('codex-cli 0.144.0')).toBe(false)
    expect(codexCliNeedsUpdate('codex-cli 0.145.1')).toBe(false)
    expect(codexCliNeedsUpdate('unknown')).toBe(true)
  })
})
