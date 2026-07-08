import { describe, expect, it } from 'vitest'
import { RIGHT_RAIL_ACTIVE_FILE_EVENT, createRightRailActiveFileEvent, rightRailActiveFileFromEvent } from './right-rail-active-file-events'

describe('right rail active file events', () => {
  it('round-trips a selected right rail file', () => {
    const event = createRightRailActiveFileEvent({ path: 'src/App.tsx', status: 'tracked' })

    expect(event.type).toBe(RIGHT_RAIL_ACTIVE_FILE_EVENT)
    expect(rightRailActiveFileFromEvent(event)).toEqual({ path: 'src/App.tsx', status: 'tracked' })
  })

  it('treats null and malformed payloads as no active file', () => {
    expect(rightRailActiveFileFromEvent(createRightRailActiveFileEvent(null))).toBeNull()
    expect(rightRailActiveFileFromEvent(new CustomEvent(RIGHT_RAIL_ACTIVE_FILE_EVENT, { detail: {} }))).toBeNull()
  })
})
