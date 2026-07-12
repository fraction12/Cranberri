import { app, ipcMain } from 'electron'
import log from 'electron-log/main'
import fs from 'node:fs/promises'
import path from 'node:path'
import { LocalEventStore, localStorePath } from './store'

const MAX_VALUE_LENGTH = 600
const MAX_JSONL_BYTES = 5 * 1024 * 1024
const SENSITIVE_KEY_PATTERN = /token|secret|password|authorization|cookie|api[-_]?key|credential/i
let telemetryStore: LocalEventStore | null = null

export function telemetryPath(): string {
  return path.join(app.getPath('userData'), 'debug-telemetry.jsonl')
}

export function electronLogPath(): string | null {
  try {
    return log.transports.file.getFile().path
  } catch {
    return null
  }
}

export function getTelemetryStore(): LocalEventStore {
  telemetryStore ??= new LocalEventStore(localStorePath(app.getPath('userData')))
  return telemetryStore
}

export function sanitizeTelemetryPayload(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[depth-limit]'
  if (value === null || value === undefined) return value
  if (typeof value === 'string') return value.length > MAX_VALUE_LENGTH ? `${value.slice(0, MAX_VALUE_LENGTH)}…` : value
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (Array.isArray(value)) return value.slice(0, 80).map((item) => sanitizeTelemetryPayload(item, depth + 1))
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => !SENSITIVE_KEY_PATTERN.test(key))
        .map(([key, item]) => [key, sanitizeTelemetryPayload(item, depth + 1)]),
    )
  }
  return String(value)
}

export async function logTelemetry(source: string, type: string, payload: unknown = {}): Promise<void> {
  const sanitizedPayload = sanitizeTelemetryPayload(payload)
  const entry = {
    timestamp: new Date().toISOString(),
    source,
    type,
    payload: sanitizedPayload,
  }
  await fs.mkdir(path.dirname(telemetryPath()), { recursive: true })
  await appendBoundedJsonLine(telemetryPath(), `${JSON.stringify(entry)}\n`)
  try {
    getTelemetryStore().appendEvent(entry)
  } catch (error) {
    console.warn('Failed to write telemetry event store:', error)
  }
  log.info('[telemetry]', source, type, sanitizedPayload)
}

export async function appendBoundedJsonLine(
  filePath: string,
  line: string,
  maxBytes = MAX_JSONL_BYTES,
): Promise<void> {
  const boundedBytes = Math.max(1, Math.floor(maxBytes))
  const lineBytes = Buffer.byteLength(line, 'utf8')
  let existing = ''
  try {
    const stats = await fs.stat(filePath)
    if (stats.size + lineBytes <= boundedBytes) {
      await fs.appendFile(filePath, line, 'utf8')
      return
    }
    existing = await fs.readFile(filePath, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }

  const entries = `${existing}${line}`.split('\n').filter(Boolean)
  while (entries.length > 1 && Buffer.byteLength(`${entries.join('\n')}\n`, 'utf8') > boundedBytes) {
    entries.shift()
  }
  await fs.writeFile(filePath, entries.length > 0 ? `${entries.join('\n')}\n` : '', 'utf8')
}

export function initTelemetryIpc(): void {
  ipcMain.handle('telemetry:log', async (_, source: string, type: string, payload?: unknown) => {
    await logTelemetry(source, type, payload)
    return { ok: true }
  })

  ipcMain.handle('telemetry:read', async (_, limit = 400) => {
    try {
      const content = await fs.readFile(telemetryPath(), 'utf8')
      const lines = content.trim().split('\n').filter(Boolean)
      return { path: telemetryPath(), lines: lines.slice(-limit) }
    } catch {
      return { path: telemetryPath(), lines: [] }
    }
  })

  ipcMain.handle('telemetry:read-events', async (_, limit = 400) => ({
    events: getTelemetryStore().readEvents(limit),
  }))

  ipcMain.handle('telemetry:clear', async () => {
    await fs.rm(telemetryPath(), { force: true })
    getTelemetryStore().clearEvents()
    return { ok: true, path: telemetryPath() }
  })

  ipcMain.handle('telemetry:path', async () => ({ path: telemetryPath() }))
}
