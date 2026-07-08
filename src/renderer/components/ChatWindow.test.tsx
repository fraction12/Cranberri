import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { NEW_THREAD_EMPTY_STATE, shouldRestoreDraftAfterSendError } from './chat/chat-window-state'
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

  it('restores a draft only when first send failed before a thread was created', () => {
    expect(shouldRestoreDraftAfterSendError(undefined, new Error('spawn failed'))).toBe(true)
    expect(shouldRestoreDraftAfterSendError('thread-1', new Error('turn failed'))).toBe(false)
    expect(shouldRestoreDraftAfterSendError(undefined, Object.assign(new Error('turn failed'), { threadCreated: true }))).toBe(false)
  })
})
