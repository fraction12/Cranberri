import { describe, expect, it } from 'vitest'
import {
  createOpenRightRailCommandEvent,
  rightRailCommandFromEvent,
} from './right-rail-command-events'

describe('right rail command events', () => {
  it('round-trips valid right rail commands', () => {
    const event = createOpenRightRailCommandEvent({
      tab: 'files',
      filesMode: 'all',
      bottomPanel: 'processes',
      selectedFileCommand: 'search',
    })

    expect(rightRailCommandFromEvent(event)).toEqual({
      tab: 'files',
      filesMode: 'all',
      bottomPanel: 'processes',
      selectedFileCommand: 'search',
    })
  })

  it('round-trips selected file commands', () => {
    expect(rightRailCommandFromEvent(createOpenRightRailCommandEvent({ selectedFileCommand: 'go-to-line', selectedFileLine: 42 }))).toEqual({
      selectedFileCommand: 'go-to-line',
      selectedFileLine: 42,
    })
    expect(rightRailCommandFromEvent(createOpenRightRailCommandEvent({ selectedFileCommand: 'send-context' }))).toEqual({
      selectedFileCommand: 'send-context',
    })
    expect(rightRailCommandFromEvent(createOpenRightRailCommandEvent({ selectedFileCommand: 'copy-path' }))).toEqual({
      selectedFileCommand: 'copy-path',
    })
    expect(rightRailCommandFromEvent(createOpenRightRailCommandEvent({ selectedFileCommand: 'copy-content' }))).toEqual({
      selectedFileCommand: 'copy-content',
    })
  })

  it('keeps explicit null bottom panel commands', () => {
    const event = createOpenRightRailCommandEvent({ bottomPanel: null })

    expect(rightRailCommandFromEvent(event)).toEqual({ bottomPanel: null })
  })

  it('round-trips right rail actions', () => {
    expect(rightRailCommandFromEvent(createOpenRightRailCommandEvent({ action: 'open-commit' }))).toEqual({
      action: 'open-commit',
    })
    expect(rightRailCommandFromEvent(createOpenRightRailCommandEvent({ action: 'open-commit-draft' }))).toEqual({
      action: 'open-commit-draft',
    })
  })

  it('rejects unknown command payloads', () => {
    const event = new CustomEvent('x', {
      detail: { tab: 'terminal', bottomPanel: 'secrets', filesMode: 'recent', selectedFileCommand: 'delete', selectedFileLine: -1, action: 'publish' },
    })

    expect(rightRailCommandFromEvent(event)).toBeNull()
  })
})
