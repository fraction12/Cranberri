import { EventEmitter } from 'node:events'
import type {
  CodexAccountUsageReadResult,
  CodexEvent,
  CodexRateLimitsReadResult,
  CodexSessionSummary,
  CodexSessionThread,
  CodexTurnSettings,
  CodexUserInput,
  CodexWorker,
  CodexWorkerStatus,
} from '../../shared/codex'
import type { ToolEventRecord } from '../../shared/tools'
import type { CodexWorkerControlAction } from '../../shared/codex-worker-control'
import { createToolEventFromItem } from '../tools'

const FAKE_SHELL_SENTINEL = 'cranberri-shell-private-sentinel'

interface FakeThreadRecord {
  id: string
  sessionId: string
  parentThreadId?: string
  agentNickname?: string
  agentRole?: string
  status: CodexWorkerStatus
  title: string
  cwd: string
  createdAt: number
  updatedAt: number
  archived: boolean
  turns: CodexSessionThread['turns']
}

function firstText(input: CodexUserInput[]): string {
  return input.find((part): part is Extract<CodexUserInput, { type: 'text' }> => part.type === 'text')?.text ?? ''
}

function visualInputCount(input: CodexUserInput[]): number {
  return input.filter((part) => part.type === 'image' || part.type === 'localImage').length
}

function workerFromFakeThread(thread: FakeThreadRecord): CodexWorker | null {
  if (!thread.parentThreadId) return null
  return {
    threadId: thread.id,
    parentThreadId: thread.parentThreadId,
    sessionId: thread.sessionId,
    title: thread.title,
    nickname: thread.agentNickname,
    role: thread.agentRole,
    status: thread.status,
    cwd: thread.cwd,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
  }
}

function sessionSummary(thread: FakeThreadRecord, allThreads: Iterable<FakeThreadRecord>): CodexSessionSummary {
  const workers = [...allThreads]
    .filter((candidate) => candidate.parentThreadId === thread.id)
    .map(workerFromFakeThread)
    .filter((worker): worker is CodexWorker => Boolean(worker))
  return {
    id: thread.id,
    sessionId: thread.sessionId,
    parentThreadId: thread.parentThreadId,
    agentNickname: thread.agentNickname,
    agentRole: thread.agentRole,
    title: thread.title,
    preview: thread.turns.at(-1)?.items?.find((item) => item.type === 'userMessage')?.content?.map((part) => part.text).join('\n') ?? '',
    cwd: thread.cwd,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    archived: thread.archived,
    status: thread.parentThreadId
      ? thread.status === 'running' || thread.status === 'pendingInit'
        ? { type: 'active', activeFlags: [] }
        : thread.status === 'errored'
          ? { type: 'systemError' }
          : { type: 'idle' }
      : { type: 'idle' },
    turnCount: thread.turns.length,
    workers,
  }
}

function fakeToolEvent(threadId: string, turnId: string, status: 'running' | 'completed'): ToolEventRecord {
  return {
    eventId: `${threadId}:${turnId}:fake-tool:${status}`,
    threadId,
    toolCallId: `${turnId}-tool`,
    catalogId: 'codex:apply_patch',
    name: 'apply_patch',
    title: 'Apply patch',
    kind: 'file_change',
    status,
    timestamp: new Date().toISOString(),
    durationMs: status === 'completed' ? 42 : null,
  }
}

function fakeCommandEvent(threadId: string, turnId: string, status: 'running' | 'completed'): ToolEventRecord {
  const event = createToolEventFromItem(threadId, {
    type: 'commandExecution',
    id: `${turnId}-command`,
    command: `rg ${FAKE_SHELL_SENTINEL}`,
    status,
    exitCode: status === 'completed' ? 0 : undefined,
    durationMs: status === 'completed' ? 31 : null,
  }, status === 'running' ? 'started' : 'completed')
  if (!event) throw new Error('Fake command event did not normalize')
  return event
}

function fakeApproval(threadId: string, turnId: string): CodexEvent {
  return {
    type: 'approval_request',
    threadId,
    approval: {
      id: `${turnId}-approval`,
      reviewId: `${turnId}-review`,
      targetItemId: `${turnId}-tool`,
      action: { type: 'tool', server: 'fake_codex', tool: 'install_dependency' },
      review: { reviewId: `${turnId}-review`, status: 'pending' },
      description: 'Install fake smoke dependency',
    },
  }
}

