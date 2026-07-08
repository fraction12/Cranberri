import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { LocalEventStore, localStorePath } from './store'

const tempDirs: string[] = []

function tempStore(): { dir: string; store: LocalEventStore } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cranberri-store-'))
  tempDirs.push(dir)
  return { dir, store: new LocalEventStore(localStorePath(dir)) }
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { force: true, recursive: true })
  }
})

describe('LocalEventStore', () => {
  it('creates the sqlite store under user data', () => {
    const { dir, store } = tempStore()
    store.close()
    expect(fs.existsSync(localStorePath(dir))).toBe(true)
  })

  it('appends and reads events in insertion order', () => {
    const { store } = tempStore()
    const first = store.appendEvent({ source: 'test', type: 'first', payload: { ok: true }, timestamp: '2026-07-07T00:00:00.000Z' })
    const second = store.appendEvent({ source: 'test', type: 'second', payload: { count: 2 }, timestamp: '2026-07-07T00:00:01.000Z' })

    expect(first.id).toBeGreaterThan(0)
    expect(second.id).toBeGreaterThan(first.id)
    expect(store.readEvents()).toEqual([
      { id: first.id, timestamp: '2026-07-07T00:00:00.000Z', source: 'test', type: 'first', payload: { ok: true } },
      { id: second.id, timestamp: '2026-07-07T00:00:01.000Z', source: 'test', type: 'second', payload: { count: 2 } },
    ])
    store.close()
  })

  it('bounds read limits and can clear events', () => {
    const { store } = tempStore()
    store.appendEvent({ source: 'test', type: 'first' })
    store.appendEvent({ source: 'test', type: 'second' })

    expect(store.readEvents(1)).toHaveLength(1)
    store.clearEvents()
    expect(store.readEvents()).toEqual([])
    store.close()
  })
})
