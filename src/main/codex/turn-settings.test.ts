import { describe, expect, it } from 'vitest'
import { buildCodexTurnOverrides } from './turn-settings'

describe('Codex turn settings', () => {
  it('sends GPT-5.6 Ultra and the priority tier for Fast mode', () => {
    expect(buildCodexTurnOverrides({
      model: 'gpt-5.6-sol',
      effort: 'ultra',
      speed: 'fast',
    })).toEqual({
      model: 'gpt-5.6-sol',
      effort: 'ultra',
      serviceTier: 'priority',
    })
  })

  it('explicitly clears a previous Fast override for Standard mode', () => {
    expect(buildCodexTurnOverrides({
      model: 'gpt-5.6-terra',
      effort: 'max',
      speed: 'standard',
    })).toEqual({
      model: 'gpt-5.6-terra',
      effort: 'max',
      serviceTier: null,
    })
  })

  it('does not request priority for a model without Fast support', () => {
    expect(buildCodexTurnOverrides({
      model: 'gpt-5.4-mini',
      effort: 'high',
      speed: 'fast',
    })).toEqual({
      model: 'gpt-5.4-mini',
      effort: 'high',
      serviceTier: null,
    })
  })

  it('normalizes an unsupported Luna Ultra turn before transport', () => {
    expect(buildCodexTurnOverrides({
      model: 'gpt-5.6-luna',
      effort: 'ultra',
    })).toEqual({
      model: 'gpt-5.6-luna',
      effort: 'medium',
    })
  })
})