function fakeWorkerEvent(parentThreadId: string, worker: FakeThreadRecord, message?: string): CodexEvent {
  return {
    type: 'worker_updated',
    threadId: parentThreadId,
    worker: {
      ...workerFromFakeThread(worker)!,
      message,
      updatedAt: Date.now(),
    },
  }
}

export class FakeCodexClient extends EventEmitter {
  private cwd: string
  private nextThread = 1
  private nextTurn = 1
  private readonly threads = new Map<string, FakeThreadRecord>()
  private readonly workerTimers = new Map<string, NodeJS.Timeout>()

  constructor(cwd: string) {
    super()
    this.cwd = cwd
  }

  async start(): Promise<void> {}

  stop(): void {
    for (const timer of this.workerTimers.values()) clearTimeout(timer)
    this.workerTimers.clear()
  }

  setCwd(cwd: string): void {
    this.cwd = cwd
  }

  async createThread(cwd?: string, _settings?: CodexTurnSettings): Promise<{ id: string; name?: string | null }> {
    if (cwd) this.cwd = cwd
    const id = `fake-thread-${this.nextThread++}`
    const now = Date.now()
    const thread: FakeThreadRecord = {
      id,
      sessionId: `fake-session-${id}`,
      status: 'completed',
      title: 'Smoke Codex Thread',
      cwd: this.cwd,
      createdAt: now,
      updatedAt: now,
      archived: false,
      turns: [],
    }
    this.threads.set(id, thread)
    this.emit('event', { type: 'thread_name_updated', threadId: id, title: thread.title } satisfies CodexEvent)
    return { id, name: thread.title }
  }

  async sendMessage(threadId: string, input: CodexUserInput[], settings?: CodexTurnSettings): Promise<void> {
    const thread = this.requireThread(threadId)
    const turnId = `fake-turn-${this.nextTurn++}`
    const itemId = `${turnId}-assistant`
    const userText = firstText(input)
    if (userText.includes('cranberri-smoke-reject-turn')) {
      throw new Error('Fake Codex rejected turn')
    }
    const visualCount = visualInputCount(input)
    const visualLine = visualCount > 0 ? `\nlocal-images:${visualCount}` : ''
    const settingsLine = userText.includes('cranberri-model-settings-smoke')
      ? `\nsettings:${settings?.model ?? 'default'}|${settings?.effort ?? 'default'}|${settings?.speed ?? 'default'}`
      : ''
    const response = `Fake Codex received: ${userText || 'empty message'}${visualLine}${settingsLine}\ncranberri-fake-codex-stream-complete`
    thread.updatedAt = Date.now()
    thread.turns.push({
      id: turnId,
      startedAt: thread.updatedAt / 1000,
      completedAt: null,
      status: 'running',
      items: [
        {
          id: `${turnId}-user`,
          type: 'userMessage',
          content: [{ type: 'text', text: userText }],
        },
      ],
    })

    if (thread.parentThreadId) {
      thread.status = 'running'
      this.emit('event', fakeWorkerEvent(thread.parentThreadId, thread, 'Working on new instruction'))
    }

    this.emit('event', { type: 'run_start', threadId } satisfies CodexEvent)
    this.emit('event', { type: 'item_started', threadId, itemId, itemType: 'agentMessage' } satisfies CodexEvent)
    this.emit('event', { type: 'tool_event', threadId, event: fakeToolEvent(threadId, turnId, 'running') } satisfies CodexEvent)
    this.emit('event', { type: 'tool_event', threadId, event: fakeCommandEvent(threadId, turnId, 'running') } satisfies CodexEvent)
    if (userText.includes('cranberri-approval-smoke-request')) {
      setTimeout(() => {
        this.emit('event', fakeApproval(threadId, turnId))
      }, 15)
    }
    if (userText.includes('cranberri-worker-smoke')) {
      this.spawnFakeWorker(thread, turnId)
    }
    const chunks = ['Fake Codex received: ', userText || 'empty message', visualLine, settingsLine, '\ncranberri-fake-codex-stream-complete']
    chunks.forEach((delta, index) => {
      setTimeout(() => {
        this.emit('event', { type: 'agent_message_delta', threadId, itemId, delta, phase: 'final_answer' } satisfies CodexEvent)
      }, 10 + index * 20)
    })
    setTimeout(() => {
      const turn = thread.turns.at(-1)
      if (turn) {
        turn.completedAt = Date.now() / 1000
        turn.durationMs = 80
        turn.status = 'completed'
        turn.items = [
          ...(turn.items ?? []),
          { id: itemId, type: 'agentMessage', text: response, phase: 'final_answer' },
        ]
      }
      this.emit('event', { type: 'agent_message_completed', threadId, itemId, text: response, phase: 'final_answer' } satisfies CodexEvent)
      this.emit('event', { type: 'tool_event', threadId, event: fakeToolEvent(threadId, turnId, 'completed') } satisfies CodexEvent)
      this.emit('event', { type: 'tool_event', threadId, event: fakeCommandEvent(threadId, turnId, 'completed') } satisfies CodexEvent)
      this.emit('event', { type: 'context_usage', threadId, usedTokens: 128, contextWindow: 258400 } satisfies CodexEvent)
      this.emit('event', { type: 'final_answer', threadId, text: response } satisfies CodexEvent)
      if (thread.parentThreadId) {
        thread.status = 'completed'
        thread.updatedAt = Date.now()
        this.emit('event', fakeWorkerEvent(thread.parentThreadId, thread, 'Instruction complete'))
      }
      this.emit('event', { type: 'run_end', threadId } satisfies CodexEvent)
    }, 100)
  }

