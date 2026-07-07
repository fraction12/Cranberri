import { spawn, ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import type { CodexEvent, CodexSessionSummary, CodexSessionThread, CodexSdkTurn, CodexTurnSettings, CodexRateLimitsReadResult, CodexAccountUsageReadResult, CodexUserInput } from '../../shared/codex'

interface JsonRpcRequest {
  jsonrpc: '2.0'
  id: number
  method: string
  params?: Record<string, unknown>
}

interface JsonRpcResponse {
  jsonrpc: '2.0'
  id?: number
  result?: unknown
  error?: { code: number; message: string }
}

interface JsonRpcNotification {
  jsonrpc: '2.0'
  method: string
  params?: Record<string, unknown>
}

interface Thread {
  id: string
  name?: string | null
}

interface SdkThread {
  id: string
  sessionId?: string
  name?: string | null
  preview?: string
  cwd?: string | { path?: string } | null
  createdAt?: number
  updatedAt?: number
  recencyAt?: number | null
  status?: unknown
  path?: string | null
  turns?: CodexSdkTurn[]
}

function cwdToString(cwd: SdkThread['cwd']): string | undefined {
  if (typeof cwd === 'string') return cwd
  if (cwd && typeof cwd === 'object' && typeof cwd.path === 'string') return cwd.path
  return undefined
}

function normalizeThread(thread: SdkThread, archived: boolean): CodexSessionThread {
  const preview = thread.preview ?? ''
  return {
    id: thread.id,
    sessionId: thread.sessionId,
    title: thread.name ?? preview.split('\n')[0] ?? 'Untitled session',
    preview,
    cwd: cwdToString(thread.cwd),
    createdAt: thread.createdAt ?? 0,
    updatedAt: thread.updatedAt ?? thread.createdAt ?? 0,
    recencyAt: thread.recencyAt,
    archived,
    status: thread.status,
    path: thread.path,
    turnCount: thread.turns?.length ?? 0,
    turns: thread.turns ?? [],
  }
}

function getTurnApprovalSettings(mode: CodexTurnSettings['approvalMode']): { approvalPolicy?: string; sandboxPolicy?: { type: string } } {
  switch (mode) {
    case 'ask':
      return { approvalPolicy: 'on-request', sandboxPolicy: { type: 'workspaceWrite' } }
    case 'approve':
      return { approvalPolicy: 'on-failure', sandboxPolicy: { type: 'workspaceWrite' } }
    case 'full':
      return { approvalPolicy: 'never', sandboxPolicy: { type: 'dangerFullAccess' } }
    case 'custom':
    default:
      return {}
  }
}

function getThreadApprovalSettings(mode: CodexTurnSettings['approvalMode']): { approvalPolicy?: string; sandbox?: { type: string } } {
  switch (mode) {
    case 'ask':
      return { approvalPolicy: 'on-request', sandbox: { type: 'workspaceWrite' } }
    case 'approve':
      return { approvalPolicy: 'on-failure', sandbox: { type: 'workspaceWrite' } }
    case 'full':
      return { approvalPolicy: 'never', sandbox: { type: 'dangerFullAccess' } }
    case 'custom':
    default:
      return {}
  }
}

function speedToServiceTier(speed: CodexTurnSettings['speed']): string | undefined {
  // serviceTier is the app-server knob closest to a speed preference.
  // 'flex' is the OpenAI flex tier (slower/cheaper); everything else uses the default tier.
  if (speed === 'fast') return undefined
  if (speed === 'standard') return 'flex'
  return undefined
}

export class CodexClient extends EventEmitter {
  private process: ChildProcess | null = null
  private nextId = 1
  private pending = new Map<number, (res: JsonRpcResponse) => void>()
  private buffer = ''
  private cwd: string
  private startPromise: Promise<void> | null = null
  private activeRunThreads = new Set<string>()
  private currentTurnIdByThread = new Map<string, string>()
  private pendingApprovalsByThread = new Map<string, boolean>()

  constructor(cwd: string) {
    super()
    this.cwd = cwd
  }

  setCwd(cwd: string): void {
    this.cwd = cwd
  }

  async start(): Promise<void> {
    if (this.process && !this.startPromise) return
    if (this.startPromise) return this.startPromise

    this.startPromise = this.startProcess()
    try {
      await this.startPromise
    } finally {
      this.startPromise = null
    }
  }

  private async startProcess(): Promise<void> {
    this.process = spawn('codex', ['app-server', '--stdio'], {
      cwd: this.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
    })

    return new Promise<void>((resolve, reject) => {
      this.process?.on('spawn', () => {
        resolve()
      })

      this.process?.on('error', (err) => {
        this.process = null
        this.startPromise = null
        reject(err)
      })

      this.process?.stdout?.on('data', (data: Buffer) => this.onData(data))
      this.process?.stderr?.on('data', (data: Buffer) => {
        const text = data.toString('utf8').trim()
        if (text) this.emit('event', { type: 'log', level: 'stderr', text } as CodexEvent)
      })

      this.process?.on('exit', (code) => {
        this.emitRunEnd('', `Codex app-server exited with code ${code ?? 'unknown'}`)
        this.process = null
        this.startPromise = null
      })
    }).then(async () => {
      await this.call('initialize', { clientInfo: { name: 'cranberri', version: '0.1.0' } })
    })
  }

  stop(): void {
    this.process?.kill('SIGTERM')
    this.process = null
    this.startPromise = null
  }

  async createThread(cwd?: string, settings?: CodexTurnSettings): Promise<Thread> {
    if (cwd) this.cwd = cwd
    const approvalSettings = getThreadApprovalSettings(settings?.approvalMode)
    const res = await this.call('thread/start', { cwd: this.cwd, ...approvalSettings })
    const thread = (res.result as { thread: Thread } | undefined)?.thread
    if (!thread?.id) {
      throw new Error('thread/start did not return a thread id')
    }
    if (thread.name) {
      this.emit('event', { type: 'thread_name_updated', threadId: thread.id, title: thread.name } as CodexEvent)
    }
    return thread
  }

  async sendMessage(threadId: string, input: CodexUserInput[], settings?: CodexTurnSettings): Promise<void> {
    const approvalSettings = getTurnApprovalSettings(settings?.approvalMode)
    const serviceTier = speedToServiceTier(settings?.speed)
    const res = await this.call('turn/start', {
      threadId,
      input,
      model: settings?.model ?? null,
      effort: settings?.effort ?? null,
      ...(serviceTier !== undefined ? { serviceTier } : {}),
      ...approvalSettings,
    })
    const turnId = (res.result as { turn?: { id?: string } } | undefined)?.turn?.id
    if (turnId) this.currentTurnIdByThread.set(threadId, turnId)
  }

  async compactThread(threadId: string): Promise<void> {
    await this.call('thread/compact/start', { threadId })
  }

  async runOneShot(cwd: string, content: string, settings?: CodexTurnSettings, timeoutMs = 120_000): Promise<string> {
    const thread = await this.createThread(cwd)
    return new Promise((resolve, reject) => {
      let finalText = ''
      const timeout = setTimeout(() => {
        cleanup()
        reject(new Error('Codex commit message generation timed out'))
      }, timeoutMs)

      const cleanup = () => {
        clearTimeout(timeout)
        this.off('event', onEvent)
      }

      const onEvent = (event: CodexEvent) => {
        if ('threadId' in event && event.threadId !== thread.id) return
        if (event.type === 'final_answer') {
          finalText = event.text
          cleanup()
          resolve(finalText)
          return
        }
        if (event.type === 'agent_message_completed' && event.text) {
          finalText = event.text
        }
        if (event.type === 'run_end' && event.error) {
          cleanup()
          reject(new Error(event.error))
        }
      }

      this.on('event', onEvent)
      this.sendMessage(thread.id, [{ type: 'text', text: content }], settings).catch((err: unknown) => {
        cleanup()
        reject(err)
      })
    })
  }

  async listThreads(cwd: string, options: { archived?: boolean; cursor?: string | null; limit?: number; searchTerm?: string | null } = {}): Promise<{ sessions: CodexSessionSummary[]; nextCursor?: string | null; backwardsCursor?: string | null }> {
    this.cwd = cwd
    const archived = options.archived ?? false
    const res = await this.call('thread/list', {
      cwd,
      archived,
      cursor: options.cursor ?? null,
      limit: options.limit ?? 50,
      searchTerm: options.searchTerm ?? null,
      sortKey: 'recency_at',
      sortDirection: 'desc',
    })
    const result = res.result as { data?: SdkThread[]; nextCursor?: string | null; backwardsCursor?: string | null } | undefined
    return {
      sessions: (result?.data ?? []).map((thread) => normalizeThread(thread, archived)),
      nextCursor: result?.nextCursor,
      backwardsCursor: result?.backwardsCursor,
    }
  }

  async readThread(threadId: string, archived = false): Promise<CodexSessionThread> {
    const res = await this.call('thread/read', { threadId, includeTurns: true })
    const thread = (res.result as { thread?: SdkThread } | undefined)?.thread
    if (!thread?.id) throw new Error('thread/read did not return a thread')
    return normalizeThread(thread, archived)
  }

  async resumeThread(threadId: string, cwd?: string, settings?: CodexTurnSettings): Promise<CodexSessionThread> {
    if (cwd) this.cwd = cwd
    const approvalSettings = getTurnApprovalSettings(settings?.approvalMode)
    const res = await this.call('thread/resume', {
      threadId,
      cwd: this.cwd,
      model: settings?.model ?? null,
      ...approvalSettings,
    })
    const thread = (res.result as { thread?: SdkThread } | undefined)?.thread
    if (!thread?.id) throw new Error('thread/resume did not return a thread')
    return normalizeThread(thread, false)
  }

  async archiveThread(threadId: string): Promise<void> {
    await this.call('thread/archive', { threadId })
  }

  async unarchiveThread(threadId: string): Promise<CodexSessionThread> {
    const res = await this.call('thread/unarchive', { threadId })
    const thread = (res.result as { thread?: SdkThread } | undefined)?.thread
    if (!thread?.id) throw new Error('thread/unarchive did not return a thread')
    return normalizeThread(thread, false)
  }

  async deleteThread(threadId: string): Promise<void> {
    await this.call('thread/delete', { threadId })
  }

  async setThreadName(threadId: string, name: string): Promise<void> {
    await this.call('thread/name/set', { threadId, name })
  }

  async getRateLimits(): Promise<CodexRateLimitsReadResult> {
    const res = await this.call('account/rateLimits/read', {})
    return res.result as CodexRateLimitsReadResult
  }

  async getAccountUsage(): Promise<CodexAccountUsageReadResult> {
    const res = await this.call('account/usage/read', {})
    return res.result as CodexAccountUsageReadResult
  }

  async consumeRateLimitResetCredit(idempotencyKey: string): Promise<{ outcome: string }> {
    const res = await this.call('account/rateLimitResetCredit/consume', { idempotencyKey })
    return res.result as { outcome: string }
  }

  async approve(event: unknown, threadId: string): Promise<void> {
    await this.call('thread/approveGuardianDeniedAction', { threadId, event })
  }

  async interrupt(threadId: string): Promise<void> {
    const turnId = this.currentTurnIdByThread.get(threadId)
    if (!turnId) {
      console.warn(`[codex] turn/interrupt called for thread ${threadId} without a known turnId`)
    }
    await this.call('turn/interrupt', { threadId, turnId: turnId ?? null })
  }

  /** @deprecated use interrupt() */
  async abort(threadId: string): Promise<void> {
    await this.interrupt(threadId)
  }

  private onData(data: Buffer): void {
    this.buffer += data.toString('utf8')
    const lines = this.buffer.split('\n')
    this.buffer = lines.pop() ?? ''
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        const msg = JSON.parse(trimmed) as JsonRpcResponse | JsonRpcNotification
        this.handleMessage(msg)
      } catch {
        this.emit('event', { type: 'log', level: 'parse-error', text: trimmed } as CodexEvent)
      }
    }
  }

  private emitRunStart(threadId: string): void {
    if (threadId) this.activeRunThreads.add(threadId)
    this.emit('event', { type: 'run_start', threadId } as CodexEvent)
  }

  private emitRunEnd(threadId: string, error?: string): void {
    if (threadId) {
      if (!this.activeRunThreads.has(threadId) && !error) return
      this.activeRunThreads.delete(threadId)
    }
    this.emit('event', { type: 'run_end', threadId, error } as CodexEvent)
  }

  private handleMessage(msg: JsonRpcResponse | JsonRpcNotification): void {
    if ('id' in msg && msg.id !== undefined) {
      const resolve = this.pending.get(msg.id)
      if (resolve) {
        resolve(msg as JsonRpcResponse)
        this.pending.delete(msg.id)
      }
      return
    }

    if (!('method' in msg)) return
    const n = msg as JsonRpcNotification
    const params = n.params ?? {}
    const threadId = (params.threadId as string | undefined) ?? ''
    const method = n.method

    switch (method) {
      case 'thread/name/updated': {
        const title = (params as { threadName?: string }).threadName ?? (params as { name?: string }).name ?? 'New thread'
        this.emit('event', { type: 'thread_name_updated', threadId, title } as CodexEvent)
        break
      }
      case 'thread/status/changed': {
        const status = params.status as { type?: string; activeFlags?: string[] } | undefined
        if (status?.type === 'active') {
          this.emitRunStart(threadId)
          if (status?.activeFlags?.includes('waitingOnApproval')) {
            // Only emit a placeholder if we don't already have a real guardian approval pending.
            // This avoids creating an actionable approval card with an empty event.
            const hasRealApproval = this.pendingApprovalsByThread.get(threadId) ?? false
            if (!hasRealApproval) {
              this.emit('event', { type: 'approval_request', threadId, approval: { id: crypto.randomUUID(), reviewId: '', action: {}, review: {}, description: 'Waiting on approval' } } as CodexEvent)
            }
          }
        } else if (status?.type === 'idle') {
          this.emitRunEnd(threadId)
        }
        break
      }
      case 'turn/started': {
        const turnId = (params as { turn?: { id?: string } }).turn?.id
        if (turnId) this.currentTurnIdByThread.set(threadId, turnId)
        this.emitRunStart(threadId)
        break
      }
      case 'agent_message': {
        const message = (params as { message?: string }).message ?? ''
        const phase = (params as { phase?: string }).phase
        if (message) {
          this.emit('event', { type: 'agent_message_completed', threadId, itemId: crypto.randomUUID(), text: message, phase } as CodexEvent)
        }
        break
      }
      case 'task_complete': {
        const text = (params as { last_agent_message?: string }).last_agent_message ?? ''
        if (text) this.emit('event', { type: 'final_answer', threadId, text } as CodexEvent)
        this.emitRunEnd(threadId)
        break
      }
      case 'turn/completed': {
        const error = (params as { turn?: { error?: { message?: string } } }).turn?.error?.message
        this.emitRunEnd(threadId, error)
        break
      }
      case 'token_count':
      case 'codex/token_count': {
        const info = (params as { info?: { last_token_usage?: { total_tokens?: number }; model_context_window?: number } }).info
        const usedTokens = info?.last_token_usage?.total_tokens
        const contextWindow = info?.model_context_window
        if (usedTokens !== undefined && contextWindow) {
          this.emit('event', { type: 'context_usage', threadId, usedTokens, contextWindow } as CodexEvent)
        }
        break
      }
      case 'thread/tokenUsage/updated': {
        const tokenUsage = (params as { tokenUsage?: { last?: { totalTokens?: number }; modelContextWindow?: number } }).tokenUsage
        const usedTokens = tokenUsage?.last?.totalTokens
        const contextWindow = tokenUsage?.modelContextWindow
        if (usedTokens !== undefined && contextWindow) {
          this.emit('event', { type: 'context_usage', threadId, usedTokens, contextWindow } as CodexEvent)
        }
        break
      }
      case 'item/started': {
        const item = (params as { item?: { id?: string; type?: string } }).item
        const itemType = item?.type ?? 'unknown'
        this.emit('event', { type: 'item_started', threadId, itemId: item?.id, itemType } as CodexEvent)
        if (itemType === 'contextCompaction') {
          this.emit('event', { type: 'context_compaction', threadId, state: 'started' } as CodexEvent)
        }
        break
      }
      case 'context_compacted':
      case 'thread/compacted': {
        this.emit('event', { type: 'context_compaction', threadId, state: 'completed' } as CodexEvent)
        break
      }
      case 'warning': {
        const text = (params as { message?: string }).message ?? ''
        if (text) this.emit('event', { type: 'log', level: 'warning', text } as CodexEvent)
        break
      }
      case 'context/summary/started':
      case 'context/compaction/started': {
        this.emit('event', { type: 'context_compaction', threadId, state: 'started' } as CodexEvent)
        break
      }
      case 'context/summary/completed':
      case 'context/compaction/completed': {
        this.emit('event', { type: 'context_compaction', threadId, state: 'completed' } as CodexEvent)
        break
      }
      case 'context/summary/failed':
      case 'context/compaction/failed': {
        const message = (params as { message?: string }).message ?? ''
        this.emit('event', { type: 'context_compaction', threadId, state: 'failed', message } as CodexEvent)
        break
      }
      case 'item/agentMessage/delta': {
        const itemId = (params as { itemId?: string }).itemId
        const delta = (params as { delta?: string }).delta ?? ''
        const phase = (params as { item?: { phase?: string } }).item?.phase
        if (itemId && delta) this.emit('event', { type: 'agent_message_delta', threadId, itemId, delta, phase } as CodexEvent)
        break
      }
      case 'item/reasoning/textDelta': {
        const itemId = (params as { itemId?: string }).itemId
        const delta = (params as { delta?: string }).delta ?? ''
        if (itemId && delta) this.emit('event', { type: 'agent_message_delta', threadId, itemId, delta, phase: 'commentary' } as CodexEvent)
        break
      }
      case 'item/commandExecution/outputDelta': {
        const text = (params as { output?: string }).output ?? ''
        if (text) this.emit('event', { type: 'log', level: 'command-output', text } as CodexEvent)
        break
      }
      case 'item/completed': {
        const item = (params as { item?: { id?: string; type?: string; text?: string; phase?: string } }).item
        if (item?.type === 'contextCompaction') {
          this.emit('event', { type: 'context_compaction', threadId, state: 'completed' } as CodexEvent)
        }
        if (item?.type === 'agentMessage' && item.id) {
          this.emit('event', { type: 'agent_message_completed', threadId, itemId: item.id, text: item.text ?? '', phase: item.phase } as CodexEvent)
        }
        break
      }
      case 'item/guardianApprovalReview/started': {
        const payload = params as {
          reviewId?: string
          targetItemId?: string | null
          action?: unknown
          review?: unknown
        }
        const action = payload.action ?? {}
        const review = payload.review ?? {}
        const description = this.describeGuardianAction(action)
        const reviewId = payload.reviewId ?? crypto.randomUUID()
        this.pendingApprovalsByThread.set(threadId, true)
        this.emit('event', {
          type: 'approval_request',
          threadId,
          approval: {
            id: reviewId,
            reviewId,
            targetItemId: payload.targetItemId,
            action,
            review,
            description,
          },
        } as CodexEvent)
        break
      }
      case 'item/guardianApprovalReview/completed': {
        const payload = params as {
          reviewId?: string
          action?: { type?: string }
          review?: { status?: string }
        }
        this.pendingApprovalsByThread.delete(threadId)
        const status = payload.review?.status ?? 'approved'
        this.emit('event', { type: 'approval_completed', threadId, reviewId: payload.reviewId ?? '', action: status as 'approved' | 'denied' | 'timedOut' | 'aborted' } as CodexEvent)
        break
      }
      case 'serverRequest/resolved':
        this.emitRunEnd(threadId)
        break
      default:
        break
    }
  }

  private describeGuardianAction(action: unknown): string {
    if (!action || typeof action !== 'object') return 'Unknown action'
    const a = action as Record<string, unknown>
    switch (a.type) {
      case 'command':
        return `Run command: ${String(a.command ?? '')}`
      case 'execve':
        return `Execute: ${String(a.program ?? '')} ${Array.isArray(a.argv) ? a.argv.join(' ') : ''}`
      case 'applyPatch':
        return `Apply patch to ${Array.isArray(a.files) ? (a.files as string[]).join(', ') : 'files'}`
      case 'networkAccess':
        return `Network access: ${String(a.protocol ?? '')} ${String(a.host ?? '')}:${String(a.port ?? '')}`
      case 'mcpToolCall':
        return `Tool call: ${String(a.toolName ?? '')}`
      case 'requestPermissions':
        return 'Request additional permissions'
      default:
        return String(a.type ?? 'Unknown action')
    }
  }

  private call(method: string, params?: Record<string, unknown>): Promise<JsonRpcResponse> {
    return new Promise((resolve, reject) => {
      if (!this.process?.stdin?.writable) {
        reject(new Error('Codex app-server not running'))
        return
      }
      const id = this.nextId++
      const req: JsonRpcRequest = { jsonrpc: '2.0', id, method, params }
      this.pending.set(id, resolve)
      this.process.stdin.write(JSON.stringify(req) + '\n')
    })
  }
}
