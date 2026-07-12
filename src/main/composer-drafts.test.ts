import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  COMPOSER_DRAFT_LIMITS,
  composerDraftSchema,
  composerDraftsStoreSchema,
  type ComposerDraft,
} from '../shared/composer-drafts'

const electron = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  userDataPath: '',
}))

vi.mock('electron', () => ({
  app: { getPath: () => electron.userDataPath },
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
      electron.handlers.set(channel, handler)
    },
  },
}))

import {
  composerDraftsBackupPath,
  deleteComposerDraft,
  initComposerDraftsIpc,
  readComposerDraft,
  readComposerDraftsFile,
  writeComposerDraft,
} from './composer-drafts'

const temporaryDirectories: string[] = []

function draftsPath(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cranberri-composer-drafts-'))
  temporaryDirectories.push(directory)
  return path.join(directory, 'composer-drafts.json')
}

function draft(overrides: Partial<ComposerDraft> = {}): ComposerDraft {
  return {
    ownerKey: 'project-1:window-1:3',
    projectId: 'project-1',
    windowId: 'window-1',
    bindingRevision: 3,
    updatedAt: 1_752_345_678_901,
    text: 'Review $plugin and /skill',
    mentions: [
      {
        kind: 'skill',
        id: 'skill-1',
        name: 'review',
        displayName: 'Code review',
        path: '/skills/review/SKILL.md',
        description: 'Review the current changes',
      },
      {
        kind: 'plugin',
        id: 'plugin-1',
        name: 'github',
        displayName: 'GitHub',
        path: 'plugin://plugin-1',
        description: 'GitHub tools',
        prompt: 'Use GitHub context',
      },
    ],
    attachmentPaths: ['/tmp/spec.md'],
    contextInputAttachments: [
      {
        id: 'context-1',
        label: 'capture.png',
        input: { type: 'localImage', path: '/tmp/capture.png', detail: 'high' },
      },
      {
        id: 'context-2',
        label: 'instructions',
        input: { type: 'text', text: 'Keep this context' },
      },
    ],
    turnSettings: {
      model: 'gpt-5.6-terra',
      effort: 'high',
      speed: 'fast',
      approvalMode: 'custom',
    },
    planMode: false,
    goalMode: true,
    baseRef: 'refs/heads/main',
    environmentId: 'node-22',
    includeLocalChanges: true,
    pendingSend: {
      id: 'send-1',
      startedAt: 1_752_345_679_000,
      threadId: 'thread-1',
    },
    ...overrides,
  }
}

beforeEach(() => {
  electron.handlers.clear()
  electron.userDataPath = ''
})

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    execFileSync('/usr/bin/trash', [directory])
  }
})