  async steerThread(threadId: string, input: CodexUserInput[]): Promise<void> {
    const worker = this.requireThread(threadId)
    if (!worker.parentThreadId) throw new Error('Only fake workers can be steered.')
    if (worker.status !== 'running' && worker.status !== 'pendingInit') {
      throw new Error('This fake worker does not have an active turn to steer.')
    }
    const instruction = firstText(input)
    const turn = worker.turns.at(-1)
    if (turn) {
      turn.items = [
        ...(turn.items ?? []),
        {
          id: `${turn.id}-steer-${Date.now()}`,
          type: 'userMessage',
          content: [{ type: 'text', text: instruction }],
        },
      ]
    }
    worker.updatedAt = Date.now()
    this.emit('event', fakeWorkerEvent(worker.parentThreadId, worker, `Steered: ${instruction}`))
  }

  async controlWorker(
    parentThreadId: string,
    workerThreadId: string,
    action: CodexWorkerControlAction,
    input: CodexUserInput[],
  ): Promise<void> {
    const worker = this.requireThread(workerThreadId)
    if (worker.parentThreadId !== parentThreadId) throw new Error('Fake worker is not attached to this parent.')
    if (action === 'stop') {
      await this.interrupt(workerThreadId)
      return
    }
    if (action === 'message' && (worker.status === 'running' || worker.status === 'pendingInit')) {
      await this.steerThread(workerThreadId, input)
      return
    }
    await this.sendMessage(workerThreadId, input)
  }

  async runOneShot(cwd: string, content: string, _settings?: CodexTurnSettings, _timeoutMs?: number): Promise<string> {
    this.cwd = cwd
    if (content.includes('"title"') && content.includes('"summary"') && content.includes('Git status:')) {
      return JSON.stringify({
        title: 'chore(git): draft smoke commit',
        summary: 'Generated by the fake Codex client for commit draft smoke coverage.',
      })
    }
    return `Fake Codex received: ${content || 'empty message'}\ncranberri-fake-codex-stream-complete`
  }

  async compactThread(threadId: string): Promise<void> {
    this.requireThread(threadId)
    this.emit('event', { type: 'context_compaction', threadId, state: 'started' } satisfies CodexEvent)
    setTimeout(() => {
      this.emit('event', { type: 'context_compaction', threadId, state: 'completed' } satisfies CodexEvent)
    }, 25)
  }

