import { app, ipcMain } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'

const MAX_VALUE_LENGTH = 600

function telemetryPath(): string {
  return path.join(app.getPath('userData'), 'debug-telemetry.jsonl')
}

function sanitize(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[depth-limit]'
  if (value === null || value === undefined) return value
  if (typeof value === 'string') return value.length > MAX_VALUE_LENGTH ? `${value.slice(0, MAX_VALUE_LENGTH)}…` : value
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (Array.isArray(value)) return value.slice(0, 80).map((item) => sanitize(item, depth + 1))
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => !/token|secret|password|authorization|cookie/i.test(key))
        .map(([key, item]) => [key, sanitize(item, depth + 1)]),
    )
  }
  return String(value)
}

export async function logTelemetry(source: string, type: string, payload: unknown = {}): Promise<void> {
  const entry = {
    timestamp: new Date().toISOString(),
    source,
    type,
    payload: sanitize(payload),
  }
  await fs.mkdir(path.dirname(telemetryPath()), { recursive: true })
  await fs.appendFile(telemetryPath(), `${JSON.stringify(entry)}\n`, 'utf8')
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

  ipcMain.handle('telemetry:clear', async () => {
    await fs.rm(telemetryPath(), { force: true })
    return { ok: true, path: telemetryPath() }
  })

  ipcMain.handle('telemetry:path', async () => ({ path: telemetryPath() }))
}
