import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { CollaborationActivity } from './CollaborationActivity'

describe('CollaborationActivity', () => {
  it('renders collaborator identities, status, prompt, and model', () => {
    const html = renderToStaticMarkup(
      <CollaborationActivity
        status="running"
        detail={{
          type: 'collabAgentToolCall',
          tool: 'spawn_agent',
          senderThreadId: 'parent-thread',
          receiverThreadIds: ['agent-a', 'agent-b'],
          prompt: 'Audit the command rendering path',
          model: 'gpt-5.6',
          reasoningEffort: 'high',
          agentsStates: {
            'agent-a': { status: 'running', message: 'Reading the renderer' },
            'agent-b': { status: 'completed', message: null },
          },
        }}
      />,
    )

    expect(html).toContain('Running 2 collaborators')
    expect(html).toContain('parent-thread')
    expect(html).toContain('agent-a')
    expect(html).toContain('Reading the renderer')
    expect(html).toContain('gpt-5.6')
    expect(html).toContain('high')
  })

  it('handles failed, empty, and large collaboration payloads', () => {
    const failed = renderToStaticMarkup(
      <CollaborationActivity
        status="failed"
        detail={{ type: 'collabAgentToolCall', tool: 'wait', prompt: 'x'.repeat(500), agentsStates: { broken: undefined } }}
      />,
    )
    const empty = renderToStaticMarkup(
      <CollaborationActivity status="completed" detail={{ type: 'collabAgentToolCall' }} />,
    )

    expect(failed).toContain('Collaboration failed')
    expect(failed).toContain('truncate')
    expect(failed).toContain('broken')
    expect(empty).toContain('No collaboration details')
    expect(`${failed}${empty}`).not.toContain('undefined')
  })
})