  async listThreads(cwd: string, options: { archived?: boolean } = {}): Promise<{ sessions: CodexSessionSummary[]; nextCursor: null; backwardsCursor: null }> {
    this.cwd = cwd
    const archived = options.archived ?? false
    return {
      sessions: [...this.threads.values()]
        .filter((thread) => thread.archived === archived && !thread.parentThreadId)
        .map((thread) => sessionSummary(thread, this.threads.values())),
      nextCursor: null,
      backwardsCursor: null,
    }
  }

  async readThread(threadId: string, archived = false): Promise<CodexSessionThread> {
    const thread = this.requireThread(threadId)
    return { ...sessionSummary(thread, this.threads.values()), archived, turns: thread.turns }
  }

  async resumeThread(threadId: string, cwd?: string, _settings?: CodexTurnSettings): Promise<CodexSessionThread> {
    if (cwd) this.cwd = cwd
    return this.readThread(threadId)
  }

  async archiveThread(threadId: string): Promise<void> {
    this.requireThread(threadId).archived = true
  }

  async unarchiveThread(threadId: string): Promise<CodexSessionThread> {
    this.requireThread(threadId).archived = false
    return this.readThread(threadId)
  }

  async deleteThread(threadId: string): Promise<void> {
    this.threads.delete(threadId)
  }

  async setThreadName(threadId: string, name: string): Promise<void> {
    const thread = this.requireThread(threadId)
    thread.title = name
    this.emit('event', { type: 'thread_name_updated', threadId, title: name } satisfies CodexEvent)
  }

  async approve(event: unknown, threadId: string): Promise<void> {
    this.requireThread(threadId)
    const reviewId = event && typeof event === 'object' && 'reviewId' in event && typeof event.reviewId === 'string'
      ? event.reviewId
      : ''
    if (reviewId) {
      this.emit('event', { type: 'approval_completed', threadId, reviewId, action: 'approved' } satisfies CodexEvent)
    }
    this.emit('event', { type: 'run_end', threadId } satisfies CodexEvent)
  }

  async interrupt(threadId: string): Promise<void> {
    const thread = this.requireThread(threadId)
    const timer = this.workerTimers.get(threadId)
    if (timer) clearTimeout(timer)
    this.workerTimers.delete(threadId)
    thread.status = 'interrupted'
    thread.updatedAt = Date.now()
    if (thread.parentThreadId) this.emit('event', fakeWorkerEvent(thread.parentThreadId, thread, 'Stopped by user'))
    this.emit('event', { type: 'run_end', threadId, error: 'Interrupted' } satisfies CodexEvent)
  }

  async getRateLimits(): Promise<CodexRateLimitsReadResult> {
    return {
      rateLimits: fakeRateLimit('fake'),
      rateLimitsByLimitId: { fake: fakeRateLimit('fake') },
      rateLimitResetCredits: { availableCount: 0 },
    }
  }

  async getAccountUsage(): Promise<CodexAccountUsageReadResult> {
    return {
      summary: {
        lifetimeTokens: 1234567,
        peakDailyTokens: 345678,
        longestRunningTurnSec: 912,
        currentStreakDays: 3,
        longestStreakDays: 8,
      },
      dailyUsageBuckets: [
        { startDate: '2026-07-06', tokens: 12345 },
        { startDate: '2026-07-07', tokens: 98765 },
        { startDate: '2026-07-08', tokens: 45678 },
      ],
    }
  }

  async consumeRateLimitResetCredit(_idempotencyKey: string): Promise<{ outcome: string }> {
    return { outcome: 'unavailable' }
  }

  async listApps(): Promise<unknown> {
    return {
      data: [{
        id: 'fake-smoke-app',
        name: 'Fake Smoke App',
        description: 'Deterministic app registry entry for packaged smoke coverage',
        logoUrl: null,
        isEnabled: true,
        isAccessible: true,
        distributionChannel: 'fake',
        pluginDisplayNames: ['Fake Smoke Plugin'],
      }],
    }
  }

  async listMcpServerStatus(): Promise<unknown> {
    return {
      data: [{
        name: 'fake-smoke-mcp',
        authStatus: 'available',
        tools: {
          inspect_fixture: {
            name: 'inspect_fixture',
            title: 'Inspect fake smoke fixture',
            description: 'Reads deterministic smoke fixture metadata',
          },
        },
        resources: [],
        resourceTemplates: [],
      }],
    }
  }

