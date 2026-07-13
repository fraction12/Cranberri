import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { TurnActivity } from './TurnActivity'
import type { CodexActivityTurn, CodexMessage, PendingApproval } from '@/shared/codex'
import type { CodexPendingHumanServerRequest } from '@/shared/codex-requests'

const messages: CodexMessage[] = [{
  id: 'reasoning-1',
  role: 'reasoning',
  content: 'Checking the renderer state',
  timestamp: 1,
  turnId: 'turn-1',
}]

function turn(overrides: Partial<CodexActivityTurn> = {}): CodexActivityTurn {
  return {
    id: 'turn-1',
    status: 'completed',
    startedAt: 1_000,
    completedAt: 3_000,
    durationMs: 2_000,
    items: [{
      id: 'reasoning-1',
      kind: 'reasoning',
      status: 'completed',
      title: 'Thought',
    }, {
      id: 'command-1',
      kind: 'command',
      status: 'completed',
      title: 'Ran a command',
      detail: 'npm test',
    }],
    ...overrides,
  }
}

describe('TurnActivity', () => {
  it('collapses completed work behind a settled duration header', () => {
    const html = renderToStaticMarkup(
      <TurnActivity turn={turn()} messages={messages} approvals={[]} />,
    )

    expect(html).toContain('Worked for 2s')
    expect(html).not.toContain('npm test')
    expect(html).not.toContain('Checking the renderer state')
  })

  it('shows active typed items and an inline targeted approval', () => {
    const approval: PendingApproval = {
      id: 'approval-1',
      reviewId: 'review-1',
      targetItemId: 'command-1',
      action: {},
      review: {},
      description: 'Allow this command',
    }
    const html = renderToStaticMarkup(
      <TurnActivity
        turn={turn({ status: 'running', completedAt: undefined, durationMs: undefined })}
        messages={messages}
        approvals={[approval]}
        onResolveApproval={() => undefined}
      />,
    )

    expect(html).toContain('Working')
    expect(html).toContain('Checking the renderer state')
    expect(html).toContain('npm test')
    expect(html).toContain('Allow this command')
    expect(html).toContain('Approve')
    expect(html).toContain('Deny')
  })

  it('keeps an unresolved approval visible if completion races ahead', () => {
    const approval: PendingApproval = {
      id: 'approval-1',
      reviewId: 'review-1',
      targetItemId: 'command-1',
      action: {},
      review: {},
      description: 'Allow this command',
    }
    const html = renderToStaticMarkup(
      <TurnActivity turn={turn()} messages={messages} approvals={[approval]} onResolveApproval={() => undefined} />,
    )

    expect(html).toContain('Allow this command')
  })

  it('keeps steering and failures visible in chronological order', () => {
    const html = renderToStaticMarkup(
      <TurnActivity
        turn={turn({
          status: 'running',
          items: [{
            id: 'steer-1',
            kind: 'steering',
            status: 'completed',
            title: 'Direction sent',
            content: 'Focus on chat only',
          }, {
            id: 'tool-1',
            kind: 'mcp_tool',
            status: 'failed',
            title: 'Tool failed',
          }],
        })}
        messages={[]}
        approvals={[]}
      />,
    )

    expect(html.indexOf('Focus on chat only')).toBeLessThan(html.indexOf('Tool failed'))
    expect(html).toContain('text-app-status-danger')
  })

  it('attaches a typed human request to its activity item and expands settled work', () => {
    const request: CodexPendingHumanServerRequest = {
      request: {
        id: 'request-1',
        method: 'item/fileChange/requestApproval',
        params: {
          threadId: 'thread-1',
          turnId: 'turn-1',
          itemId: 'command-1',
          startedAtMs: 100,
          reason: 'Approve the generated patch',
          grantRoot: '/repo',
        },
      },
      attempt: 1,
      receivedAt: 100,
      deadlineAt: 1_000,
    }
    const html = renderToStaticMarkup(
      <TurnActivity turn={turn()} messages={messages} approvals={[]} humanRequests={[request]} onRespondHumanRequest={async () => undefined} />,
    )

    expect(html).toContain('Approve the generated patch')
    expect(html.indexOf('npm test')).toBeLessThan(html.indexOf('Approve the generated patch'))
    expect(html).toContain('Apply these changes?')
  })
})
