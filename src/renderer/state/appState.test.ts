import { describe, expect, it } from 'vitest'
import { DEFAULT_APP_STATE } from '@/shared/appState'
import { withProjectExpanded } from './appState'

describe('project expansion state', () => {
  it('does not alter project workspace or active window context', () => {
    const state = {
      ...DEFAULT_APP_STATE,
      workspacesByProjectId: {
        active: {
          activeWindowId: 'chat-1',
          windows: [{ id: 'chat-1', type: 'chat' as const, title: 'Chat', projectId: 'active', taskId: 'task-1', checkoutId: 'checkout-1' }],
        },
      },
    }
    const next = withProjectExpanded(state, 'other', true)
    expect(next.workspacesByProjectId).toBe(state.workspacesByProjectId)
    expect(next.workspacesByProjectId.active).toBe(state.workspacesByProjectId.active)
    expect(next.expandedProjectIds.other).toBe(true)
  })
})
