import { spawn, ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import type { ToolCall, CodexEvent, PendingApproval } from '../../shared/codex'

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

export class CodexClient extends EventEmitter {
  private process: ChildProcess | null = null
  private nextId = 1
  private pending = new Map<number, (res: JsonRpcResponse) => void>()
  private buffer = ''
  private cwd: string

  constructor(cwd: string) {
    super()
    this.cwd = cwd
  }

  async start(): Promise<void> {
    if (this.process) return

    this.process = spawn('codex', ['app-server', '--stdio'], {
      cwd: this.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
    })

    this.process.stdout?.on('data', (data: Buffer) => this.onData(data))
    this.process.stderr?.on('data', (data: Buffer) => {
      const text = data.toString('utf8').trim()
      if (text) this.emit('log', { level: 'stderr', text })
    })

    this.process.on('exit', (code) => {
      this.emit('event', { type: 'run_end', threadId: '', error: `Codex app-server exited with code ${code ?? 'unknown'}` } as CodexEvent)
      this.process = null
    })

    await this.call('initialize', { clientInfo: { name: 'cranberri', version: '0.1.0' } })
  }

  stop(): void {
    this.process?.kill('SIGTERM')
    this.process = null
  }

  async createThread(): Promise<string> {
    const res = await this.call('tools/call', {
      name: 'create_thread',
      arguments: {},
    })
    return (res.result as { threadId: string }).threadId
  }

  async sendMessage(threadId: string, content: string): Promise<void> {
    await this.call('tools/call', {
      name: 'send_message',
      arguments: { threadId, content },
    })
    this.emit('event', { type: 'run_start', threadId } as CodexEvent)
  }

  async approve(approvalId: string, threadId: string): Promise<void> {
    await this.call('tools/call', {
      name: 'approve',
      arguments: { threadId, approvalId },
    })
  }

  async interrupt(threadId: string): Promise<void> {
    await this.call('tools/call', {
      name: 'interrupt',
      arguments: { threadId },
    })
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
      } catch (err) {
        this.emit('log', { level: 'parse-error', text: trimmed, error: String(err) })
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

    if ('method' in msg) {
      const n = msg as JsonRpcNotification
      if (n.method === 'notifications/message') {
        const p = n.params as { threadId: string; role?: string; content?: string } | undefined
        if (p?.content) {
          this.emit('event', { type: 'text', threadId: p.threadId, text: p.content } as CodexEvent)
        }
      }
      if (n.method === 'notifications/tool_call') {
        const p = n.params as { threadId: string; tool_call: ToolCall } | undefined
        if (p?.tool_call) {
          this.emit('event', { type: 'tool_call', threadId: p.threadId, tool: p.tool_call } as CodexEvent)
        }
      }
      if (n.method === 'notifications/approval_request') {
        const p = n.params as { threadId: string; approval: PendingApproval } | undefined
        if (p?.approval) {
          this.emit('event', { type: 'approval_request', threadId: p.threadId, approval: p.approval } as CodexEvent)
        }
      }
      if (n.method === 'notifications/run_complete') {
        const p = n.params as { threadId: string; error?: string } | undefined
        this.emit('event', { type: 'run_end', threadId: p?.threadId ?? '', error: p?.error } as CodexEvent)
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
