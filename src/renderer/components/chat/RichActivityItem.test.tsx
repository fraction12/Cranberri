import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { hasRichActivityPresentation, RichActivityItem } from './RichActivityItem'

describe('RichActivityItem', () => {
  it('dispatches protocol detail to the focused renderer', () => {
    const html = renderToStaticMarkup(
      <RichActivityItem
        status="completed"
        detail={{ type: 'commandExecution', command: 'npm test', aggregatedOutput: '42 tests passed', exitCode: 0 }}
      />,
    )

    expect(html).toContain('Command completed')
    expect(html).toContain('npm test')
    expect(html).toContain('42 tests passed')
  })

  it('presents subagent identity and lifecycle without inventing state', () => {
    const html = renderToStaticMarkup(
      <RichActivityItem
        status="completed"
        detail={{ type: 'subAgentActivity', kind: 'interacted', agentPath: 'agents/reviewer', agentThreadId: 'thread-2' }}
      />,
    )

    expect(html).toContain('Subagent updated')
    expect(html).toContain('agents/reviewer')
    expect(html).toContain('thread-2')
  })

  it('keeps narrative activity with the transcript renderer', () => {
    const html = renderToStaticMarkup(
      <RichActivityItem status="completed" detail={{ type: 'reasoning', summary: ['Inspecting'] }} />,
    )

    expect(html).toBe('')
    expect(hasRichActivityPresentation({ type: 'reasoning', summary: ['Inspecting'] })).toBe(false)
  })
})
