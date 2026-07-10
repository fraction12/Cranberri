import { describe, expect, it } from 'vitest'
import { codexModelLabel } from './ModelSelector'

describe('model selector labels', () => {
  it('keeps unknown model identifiers visible instead of showing a different model', () => {
    expect(codexModelLabel('gpt-custom-preview')).toBe('gpt-custom-preview')
    expect(codexModelLabel('gpt-5.6-sol')).toBe('GPT-5.6-Sol')
  })
})
