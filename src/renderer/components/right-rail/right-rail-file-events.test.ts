import { describe, expect, it } from 'vitest'
import { OPEN_RIGHT_RAIL_FILE_EVENT, createOpenRightRailFileEvent, rightRailFileFromEvent } from './right-rail-file-events'

describe('right rail file events', () => {
  it('creates file open events that the right rail can resolve', () => {
    const event = createOpenRightRailFileEvent({ path: 'src/App.tsx', status: 'tracked' }, 12)

    expect(event.type).toBe(OPEN_RIGHT_RAIL_FILE_EVENT)
    expect(rightRailFileFromEvent(event)).toEqual({
      file: { path: 'src/App.tsx', status: 'tracked' },
      line: 12,
    })
  })

  it('ignores malformed file events', () => {
    expect(rightRailFileFromEvent(new CustomEvent(OPEN_RIGHT_RAIL_FILE_EVENT, { detail: {} }))).toBeNull()
  })
})
