import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_APP_SETTINGS, type AppSettings } from '../../shared/settings'
import { SettingsWriteQueue } from './settings-write-queue'

describe('SettingsWriteQueue', () => {
  it('serializes rapid updates against the latest saved settings', async () => {
    const writes: AppSettings[] = []
    const persist = vi.fn(async (settings: AppSettings) => {
      await new Promise((resolve) => setTimeout(resolve, 1))
      writes.push(settings)
      return settings
    })
    const onSaved = vi.fn()
    const queue = new SettingsWriteQueue(DEFAULT_APP_SETTINGS, persist, onSaved)

    await Promise.all([
      queue.enqueue((current) => ({
        ...current,
        codex: { ...current.codex, defaultModel: 'gpt-5.6-sol' },
      })),
      queue.enqueue((current) => ({
        ...current,
        codex: { ...current.codex, defaultEffort: 'ultra' },
      })),
      queue.enqueue((current) => ({
        ...current,
        codex: { ...current.codex, defaultSpeed: 'fast' },
      })),
    ])

    expect(writes.map((settings) => settings.codex)).toEqual([
      expect.objectContaining({ defaultModel: 'gpt-5.6-sol', defaultEffort: 'high' }),
      expect.objectContaining({ defaultModel: 'gpt-5.6-sol', defaultEffort: 'ultra' }),
      expect.objectContaining({ defaultModel: 'gpt-5.6-sol', defaultEffort: 'ultra', defaultSpeed: 'fast' }),
    ])
    expect(onSaved).toHaveBeenCalledTimes(3)
  })

  it('continues with the last saved state after a failed write', async () => {
    const persist = vi.fn()
      .mockRejectedValueOnce(new Error('disk full'))
      .mockImplementationOnce(async (settings: AppSettings) => settings)
    const onSaved = vi.fn()
    const queue = new SettingsWriteQueue(DEFAULT_APP_SETTINGS, persist, onSaved)

    await expect(queue.enqueue((current) => ({
      ...current,
      codex: { ...current.codex, defaultModel: 'gpt-5.6-sol' },
    }))).rejects.toThrow('disk full')
    await queue.enqueue((current) => ({
      ...current,
      codex: { ...current.codex, defaultEffort: 'medium' },
    }))

    expect(onSaved).toHaveBeenLastCalledWith(expect.objectContaining({
      codex: expect.objectContaining({ defaultModel: 'gpt-5.5', defaultEffort: 'medium' }),
    }))
  })

  it('serializes tools and unrelated section writes without losing either update', async () => {
    const orphanToolId = 'mcp:provider%3Aalpha:custom%3Atool'
    const writes: AppSettings[] = []
    const persist = vi.fn(async (settings: AppSettings) => {
      await new Promise((resolve) => setTimeout(resolve, 1))
      writes.push(settings)
      return settings
    })
    const queue = new SettingsWriteQueue(DEFAULT_APP_SETTINGS, persist, vi.fn())

    await Promise.all([
      queue.enqueue((current) => ({
        ...current,
        tools: {
          ...current.tools,
          pinnedToolIds: [...current.tools.pinnedToolIds, orphanToolId],
        },
      })),
      queue.enqueue((current) => ({
        ...current,
        appearance: { ...current.appearance, accent: 'rose' },
      })),
      queue.enqueue((current) => ({
        ...current,
        tools: {
          ...current.tools,
          dismissedDefaultToolIds: [...current.tools.dismissedDefaultToolIds, 'cli:rg'],
        },
      })),
    ])

    expect(writes).toHaveLength(3)
    expect(writes[1]).toMatchObject({
      appearance: { accent: 'rose' },
      tools: { pinnedToolIds: [orphanToolId], dismissedDefaultToolIds: [] },
    })
    expect(writes[2]).toMatchObject({
      appearance: { accent: 'rose' },
      tools: {
        pinnedToolIds: [orphanToolId],
        dismissedDefaultToolIds: ['cli:rg'],
      },
    })
  })
})
