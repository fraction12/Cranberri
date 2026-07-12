import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  captureChatContextExecutionBinding,
  createChatContextCommandController,
  isChatContextExecutionBindingCurrent,
} from './chat-context-command'

describe('chat context command controller', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('delivers to an existing target and acknowledges its window', async () => {
    const controller = createChatContextCommandController()
    const insert = vi.fn()
    controller.registerWorkspaceHandler(() => 'chat-1')
    controller.registerTarget('chat-1', insert)

    await expect(controller.sendChatContext({ text: 'Repo context' })).resolves.toEqual({ windowId: 'chat-1' })
    expect(insert).toHaveBeenCalledOnce()
    expect(insert).toHaveBeenCalledWith({ text: 'Repo context' })
  })

  it('queues delivery until a newly opened target registers', async () => {
    vi.useFakeTimers()
    const controller = createChatContextCommandController({ deliveryTimeoutMs: 100 })
    const insert = vi.fn()
    controller.registerWorkspaceHandler(() => 'chat-new')

    const acknowledgment = controller.sendChatContext({ text: 'Delayed context' })
    await vi.advanceTimersByTimeAsync(50)
    controller.registerTarget('chat-new', insert)
    expect(insert).toHaveBeenCalledOnce()

    await expect(acknowledgment).resolves.toEqual({ windowId: 'chat-new' })
  })

  it('rejects when no workspace handler is registered', async () => {
    const controller = createChatContextCommandController()

    await expect(controller.sendChatContext({ text: 'Context' })).rejects.toThrow('Chat workspace is unavailable')
  })

  it('times out when the selected target never registers', async () => {
    vi.useFakeTimers()
    const controller = createChatContextCommandController({ deliveryTimeoutMs: 100 })
    controller.registerWorkspaceHandler(() => 'chat-missing')

    const acknowledgment = controller.sendChatContext({ text: 'Context' })
    const rejection = expect(acknowledgment).rejects.toThrow('Timed out waiting for chat chat-missing')
    await vi.advanceTimersByTimeAsync(100)
    await rejection
  })

  it('preserves validation while filtering unsupported context parts', async () => {
    const controller = createChatContextCommandController()
    const insert = vi.fn()
    controller.registerWorkspaceHandler(() => 'chat-1')
    controller.registerTarget('chat-1', insert)

    await controller.sendChatContext({
      text: '',
      inputParts: [
        { type: 'localImage', path: '/tmp/capture.png', detail: 'high' },
        { type: 'image', url: '' },
      ],
      attachmentPaths: ['/tmp/report.txt', 'relative.txt'],
    })
    expect(insert).toHaveBeenCalledWith({
      text: '',
      inputParts: [{ type: 'localImage', path: '/tmp/capture.png', detail: 'high' }],
      attachmentPaths: ['/tmp/report.txt'],
    })

    await expect(controller.sendChatContext({ text: '', attachmentPaths: ['relative.txt'] })).rejects.toThrow('Chat context is empty')
  })

  it('does not deliver a queued command twice when the target re-registers', async () => {
    const controller = createChatContextCommandController()
    const firstInsert = vi.fn()
    const secondInsert = vi.fn()
    controller.registerWorkspaceHandler(() => 'chat-new')

    const acknowledgment = controller.sendChatContext({ text: 'Once' })
    await Promise.resolve()
    const unregister = controller.registerTarget('chat-new', firstInsert)
    unregister()
    controller.registerTarget('chat-new', secondInsert)

    await expect(acknowledgment).resolves.toEqual({ windowId: 'chat-new' })
    expect(firstInsert).toHaveBeenCalledOnce()
    expect(secondInsert).not.toHaveBeenCalled()
  })

  it('delivers to the captured target instead of whichever workspace is active later', async () => {
    const controller = createChatContextCommandController()
    const originatingInsert = vi.fn()
    const activeInsert = vi.fn()
    controller.registerWorkspaceHandler(() => 'chat-b')
    controller.registerTarget('chat-a', originatingInsert)
    controller.registerTarget('chat-b', activeInsert)

    await expect(controller.sendChatContext(
      { text: 'Context from checkout A' },
      { targetWindowId: 'chat-a' },
    )).resolves.toEqual({ windowId: 'chat-a' })
    expect(originatingInsert).toHaveBeenCalledWith({ text: 'Context from checkout A' })
    expect(activeInsert).not.toHaveBeenCalled()
  })

  it('rejects a delayed read after the originating binding switches', async () => {
    const controller = createChatContextCommandController()
    const originatingInsert = vi.fn()
    const activeInsert = vi.fn()
    let resolveRead: ((payload: { text: string }) => void) | undefined
    const read = new Promise<{ text: string }>((resolve) => {
      resolveRead = resolve
    })
    let activeWindowId = 'source-a'
    let currentWindows = [{
      id: 'source-a',
      type: 'browser' as const,
      title: 'Checkout A',
      projectId: 'project',
      taskId: 'task-a',
      checkoutId: 'checkout-a',
      bindingRevision: 4,
    }]
    const capturedBinding = captureChatContextExecutionBinding(currentWindows[0])
    controller.registerWorkspaceHandler(() => 'chat-b')
    controller.registerTarget('chat-a', originatingInsert)
    controller.registerTarget('chat-b', activeInsert)

    const delivery = read.then((payload) => controller.sendChatContext(payload, {
      targetWindowId: 'chat-a',
      isCurrent: () => activeWindowId === capturedBinding.windowId
        && isChatContextExecutionBindingCurrent(capturedBinding, currentWindows),
    }))
    activeWindowId = 'source-b'
    currentWindows = [{
      id: 'source-b',
      type: 'browser' as const,
      title: 'Checkout B',
      projectId: 'project',
      taskId: 'task-b',
      checkoutId: 'checkout-b',
      bindingRevision: 0,
    }]
    resolveRead?.({ text: 'Delayed context from checkout A' })

    await expect(delivery).rejects.toThrow('Chat context target is stale')
    expect(originatingInsert).not.toHaveBeenCalled()
    expect(activeInsert).not.toHaveBeenCalled()
  })

  it('treats a same-window execution rebind as stale', () => {
    const capturedWindow = {
      id: 'source-a',
      type: 'chat' as const,
      title: 'Checkout A',
      projectId: 'project',
      taskId: 'task-a',
      checkoutId: 'checkout-a',
      threadId: 'thread-a',
      bindingRevision: 4,
    }
    const binding = captureChatContextExecutionBinding(capturedWindow)

    expect(isChatContextExecutionBindingCurrent(binding, [capturedWindow])).toBe(true)
    expect(isChatContextExecutionBindingCurrent(binding, [{
      ...capturedWindow,
      taskId: 'task-b',
      checkoutId: 'checkout-b',
      threadId: 'thread-b',
      bindingRevision: 5,
    }])).toBe(false)
  })
})
