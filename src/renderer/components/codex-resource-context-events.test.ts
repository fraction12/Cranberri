import { describe, expect, it } from 'vitest'
import type { LatestCodexResourceContext } from './codex-resources'
import { codexResourceContextFromEvent, CODEX_RESOURCE_CONTEXT_CAPTURED_EVENT, createCodexResourceContextCapturedEvent } from './codex-resource-context-events'

const context: LatestCodexResourceContext = {
  kind: 'skill',
  label: 'ce-work',
  text: 'Use this Codex skill:\nSkill: CE Work',
  inputParts: [{ type: 'skill', name: 'ce-work', path: '/skills/ce-work/SKILL.md' }],
}

describe('codex resource context events', () => {
  it('round-trips captured resource context', () => {
    const event = createCodexResourceContextCapturedEvent(context)

    expect(event.type).toBe(CODEX_RESOURCE_CONTEXT_CAPTURED_EVENT)
    expect(codexResourceContextFromEvent(event)).toEqual(context)
  })

  it('ignores non-resource events', () => {
    expect(codexResourceContextFromEvent(new Event(CODEX_RESOURCE_CONTEXT_CAPTURED_EVENT))).toBeNull()
    expect(codexResourceContextFromEvent(new CustomEvent(CODEX_RESOURCE_CONTEXT_CAPTURED_EVENT, { detail: {} }))).toBeNull()
  })
})
