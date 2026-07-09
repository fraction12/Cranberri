import { EventEmitter } from 'node:events'
import type {
  CodexAccountUsageReadResult,
  CodexEvent,
  CodexRateLimitsReadResult,
  CodexSessionSummary,
  CodexSessionThread,
  CodexTurnSettings,
  CodexUserInput,
} from '../../shared/codex'
import type { ToolEventRecord } from '../../shared/tools'

interface FakeThreadRecord {
  id: string
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

function sessionSummary(thread: FakeThreadRecord): CodexSessionSummary {
  return {
    id: thread.id,
    title: thread.title,
    preview: thread.turns.at(-1)?.items?.find((item) => item.type === 'userMessage')?.content?.map((part) => part.text).join('\n') ?? '',
    cwd: thread.cwd,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    archived: thread.archived,
    turnCount: thread.turns.length,
  }
}

function fakeToolEvent(threadId: string, turnId: string, status: 'running' | 'completed', userText: string): ToolEventRecord {
  return {
    eventId: `${threadId}:${turnId}:fake-tool:${status}`,
    threadId,
    toolCallId: `${turnId}-tool`,
    name: 'fake_codex.inspect_repo',
    title: 'Fake smoke tool',
    kind: 'dynamic',
    status,
    timestamp: new Date().toISOString(),
    argumentsPreview: JSON.stringify({ query: userText || 'empty message' }),
    resultPreview: status === 'completed' ? 'cranberri-fake-tool-complete' : 'Inspecting repo fixture',
    durationMs: status === 'completed' ? 42 : null,
  }
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

export class FakeCodexClient extends EventEmitter {
  private cwd: string
  private nextThread = 1
  private nextTurn = 1
  private readonly threads = new Map<string, FakeThreadRecord>()

  constructor(cwd: string) {
    super()
    this.cwd = cwd
  }

  async start(): Promise<void> {}

  stop(): void {}

  setCwd(cwd: string): void {
    this.cwd = cwd
  }

  async createThread(cwd?: string, _settings?: CodexTurnSettings): Promise<{ id: string; name?: string | null }> {
    if (cwd) this.cwd = cwd
    const id = `fake-thread-${this.nextThread++}`
    const now = Date.now()
    const thread: FakeThreadRecord = {
      id,
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

    this.emit('event', { type: 'run_start', threadId } satisfies CodexEvent)
    this.emit('event', { type: 'item_started', threadId, itemId, itemType: 'agentMessage' } satisfies CodexEvent)
    this.emit('event', { type: 'tool_event', threadId, event: fakeToolEvent(threadId, turnId, 'running', userText) } satisfies CodexEvent)
    if (userText.includes('cranberri-approval-smoke-request')) {
      setTimeout(() => {
        this.emit('event', fakeApproval(threadId, turnId))
      }, 15)
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
      this.emit('event', { type: 'tool_event', threadId, event: fakeToolEvent(threadId, turnId, 'completed', userText) } satisfies CodexEvent)
      this.emit('event', { type: 'context_usage', threadId, usedTokens: 128, contextWindow: 258400 } satisfies CodexEvent)
      this.emit('event', { type: 'final_answer', threadId, text: response } satisfies CodexEvent)
      this.emit('event', { type: 'run_end', threadId } satisfies CodexEvent)
    }, 100)
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
      sessions: [...this.threads.values()].filter((thread) => thread.archived === archived).map(sessionSummary),
      nextCursor: null,
      backwardsCursor: null,
    }
  }

  async readThread(threadId: string, archived = false): Promise<CodexSessionThread> {
    const thread = this.requireThread(threadId)
    return { ...sessionSummary(thread), archived, turns: thread.turns }
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
    this.requireThread(threadId)
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