  private requireThread(threadId: string): FakeThreadRecord {
    const thread = this.threads.get(threadId)
    if (!thread) throw new Error(`Fake Codex thread not found: ${threadId}`)
    return thread
  }

  private spawnFakeWorker(parent: FakeThreadRecord, parentTurnId: string): void {
    const id = `fake-worker-${this.nextThread++}`
    const now = Date.now()
    const workerTurnId = `fake-worker-turn-${this.nextTurn++}`
    const worker: FakeThreadRecord = {
      id,
      sessionId: parent.sessionId,
      parentThreadId: parent.id,
      agentNickname: 'Euclid',
      agentRole: 'explorer',
      status: 'pendingInit',
      title: 'Inspect worker smoke fixture',
      cwd: parent.cwd,
      createdAt: now,
      updatedAt: now,
      archived: false,
      turns: [{
        id: workerTurnId,
        startedAt: now / 1000,
        completedAt: null,
        status: 'inProgress',
        items: [{
          id: `${workerTurnId}-prompt`,
          type: 'userMessage',
          content: [{ type: 'text', text: 'Inspect the fake worker smoke fixture.' }],
        }],
      }],
    }
    this.threads.set(id, worker)
    const parentTurn = parent.turns.find((turn) => turn.id === parentTurnId)
    if (parentTurn) {
      parentTurn.items = [
        ...(parentTurn.items ?? []),
        {
          id: `${parentTurnId}-spawn-worker`,
          type: 'collabAgentToolCall',
          tool: 'spawnAgent',
          status: 'completed',
          senderThreadId: parent.id,
          receiverThreadIds: [worker.id],
          prompt: 'Inspect the fake worker smoke fixture.',
          model: 'gpt-5.6-terra',
          reasoningEffort: 'high',
          agentsStates: { [worker.id]: { status: 'running', message: null } },
        },
      ]
    }
    this.emit('event', fakeWorkerEvent(parent.id, worker, 'Starting'))
    worker.status = 'running'
    worker.updatedAt = Date.now()
    this.emit('event', { type: 'run_start', threadId: worker.id } satisfies CodexEvent)
    this.emit('event', fakeWorkerEvent(parent.id, worker, 'Inspecting fixture'))

    const timer = setTimeout(() => {
      const activeWorker = this.threads.get(worker.id)
      if (!activeWorker || activeWorker.status !== 'running') return
      const turn = activeWorker.turns.at(-1)
      const response = 'Fake worker completed the fixture inspection.'
      if (turn) {
        turn.completedAt = Date.now() / 1000
        turn.durationMs = 1_500
        turn.status = 'completed'
        turn.items = [
          ...(turn.items ?? []),
          { id: `${turn.id}-assistant`, type: 'agentMessage', text: response, phase: 'final_answer' },
        ]
      }
      activeWorker.status = 'completed'
      activeWorker.updatedAt = Date.now()
      this.emit('event', {
        type: 'agent_message_completed',
        threadId: activeWorker.id,
        itemId: `${turn?.id ?? workerTurnId}-assistant`,
        text: response,
        phase: 'final_answer',
      } satisfies CodexEvent)
      this.emit('event', fakeWorkerEvent(parent.id, activeWorker, 'Fixture inspection complete'))
      this.emit('event', { type: 'run_end', threadId: activeWorker.id } satisfies CodexEvent)
      this.workerTimers.delete(activeWorker.id)
    }, 5_000)
    this.workerTimers.set(worker.id, timer)
  }
}

function fakeRateLimit(limitId: string): CodexRateLimitsReadResult['rateLimits'] {
  const nowSeconds = Math.floor(Date.now() / 1000)
  return {
    limitId,
    limitName: 'Fake smoke limit',
    primary: {
      usedPercent: 0,
      windowDurationMins: 300,
      resetsAt: nowSeconds + 300 * 60,
    },
    secondary: {
      usedPercent: 0,
      windowDurationMins: 10080,
      resetsAt: nowSeconds + 10080 * 60,
    },
    credits: null,
    individualLimit: null,
    planType: 'smoke',
    rateLimitReachedType: null,
  }
}
