import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveUserDataPath } from './user-data-path'

const baseInput = {
  appDataPath: '/Users/test/Library/Application Support',
  commit: '0123456789abcdef',
  explicitPath: undefined,
  taskStoreVersion: 2,
  tempPath: '/private/tmp',
} as const

describe('resolveUserDataPath', () => {
  it('keeps release builds on Electron production user data', () => {
    expect(resolveUserDataPath({ ...baseInput, channel: 'release' })).toBeNull()
  })

  it('isolates development builds from production data', () => {
    expect(resolveUserDataPath({ ...baseInput, channel: 'development' })).toBe(
      path.join(baseInput.appDataPath, 'Cranberri Development', 'task-store-v2'),
    )
  })

  it('isolates each packaged UAT build from production and other schemas', () => {
    expect(resolveUserDataPath({ ...baseInput, channel: 'uat' })).toBe(
      path.join(baseInput.tempPath, 'cranberri-uat', '0123456789ab', 'task-store-v2'),
    )
  })

  it('honors an explicit test data directory for every channel', () => {
    expect(resolveUserDataPath({
      ...baseInput,
      channel: 'release',
      explicitPath: '/private/tmp/cranberri-smoke',
    })).toBe('/private/tmp/cranberri-smoke')
  })
})
