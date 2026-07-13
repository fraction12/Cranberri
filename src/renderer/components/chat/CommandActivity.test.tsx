import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { CommandActivity } from './CommandActivity'

describe('CommandActivity', () => {
  it('renders a compact running command with actions and complete output', () => {
    const output = `${'line of output '.repeat(30)}\nfinished`
    const html = renderToStaticMarkup(
      <CommandActivity
        status="running"
        detail={{
          type: 'commandExecution',
          command: 'npm run build',
          commandActions: [{ type: 'read', name: 'package.json', path: 'package.json' }],
          cwd: '/repo',
          processId: '912',
          aggregatedOutput: output,
        }}
      />,
    )

    expect(html).toContain('<details')
    expect(html).toContain('<summary')
    expect(html).toContain('Running command')
    expect(html).toContain('npm run build')
    expect(html).toContain('package.json')
    expect(html).toContain('finished')
    expect(html).toContain('max-h-80')
  })

  it('surfaces failed exit details without losing malformed output', () => {
    const circular: { self?: unknown } = {}
    circular.self = circular
    const html = renderToStaticMarkup(
      <CommandActivity
        status="failed"
        detail={{ type: 'commandExecution', command: '', aggregatedOutput: circular, exitCode: 2, durationMs: 1530 }}
      />,
    )

    expect(html).toContain('Command failed')
    expect(html).toContain('Exit 2')
    expect(html).toContain('1.5s')
    expect(html).toContain('[Circular]')
    expect(html).not.toContain('undefined')
  })

  it('renders an honest completed empty state', () => {
    const html = renderToStaticMarkup(<CommandActivity status="completed" detail={{ type: 'commandExecution' }} />)
    expect(html).toContain('Command completed')
    expect(html).toContain('No command details')
  })
})