describe('composer draft persistence', () => {
  it('round trips a structured draft including its pending-send journal marker', () => {
    const target = draftsPath()
    const expected = draft()

    expect(writeComposerDraft(expected, target)).toEqual(expected)
    expect(readComposerDraft(expected.ownerKey, target)).toEqual(expected)
    expect(readComposerDraftsFile(target)).toEqual({
      store: { version: 1, drafts: { [expected.ownerKey]: expected } },
      source: 'primary',
    })
  })

  it('recovers from a corrupt primary using the last-good backup', () => {
    const target = draftsPath()
    const lastGood = draft({ text: 'last good' })
    writeComposerDraft(lastGood, target)
    writeComposerDraft(draft({ text: 'newer' }), target)
    fs.writeFileSync(target, '{"version":1')

    expect(readComposerDraft(lastGood.ownerKey, target)).toEqual(lastGood)
    expect(readComposerDraftsFile(target).source).toBe('backup')
    expect(fs.existsSync(composerDraftsBackupPath(target))).toBe(true)
  })

  it('rejects invalid persisted and IPC payloads before writing', () => {
    const target = draftsPath()
    expect(() => writeComposerDraft(draft({ ownerKey: '' }), target)).toThrow()
    expect(fs.existsSync(target)).toBe(false)

    electron.userDataPath = path.dirname(target)
    initComposerDraftsIpc()
    expect(() => electron.handlers.get('composer-drafts:read')?.({}, '')).toThrow()
    expect(() => electron.handlers.get('composer-drafts:write')?.({}, {
      ...draft(),
      bindingRevision: -1,
    })).toThrow()
    expect(() => electron.handlers.get('composer-drafts:delete')?.({}, { ownerKey: 'wrong-shape' })).toThrow()
  })

  it('overwrites only the draft with the same owner', () => {
    const target = draftsPath()
    const first = draft({ text: 'first' })
    const other = draft({
      ownerKey: 'project-1:window-2:0',
      windowId: 'window-2',
      bindingRevision: 0,
      text: 'other',
    })
    const replacement = draft({ text: 'replacement', updatedAt: first.updatedAt + 1 })

    writeComposerDraft(first, target)
    writeComposerDraft(other, target)
    writeComposerDraft(replacement, target)

    expect(readComposerDraft(first.ownerKey, target)).toEqual(replacement)
    expect(readComposerDraft(other.ownerKey, target)).toEqual(other)
    expect(Object.keys(readComposerDraftsFile(target).store.drafts)).toHaveLength(2)
  })

  it('logically deletes an owner entry while leaving other drafts intact', () => {
    const target = draftsPath()
    const first = draft()
    const other = draft({
      ownerKey: 'project-2:window-2:0',
      projectId: 'project-2',
      windowId: 'window-2',
      bindingRevision: 0,
    })
    writeComposerDraft(first, target)
    writeComposerDraft(other, target)

    expect(deleteComposerDraft(first.ownerKey, target)).toEqual({ ok: true })
    expect(readComposerDraft(first.ownerKey, target)).toBeNull()
    expect(readComposerDraft(other.ownerKey, target)).toEqual(other)
    expect(fs.existsSync(target)).toBe(true)
  })

  it('bounds persisted text, metadata, arrays, context inputs, and pending-send identifiers', () => {
    expect(() => composerDraftSchema.parse(draft({
      text: 'x'.repeat(COMPOSER_DRAFT_LIMITS.text + 1),
    }))).toThrow()
    expect(() => composerDraftSchema.parse(draft({
      mentions: Array.from({ length: COMPOSER_DRAFT_LIMITS.mentions + 1 }, () => draft().mentions[0]),
    }))).toThrow()
    expect(() => composerDraftSchema.parse(draft({
      attachmentPaths: Array.from({ length: COMPOSER_DRAFT_LIMITS.attachments + 1 }, (_, index) => `/tmp/${index}`),
    }))).toThrow()
    expect(() => composerDraftSchema.parse(draft({
      contextInputAttachments: [{
        id: 'context',
        label: 'inline image',
        input: { type: 'image', url: `data:image/png;base64,${'A'.repeat(COMPOSER_DRAFT_LIMITS.inputValue + 1)}` },
      }],
    }))).toThrow()
    expect(() => composerDraftSchema.parse(draft({
      pendingSend: { id: 'x'.repeat(COMPOSER_DRAFT_LIMITS.identifier + 1), startedAt: 1 },
    }))).toThrow()
  })

  it('rejects drafts and stores that exceed aggregate serialized-size bounds', () => {
    const largeInput = 'x'.repeat(COMPOSER_DRAFT_LIMITS.inputValue)
    expect(() => composerDraftSchema.parse(draft({
      contextInputAttachments: Array.from({ length: 5 }, (_, index) => ({
        id: `context-${index}`,
        label: `image-${index}`,
        input: { type: 'image' as const, url: largeInput },
      })),
    }))).toThrow(/serialized bytes/)

    const drafts = Object.fromEntries(Array.from({ length: 34 }, (_, index) => {
      const ownerKey = `owner-${index}`
      return [ownerKey, draft({
        ownerKey,
        windowId: `window-${index}`,
        text: 'x'.repeat(COMPOSER_DRAFT_LIMITS.text),
      })]
    }))
    expect(() => composerDraftsStoreSchema.parse({ version: 1, drafts })).toThrow(/serialized bytes/)
  })
})
