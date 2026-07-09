import { describe, expect, it } from 'vitest'
import {
  getCodexEffortsForModel,
  getCodexModelOption,
  getCodexSpeedsForModel,
  normalizeCodexReasoningEffort,
  normalizeCodexSpeed,
} from './codex'

describe('Codex model capabilities', () => {
  it('exposes the complete GPT-5.6 family in capability order', () => {
    expect([
      getCodexModelOption('gpt-5.6-sol')?.label,
      getCodexModelOption('gpt-5.6-terra')?.label,
      getCodexModelOption('gpt-5.6-luna')?.label,
    ]).toEqual(['GPT-5.6-Sol', 'GPT-5.6-Terra', 'GPT-5.6-Luna'])
  })

  it('supports Max and Ultra on Sol and Terra', () => {
    expect(getCodexEffortsForModel('gpt-5.6-sol').map((effort) => effort.value)).toEqual([
      'low', 'medium', 'high', 'xhigh', 'max', 'ultra',
    ])
    expect(getCodexEffortsForModel('gpt-5.6-terra').map((effort) => effort.value)).toContain('ultra')
  })

  it('supports Max but prevents Ultra on Luna', () => {
    expect(getCodexEffortsForModel('gpt-5.6-luna').map((effort) => effort.value)).toEqual([
      'low', 'medium', 'high', 'xhigh', 'max',
    ])
    expect(normalizeCodexReasoningEffort('gpt-5.6-luna', 'ultra')).toBe('medium')
  })

  it('matches the legacy model defaults and Fast availability from model/list', () => {
    expect(normalizeCodexReasoningEffort('gpt-5.3-codex-spark', 'max')).toBe('high')
    expect(getCodexSpeedsForModel('gpt-5.5').map((speed) => speed.value)).toEqual(['standard', 'fast'])
    expect(getCodexSpeedsForModel('gpt-5.4-mini').map((speed) => speed.value)).toEqual(['standard'])
    expect(getCodexSpeedsForModel('gpt-5.3-codex-spark').map((speed) => speed.value)).toEqual(['standard'])
    expect(normalizeCodexSpeed('gpt-5.4-mini', 'fast')).toBe('standard')
  })

  it('preserves an effort for unknown future model identifiers', () => {
    expect(normalizeCodexReasoningEffort('gpt-future', 'ultra')).toBe('ultra')
    expect(normalizeCodexSpeed('gpt-future', 'fast')).toBe('fast')
  })
})
