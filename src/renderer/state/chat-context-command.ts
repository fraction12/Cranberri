import { toast } from 'sonner'
import type { CodexUserInput } from '@/shared/codex'

export interface ChatContextPayload {
  text: string
  inputParts?: CodexUserInput[]
  attachmentPaths?: string[]
}

export interface SendChatContextAcknowledgment {
  windowId: string
}

export type ChatContextWorkspaceHandler = (payload: ChatContextPayload) => string | Promise<string>
export type ChatContextTargetHandler = (payload: ChatContextPayload) => void | Promise<void>

interface PendingDelivery {
  id: number
  payload: ChatContextPayload
  resolve: (acknowledgment: SendChatContextAcknowledgment) => void
  reject: (error: Error) => void
  timeout: ReturnType<typeof setTimeout>
}

export interface ChatContextCommandController {
  sendChatContext: (payload: ChatContextPayload) => Promise<SendChatContextAcknowledgment>
  registerWorkspaceHandler: (handler: ChatContextWorkspaceHandler) => () => void
  registerTarget: (windowId: string, handler: ChatContextTargetHandler) => () => void
}

export function createChatContextCommandController(
  { deliveryTimeoutMs = 3_000 }: { deliveryTimeoutMs?: number } = {},
): ChatContextCommandController {
  let workspaceHandler: ChatContextWorkspaceHandler | null = null
  let nextDeliveryId = 1
  const targets = new Map<string, ChatContextTargetHandler>()
  const pendingByWindow = new Map<string, Map<number, PendingDelivery>>()

  const removePending = (windowId: string, deliveryId: number): PendingDelivery | null => {
    const pendingForWindow = pendingByWindow.get(windowId)
    const pending = pendingForWindow?.get(deliveryId) ?? null
    if (!pending || !pendingForWindow) return null
    pendingForWindow.delete(deliveryId)
    if (pendingForWindow.size === 0) pendingByWindow.delete(windowId)
    clearTimeout(pending.timeout)
    return pending
  }

  const deliver = (windowId: string, deliveryId: number, handler: ChatContextTargetHandler) => {
    const pending = removePending(windowId, deliveryId)
    if (!pending) return
    let acceptance: void | Promise<void>
    try {
      acceptance = handler(pending.payload)
    } catch (error) {
      pending.reject(error instanceof Error ? error : new Error('Chat rejected the context'))
      return
    }
    Promise.resolve(acceptance)
      .then(() => pending.resolve({ windowId }))
      .catch((error: unknown) => {
        pending.reject(error instanceof Error ? error : new Error('Chat rejected the context'))
      })
  }

  return {
    async sendChatContext(payload) {
      const normalizedPayload = normalizeChatContextPayload(payload)
      if (!workspaceHandler) throw new Error('Chat workspace is unavailable')
      const windowId = await workspaceHandler(normalizedPayload)
      if (!windowId) throw new Error('Chat workspace did not select a target')

      return new Promise<SendChatContextAcknowledgment>((resolve, reject) => {
        const id = nextDeliveryId++
        const pendingForWindow = pendingByWindow.get(windowId) ?? new Map<number, PendingDelivery>()
        const timeout = setTimeout(() => {
          const expired = removePending(windowId, id)
          expired?.reject(new Error(`Timed out waiting for chat ${windowId}`))
        }, deliveryTimeoutMs)
        pendingForWindow.set(id, { id, payload: normalizedPayload, resolve, reject, timeout })
        pendingByWindow.set(windowId, pendingForWindow)

        const target = targets.get(windowId)
        if (target) deliver(windowId, id, target)
      })
    },

    registerWorkspaceHandler(handler) {
      workspaceHandler = handler
      return () => {
        if (workspaceHandler === handler) workspaceHandler = null
      }
    },

    registerTarget(windowId, handler) {
      targets.set(windowId, handler)
      const pendingForWindow = pendingByWindow.get(windowId)
      if (pendingForWindow) {
        for (const deliveryId of [...pendingForWindow.keys()]) {
          deliver(windowId, deliveryId, handler)
        }
      }
      return () => {
        if (targets.get(windowId) === handler) targets.delete(windowId)
      }
    },
  }
}

export function normalizeChatContextPayload(payload: ChatContextPayload): ChatContextPayload {
  if (!payload || typeof payload !== 'object') throw new Error('Invalid chat context payload')
  const inputParts = Array.isArray(payload.inputParts) ? payload.inputParts.filter(isSupportedInputPart) : undefined
  const attachmentPaths = Array.isArray(payload.attachmentPaths) ? payload.attachmentPaths.filter(isLocalAttachmentPath) : undefined
  const text = typeof payload.text === 'string' ? payload.text : ''
  if (!text && !inputParts?.length && !attachmentPaths?.length) throw new Error('Chat context is empty')
  return {
    text,
    ...(inputParts?.length ? { inputParts } : {}),
    ...(attachmentPaths?.length ? { attachmentPaths } : {}),
  }
}

function isSupportedInputPart(part: unknown): part is CodexUserInput {
  if (!part || typeof part !== 'object') return false
  const candidate = part as Partial<CodexUserInput>
  if (candidate.type === 'image') return typeof candidate.url === 'string' && candidate.url.length > 0
  if (candidate.type === 'localImage') return typeof candidate.path === 'string' && candidate.path.length > 0
  if (candidate.type === 'text') return typeof candidate.text === 'string' && candidate.text.length > 0
  if (candidate.type === 'skill') return typeof candidate.name === 'string' && typeof candidate.path === 'string'
  return false
}

function isLocalAttachmentPath(value: unknown): value is string {
  return typeof value === 'string' && value.trim().startsWith('/')
}

const chatContextCommands = createChatContextCommandController()

export const sendChatContext = chatContextCommands.sendChatContext
export const registerChatContextWorkspace = chatContextCommands.registerWorkspaceHandler
export const registerChatContextTarget = chatContextCommands.registerTarget

export function reportSendChatContextError(error: unknown): void {
  console.error('Failed to add context to chat:', error)
  toast.error('Could not add context to chat', {
    id: 'send-chat-context-failed',
  })
}

export function sendChatContextSafely(payload: ChatContextPayload): void {
  void sendChatContext(payload).catch(reportSendChatContextError)
}
