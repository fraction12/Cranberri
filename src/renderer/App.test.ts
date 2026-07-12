import { describe, expect, it, vi } from 'vitest'
import { runRendererPersistenceFlush } from './App'

describe('renderer persistence flush handshake', () => {
  it('acknowledges only after every app-state and draft write settles', async () => {
    const order: string[] = []
    let releaseDraft!: () => void
    const draftWrite = new Promise<void>((resolve) => { releaseDraft = resolve })
    const acknowledge = vi.fn(async () => { order.push('acknowledge') })

    const pending = runRendererPersistenceFlush(
      { requestId: 'request-1', reason: 'window-close' },
      (writes) => {
        writes.push(Promise.resolve().then(() => { order.push('app-state') }))
        writes.push(draftWrite.then(() => { order.push('draft') }))
      },
      acknowledge,
    )
    await Promise.resolve()
    expect(acknowledge).not.toHaveBeenCalled()

    releaseDraft()
    await pending

    expect(order).toEqual(['app-state', 'draft', 'acknowledge'])
    expect(acknowledge).toHaveBeenCalledWith({ requestId: 'request-1', errorMessage: null })
  })

  it('returns a failed acknowledgement when a durable write rejects', async () => {
    const acknowledge = vi.fn(async () => undefined)
    await runRendererPersistenceFlush(
      { requestId: 'request-2', reason: 'app-quit' },
      (writes) => writes.push(Promise.reject(new Error('draft write failed'))),
      acknowledge,
    )

    expect(acknowledge).toHaveBeenCalledWith({ requestId: 'request-2', errorMessage: 'draft write failed' })
  })
})
