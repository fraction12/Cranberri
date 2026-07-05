import { spawn, ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import type { CodexEvent } from '../../shared/codex'

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

export class CodexClient extends EventEmitter {
  private process: ChildProcess | null = null
  private nextId = 1
  private pending = new Map<number, (res: JsonRpcResponse) => void>()
  private buffer = ''
  private cwd: string
  private startPromise: Promise<void> | null = null

  constructor(cwd: string) {
    super()
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

    this.process.stdout?.on('data', (data: Buffer) => this.onData(data))
    this.process.stderr?.on('data', (data: Buffer) => {
      const text = data.toString('utf8').trim()
      if (text) this.emit('event', { type: 'log', level: 'stderr', text } as CodexEvent)
    })

    this.process.on('exit', (code) => {
      this.emit('event', { type: 'run_end', threadId: '', error: `Codex app-server exited with code ${code ?? 'unknown'}` } as CodexEvent)
      this.process = null
      this.startPromise = null
    })

    await this.call('initialize', { clientInfo: { name: 'cranberri', version: '0.1.0' } })
  }

  stop(): void {
    this.process?.kill('SIGTERM')
    this.process = null
    this.startPromise = null
  }

  async createThread(): Promise<Thread> {
    const res = await this.call('thread/start', { cwd: this.cwd })
    const thread = (res.result as { thread: Thread } | undefined)?.thread
    if (!thread?.id) {
      throw new Error('thread/start did not return a thread id')
    }
    if (thread.name) {
      this.emit('event', { type: 'thread_name_updated', threadId: thread.id, title: thread.name } as CodexEvent)
    }
    return thread
  }

  async sendMessage(threadId: string, content: string): Promise<void> {
    await this.call('turn/start', {
      threadId,
      input: [{ type: 'text', text: content }],
    })
    this.emit('event', { type: 'run_start', threadId } as CodexEvent)
  }

  async approve(approvalId: string, threadId: string): Promise<void> {
    await this.call('thread/approve', { threadId, approvalId })
  }

  async abort(threadId: string): Promise<void> {
    await this.call('thread/abort', { threadId })
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
          this.emit('event', { type: 'run_start', threadId } as CodexEvent)
        } else if (status?.type === 'idle') {
          this.emit('event', { type: 'run_end', threadId } as CodexEvent)
        }
        break
      }
      case 'turn/completed': {
        const error = (params as { turn?: { error?: { message?: string } } }).turn?.error?.message
        this.emit('event', { type: 'run_end', threadId, error } as CodexEvent)
        break
      }
      case 'item/started': {
        const itemType = (params as { item?: { type?: string } }).item?.type ?? 'unknown'
        this.emit('event', { type: 'item_started', threadId, itemType } as CodexEvent)
        break
      }
      case 'warning': {
        const text = (params as { message?: string }).message ?? ''
        if (text) this.emit('event', { type: 'log', level: 'warning', text } as CodexEvent)
        break
      }
      case 'item/agentMessage/delta': {
        const text = (params as { delta?: string }).delta ?? ''
        if (text) this.emit('event', { type: 'text', threadId, text } as CodexEvent)
        break
      }
      case 'item/reasoning/textDelta': {
        break
      }
      case 'item/commandExecution/outputDelta': {
        const text = (params as { output?: string }).output ?? ''
        if (text) this.emit('event', { type: 'text', threadId, text: `[command output] ${text}` } as CodexEvent)
        break
      }
      case 'serverRequest/resolved':
        this.emit('event', { type: 'run_end', threadId } as CodexEvent)
        break
      default:
        if (method.includes('/delta') || method.includes('outputDelta')) {
          const text = (params as { delta?: string; output?: string }).delta
            ?? (params as { output?: string }).output
            ?? ''
          if (text) this.emit('event', { type: 'text', threadId, text: `[${method}] ${text}` } as CodexEvent)
        }
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
