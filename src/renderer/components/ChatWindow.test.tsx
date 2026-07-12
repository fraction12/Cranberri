import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  NEW_THREAD_EMPTY_STATE,
  didReaderMoveTranscriptUp,
  isTranscriptNearBottom,
  sessionThreadIdFromWindowId,
  shouldRestoreDraftAfterSendError,
  shouldSendComposerOnEnter,
  shouldToastAfterSendError,
} from './chat/chat-window-state'
import { renderSkillText } from './chat/composer-text'
import type { CodexSkillInfo } from '@/shared/codex'

const CE_BRAINSTORM: CodexSkillInfo = {
  id: 'skill:ce-brainstorm',
  name: 'compound-engineering:ce-brainstorm',
  displayName: 'Ce Brainstorm',
  description: 'Explore vague or ambitious ideas',
  path: '/Users/example/ce-brainstorm/SKILL.md',
  source: 'plugin',
  pluginName: 'compound-engineering',
}

describe('ChatWindow composer rendering', () => {
  it('renders selected skills with the shared mention pill style', () => {
    const html = renderToStaticMarkup(<>{renderSkillText('📦 Ce Brainstorm', [CE_BRAINSTORM])}</>)

    expect(html).toContain('Ce Brainstorm')
    expect(html).toContain('data-mention-kind="skill"')
    expect(html).not.toContain('underline')
  })

  it('uses ready copy for a lazy new Codex thread', () => {
    expect(NEW_THREAD_EMPTY_STATE).toBe('Ask Codex to inspect, edit, or explain this repo.')
  })

  it('recovers the Codex thread id from a persisted session window', () => {
    expect(sessionThreadIdFromWindowId('session-thread-123')).toBe('thread-123')
    expect(sessionThreadIdFromWindowId('win-123')).toBeNull()
    expect(sessionThreadIdFromWindowId('session-')).toBeNull()
  })

  it('restores a draft only when first send failed before a thread was created', () => {
    expect(shouldRestoreDraftAfterSendError(undefined, new Error('spawn failed'))).toBe(true)
    expect(shouldRestoreDraftAfterSendError('thread-1', new Error('turn failed'))).toBe(false)
    expect(shouldRestoreDraftAfterSendError(undefined, Object.assign(new Error('turn failed'), { threadCreated: true }))).toBe(false)
  })

  it('submits Enter as a follow-up even while Codex is running', () => {
    expect(shouldSendComposerOnEnter('Enter', false)).toBe(true)
    expect(shouldSendComposerOnEnter('Enter', true)).toBe(false)
  })

  it('only pins streaming output when the reader is near the bottom', () => {
    expect(isTranscriptNearBottom(1_000, 420, 500)).toBe(true)
    expect(isTranscriptNearBottom(1_000, 200, 500)).toBe(false)
  })

  it('distinguishes reader scrolling from responsive transcript layout changes', () => {
    expect(didReaderMoveTranscriptUp(
      { scrollTop: 420, clientHeight: 500 },
      { scrollTop: 200, clientHeight: 500 },
    )).toBe(true)
    expect(didReaderMoveTranscriptUp(
      { scrollTop: 420, clientHeight: 500 },
      { scrollTop: 200, clientHeight: 320 },
    )).toBe(false)
    expect(didReaderMoveTranscriptUp(
      { scrollTop: 420, clientHeight: 500 },
      { scrollTop: 500, clientHeight: 500 },
    )).toBe(false)
  })

  it('avoids duplicating transcript send errors in a toast', () => {
    expect(shouldToastAfterSendError('thread-1', 'normal message', new Error('turn failed'))).toBe(false)
    expect(shouldToastAfterSendError('thread-1', '/compact', new Error('compact failed'))).toBe(true)
    expect(shouldToastAfterSendError(undefined, 'first message', new Error('spawn failed'))).toBe(true)
  })
})
