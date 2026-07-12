import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import type { TelemetryEventRecord } from '@/shared/telemetry'

export interface LocalEventInput {
  source: string
  type: string
  payload?: unknown
  timestamp?: string
}

export type LocalEventRecord = TelemetryEventRecord

const DEFAULT_MAX_EVENTS = 10_000

interface LocalEventStoreOptions {
  maxEvents?: number
}

export function localStorePath(userDataPath: string): string {
  return path.join(userDataPath, 'cranberri.sqlite3')
}

export class LocalEventStore {
  private readonly db: Database.Database
  private readonly maxEvents: number

  constructor(dbPath: string, options: LocalEventStoreOptions = {}) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true })
    this.db = new Database(dbPath)
    this.maxEvents = Math.max(1, Math.floor(options.maxEvents ?? DEFAULT_MAX_EVENTS))
    this.db.pragma('journal_mode = WAL')
    this.migrate()
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS local_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT NOT NULL,
        source TEXT NOT NULL,
        type TEXT NOT NULL,
        payload_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_local_events_timestamp ON local_events(timestamp);
      CREATE INDEX IF NOT EXISTS idx_local_events_source_type ON local_events(source, type);
    `)
  }

  appendEvent(event: LocalEventInput): LocalEventRecord {
    const timestamp = event.timestamp ?? new Date().toISOString()
    const payloadJson = JSON.stringify(event.payload ?? {})
    const result = this.db.prepare(`
      INSERT INTO local_events (timestamp, source, type, payload_json)
      VALUES (@timestamp, @source, @type, @payloadJson)
    `).run({
      timestamp,
      source: event.source,
      type: event.type,
      payloadJson,
    })
    this.pruneEvents()
    return {
      id: Number(result.lastInsertRowid),
      timestamp,
      source: event.source,
      type: event.type,
      payload: event.payload ?? {},
    }
  }

  private pruneEvents(): void {
    this.db.prepare(`
      DELETE FROM local_events
      WHERE id NOT IN (
        SELECT id FROM local_events ORDER BY id DESC LIMIT ?
      )
    `).run(this.maxEvents)
  }

  readEvents(limit = 400): LocalEventRecord[] {
    const boundedLimit = Math.min(Math.max(Math.floor(limit), 1), 2000)
    const rows = this.db.prepare(`
      SELECT id, timestamp, source, type, payload_json
      FROM local_events
      ORDER BY id DESC
      LIMIT ?
    `).all(boundedLimit) as Array<{ id: number; timestamp: string; source: string; type: string; payload_json: string }>

    return rows.reverse().map((row) => ({
      id: row.id,
      timestamp: row.timestamp,
      source: row.source,
      type: row.type,
      payload: parsePayload(row.payload_json),
    }))
  }

  clearEvents(): void {
    this.db.prepare('DELETE FROM local_events').run()
  }

  close(): void {
    this.db.close()
  }
}

function parsePayload(payloadJson: string): unknown {
  try {
    return JSON.parse(payloadJson)
  } catch {
    return {}
  }
}
