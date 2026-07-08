import { describe, expect, it } from 'vitest'
import {
  INSERT_CHAT_CONTEXT_EVENT,
  SEND_CHAT_CONTEXT_TO_ACTIVE_CHAT_EVENT,
  createInsertChatContextEvent,
  createSendChatContextEvent,
  insertChatContextDetailFromEvent,
  sendChatContextDetailFromEvent,
} from './chat-context-events'

describe('chat context events', () => {
  it('creates and parses targeted chat context insertion events', () => {
    const event = createInsertChatContextEvent({
      windowId: 'chat-1',
      text: 'Browser context',
      inputParts: [{ type: 'localImage', path: '/tmp/capture.png', detail: 'high' }],
      attachmentPaths: ['/tmp/report.txt', 'relative.txt'],
    })

    expect(event.type).toBe(INSERT_CHAT_CONTEXT_EVENT)
    expect(insertChatContextDetailFromEvent(event)).toEqual({
      windowId: 'chat-1',
      text: 'Browser context',
      inputParts: [{ type: 'localImage', path: '/tmp/capture.png', detail: 'high' }],
      attachmentPaths: ['/tmp/report.txt'],
    })
    expect(insertChatContextDetailFromEvent(new CustomEvent(INSERT_CHAT_CONTEXT_EVENT, { detail: { windowId: 'chat-1' } }))).toBeNull()
  })

  it('creates and parses active chat context request events', () => {
    const event = createSendChatContextEvent({
      text: 'Repo file context',
      inputParts: [{ type: 'skill', name: 'ce-work', path: '/skills/ce-work' }],
      attachmentPaths: ['/tmp/report.txt', 'relative.txt'],
    })

    expect(event.type).toBe(SEND_CHAT_CONTEXT_TO_ACTIVE_CHAT_EVENT)
    expect(sendChatContextDetailFromEvent(event)).toEqual({
      text: 'Repo file context',
      inputParts: [{ type: 'skill', name: 'ce-work', path: '/skills/ce-work' }],
      attachmentPaths: ['/tmp/report.txt'],
    })
    expect(sendChatContextDetailFromEvent(new CustomEvent(SEND_CHAT_CONTEXT_TO_ACTIVE_CHAT_EVENT, { detail: {} }))).toBeNull()
  })

  it('allows attachment-only active chat context events', () => {
    const event = createSendChatContextEvent({
      text: '',
      attachmentPaths: ['/tmp/fixture.txt'],
    })

    expect(sendChatContextDetailFromEvent(event)).toEqual({
      text: '',
      attachmentPaths: ['/tmp/fixture.txt'],
    })
  })
})
