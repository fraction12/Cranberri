import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  NEW_THREAD_EMPTY_STATE,
  sessionThreadIdFromWindowId,
  shouldRestoreDraftAfterSendError,
  shouldSendComposerOnEnter,
  shouldToastAfterSendError,
} from './chat/chat-window-state'
import { renderSkillText } from './chat/composer-text'
import { getSkillTrigger } from './ChatWindow'
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

  it('opens command and skill matching from the first trigger keystroke', () => {
    expect(getSkillTrigger('/', 1)).toEqual({ char: '/', start: 0, query: '' })
    expect(getSkillTrigger('$tool', 5)).toEqual({ char: '$', start: 0, query: 'tool' })
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

  it('keeps Enter from submitting or clearing a follow-up while Codex is running', () => {
    expect(shouldSendComposerOnEnter('Enter', false, false)).toBe(true)
    expect(shouldSendComposerOnEnter('Enter', false, true)).toBe(false)
    expect(shouldSendComposerOnEnter('Enter', true, false)).toBe(false)
  })

  it('avoids duplicating transcript send errors in a toast', () => {
    expect(shouldToastAfterSendError('thread-1', 'normal message', new Error('turn failed'))).toBe(false)
    expect(shouldToastAfterSendError('thread-1', '/compact', new Error('compact failed'))).toBe(true)
    expect(shouldToastAfterSendError(undefined, 'first message', new Error('spawn failed'))).toBe(true)
  })
})
