import { describe, expect, it } from 'vitest'
import { buildCodexWorkerControlInput, codexWorkerControlDisplayText } from './codex-worker-control'

describe('buildCodexWorkerControlInput', () => {
  it('routes live worker messages through the parent collaboration tools', () => {
    const input = buildCodexWorkerControlInput('worker-1', 'message', 'Inspect "renderer" state.')

    expect(input).toEqual([{ type: 'text', text: expect.stringContaining('Target subagent thread: worker-1') }])
    expect(input[0]).toMatchObject({ type: 'text', text: expect.stringContaining('send_input') })
    expect(input[0]).toMatchObject({ type: 'text', text: expect.stringContaining('Inspect \\"renderer\\" state.') })
    expect(input[0]).toMatchObject({ type: 'text', text: expect.stringContaining('Do not spawn a replacement') })
  })

  it('asks the parent to resume the same terminal worker', () => {
    const input = buildCodexWorkerControlInput('worker-2', 'resume', 'Continue the audit.')

    expect(input[0]).toMatchObject({ type: 'text', text: expect.stringContaining('resume_agent') })
    expect(input[0]).toMatchObject({ type: 'text', text: expect.stringContaining('worker-2') })
  })

  it('turns persisted routing prompts back into concise user-facing instructions', () => {
    const message = buildCodexWorkerControlInput('worker-1', 'message', 'Inspect renderer state.')[0]
    const resume = buildCodexWorkerControlInput('worker-1', 'resume', 'Continue the audit.')[0]

    expect(message.type === 'text' ? codexWorkerControlDisplayText(message.text) : '').toBe('Worker instruction: Inspect renderer state.')
    expect(resume.type === 'text' ? codexWorkerControlDisplayText(resume.text) : '').toBe('Resume worker: Continue the audit.')
    expect(codexWorkerControlDisplayText('Ordinary user message')).toBe('Ordinary user message')
  })

  it('keeps visual context on the parent control turn', () => {
    const input = buildCodexWorkerControlInput('worker-1', 'message', 'Inspect the image.', [
      { type: 'localImage', path: '/tmp/worker.png', detail: 'high' },
    ])

    expect(input).toHaveLength(2)
    expect(input[1]).toEqual({ type: 'localImage', path: '/tmp/worker.png', detail: 'high' })
  })
})
