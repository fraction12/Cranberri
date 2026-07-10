import type { CodexUserInput } from './codex'

export type CodexWorkerControlAction = 'message' | 'resume' | 'stop'

const WORKER_CONTROL_PREFIX = '[Cranberri worker control request]'

export function buildCodexWorkerControlInput(
  workerThreadId: string,
  action: Exclude<CodexWorkerControlAction, 'stop'>,
  instruction: string,
  contextInput: CodexUserInput[] = [],
): CodexUserInput[] {
  const operation = action === 'resume'
    ? 'Resume the existing subagent with resume_agent and deliver the instruction below.'
    : 'Deliver the instruction below to the existing subagent. Use send_input if it is active; if it finished during this request, resume it instead.'
  return [{
    type: 'text',
    text: [
      WORKER_CONTROL_PREFIX,
      `Action: ${action}`,
      `Target subagent thread: ${workerThreadId}`,
      operation,
      'Do not spawn a replacement subagent. Continue coordinating and wait for this same subagent after delivering the instruction.',
      `Exact instruction JSON: ${JSON.stringify(instruction)}`,
    ].join('\n'),
  }, ...contextInput.filter((part) => part.type !== 'text')]
}

export function codexWorkerControlDisplayText(value: string): string {
  if (!value.startsWith(WORKER_CONTROL_PREFIX)) return value
  const action = value.match(/^Action: (message|resume)$/m)?.[1]
  const encodedInstruction = value.match(/^Exact instruction JSON: (.+)$/m)?.[1]
  if (!encodedInstruction) return value
  try {
    const instruction = JSON.parse(encodedInstruction) as unknown
    if (typeof instruction !== 'string') return value
    return `${action === 'resume' ? 'Resume worker' : 'Worker instruction'}: ${instruction}`
  } catch {
    return value
  }
}
