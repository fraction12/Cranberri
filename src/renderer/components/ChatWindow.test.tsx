import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  NEW_THREAD_EMPTY_STATE,
  didReaderMoveTranscriptUp,
  isTranscriptNearBottom,
  projectWithFreshLocalSettings,
  sessionThreadIdFromWindowId,
  shouldSendComposerOnEnter,
} from './chat/chat-window-state'
import { renderSkillText } from './chat/composer-text'
import type { CodexSkillInfo } from '@/shared/codex'
import type { Task } from '@/shared/tasks'
import { rebindWindowAfterHandoff } from './ChatWindow'

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

  it('projects fresh repo settings over a stale task catalog project', () => {
    const catalogProject = {
      id: 'project-1',
      name: 'Cranberri',
      gitCommonDir: '/repo/.git',
      localCheckoutId: 'checkout-1',
      pinnedLocalBranch: 'old-branch',
      defaultEnvironmentId: 'old-environment',
      controlTaskId: 'control-1',
      localLeaseTaskId: null,
    }
    const activeProject = {
      ...catalogProject,
      path: '/repo',
      pinnedLocalBranch: 'main',
      defaultEnvironmentId: null,
    }

    expect(projectWithFreshLocalSettings(catalogProject, activeProject)).toEqual({
      ...catalogProject,
      pinnedLocalBranch: 'main',
      defaultEnvironmentId: null,
    })
    expect(projectWithFreshLocalSettings(catalogProject, { ...activeProject, id: 'project-2' })).toBe(catalogProject)
  })

  it.each([
    { checkoutId: 'checkout-local', location: 'local' as const, worktreeId: 'worktree-1', path: '/repo' },
    { checkoutId: 'checkout-worktree', location: 'worktree' as const, worktreeId: 'worktree-1', path: '/managed/task' },
  ])('rebinds a successful $location handoff before dismissing its dialog', ({ checkoutId, location, worktreeId, path }) => {
    const order: string[] = []
    const handedOffTask = {
      id: 'task-1', projectId: 'project-1', checkoutId, location, worktreeId,
    } as Task

    rebindWindowAfterHandoff({
      windowId: 'window-1',
      task: handedOffTask,
      checkouts: [{
        id: checkoutId,
        projectId: 'project-1',
        kind: location === 'local' ? 'local' : 'managed',
        canonicalPath: path,
        gitCommonDir: '/repo/.git',
        ownership: location === 'local' ? 'user' : 'cranberri',
        available: true,
      }],
      bindWindowToTask: (_windowId, context) => order.push(`bind:${context.checkoutPath}`),
      closeDialog: () => order.push('close'),
    })

    expect(order).toEqual([`bind:${path}`, 'close'])
  })

})
