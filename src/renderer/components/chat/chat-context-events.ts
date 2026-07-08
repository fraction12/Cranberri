import type { CodexUserInput } from '@/shared/codex'

export const INSERT_CHAT_CONTEXT_EVENT = 'cranberri:insert-chat-context'
export const SEND_CHAT_CONTEXT_TO_ACTIVE_CHAT_EVENT = 'cranberri:send-chat-context-to-active-chat'

export interface InsertChatContextEventDetail {
  windowId: string
  text: string
  inputParts?: CodexUserInput[]
  attachmentPaths?: string[]
}

export function createInsertChatContextEvent(detail: InsertChatContextEventDetail): CustomEvent<InsertChatContextEventDetail> {
  return new CustomEvent(INSERT_CHAT_CONTEXT_EVENT, { detail })
}

export interface SendChatContextEventDetail {
  text: string
  inputParts?: CodexUserInput[]
  attachmentPaths?: string[]
}

export function createSendChatContextEvent(detail: SendChatContextEventDetail): CustomEvent<SendChatContextEventDetail> {
  return new CustomEvent(SEND_CHAT_CONTEXT_TO_ACTIVE_CHAT_EVENT, { detail })
}

export function insertChatContextDetailFromEvent(event: Event): InsertChatContextEventDetail | null {
  const detail = (event as CustomEvent<Partial<InsertChatContextEventDetail>>).detail
  if (!detail?.windowId) return null
  const inputParts = Array.isArray(detail.inputParts) ? detail.inputParts.filter(isSupportedInputPart) : undefined
  const attachmentPaths = Array.isArray(detail.attachmentPaths) ? detail.attachmentPaths.filter(isLocalAttachmentPath) : undefined
  const text = typeof detail.text === 'string' ? detail.text : ''
  if (!text && !inputParts?.length && !attachmentPaths?.length) return null
  return {
    windowId: detail.windowId,
    text,
    ...(inputParts?.length ? { inputParts } : {}),
    ...(attachmentPaths?.length ? { attachmentPaths } : {}),
  }
}

export function sendChatContextDetailFromEvent(event: Event): SendChatContextEventDetail | null {
  const detail = (event as CustomEvent<Partial<SendChatContextEventDetail>>).detail
  if (!detail) return null
  const inputParts = Array.isArray(detail.inputParts) ? detail.inputParts.filter(isSupportedInputPart) : undefined
  const attachmentPaths = Array.isArray(detail.attachmentPaths) ? detail.attachmentPaths.filter(isLocalAttachmentPath) : undefined
  const text = typeof detail.text === 'string' ? detail.text : ''
  if (!text && !inputParts?.length && !attachmentPaths?.length) return null
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
