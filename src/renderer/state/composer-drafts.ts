import { useCallback, useEffect, useRef, useState } from 'react'
import type { ComposerDraft } from '@/shared/composer-drafts'

export function composerDraftOwnerKey(projectId: string, windowId: string, threadId?: string | null): string {
  void threadId
  const owner = `window:${windowId}`
  return `${encodeURIComponent(projectId)}/${encodeURIComponent(owner)}`
}

export function legacyComposerDraftOwnerKey(projectId: string, threadId?: string | null): string | null {
  return threadId ? `${encodeURIComponent(projectId)}/${encodeURIComponent(`thread:${threadId}`)}` : null
}

export function sameComposerDraftPayload(left: ComposerDraft, right: ComposerDraft): boolean {
  const comparable = (draft: ComposerDraft) => ({
    text: draft.text,
    mentions: draft.mentions,
    attachmentPaths: draft.attachmentPaths,
    contextInputAttachments: draft.contextInputAttachments,
    turnSettings: draft.turnSettings,
    planMode: draft.planMode,
    goalMode: draft.goalMode,
    baseRef: draft.baseRef,
    environmentId: draft.environmentId,
    includeLocalChanges: draft.includeLocalChanges,
  })
  return JSON.stringify(comparable(left)) === JSON.stringify(comparable(right))
}

export function composerDraftHasContent(draft: ComposerDraft): boolean {
  return Boolean(
    draft.text.trim()
    || draft.mentions.length
    || draft.attachmentPaths.length
    || draft.contextInputAttachments.length
    || draft.planMode
    || draft.goalMode,
  )
}

export function journalComposerDraftSend(
  draft: ComposerDraft,
  options: { id?: string; startedAt?: number; threadId?: string; reusePending?: boolean },
): ComposerDraft {
  const existing = options.id || options.reusePending === false ? undefined : draft.pendingSend
  const startedAt = existing?.startedAt ?? options.startedAt ?? Date.now()
  return {
    ...draft,
    updatedAt: startedAt,
    pendingSend: {
      id: options.id ?? existing?.id ?? crypto.randomUUID(),
      startedAt,
      ...(options.threadId || existing?.threadId ? { threadId: options.threadId ?? existing?.threadId } : {}),
    },
  }
}

interface ComposerDraftController {
  loaded: boolean
  restoredDraft: ComposerDraft | null
  persist: (draft: ComposerDraft) => Promise<void>
  beginSend: (draft: ComposerDraft, threadId?: string, id?: string | null) => Promise<ComposerDraft>
  clear: () => Promise<void>
}

export function useComposerDraftController(ownerKey: string | null, legacyOwnerKey: string | null = null): ComposerDraftController {
  const [loaded, setLoaded] = useState(false)
  const [restoredDraft, setRestoredDraft] = useState<ComposerDraft | null>(null)
  const ownerRef = useRef(ownerKey)
  ownerRef.current = ownerKey

  useEffect(() => {
    let cancelled = false
    setLoaded(false)
    setRestoredDraft(null)
    if (!ownerKey) {
      setLoaded(true)
      return () => { cancelled = true }
    }
    window.cranberri.composerDrafts.read(ownerKey)
      .then(async (draft) => {
        if (draft || !legacyOwnerKey) return draft
        const legacy = await window.cranberri.composerDrafts.read(legacyOwnerKey)
        if (!legacy) return null
        const migrated = { ...legacy, ownerKey }
        try {
          await window.cranberri.composerDrafts.write(migrated)
          await window.cranberri.composerDrafts.delete(legacyOwnerKey)
        } catch (error) {
          console.error('Failed to migrate legacy composer draft:', error)
        }
        return migrated
      })
      .then((draft) => {
        if (!cancelled && ownerRef.current === ownerKey) setRestoredDraft(draft)
      })
      .catch((error) => console.error('Failed to restore composer draft:', error))
      .finally(() => {
        if (!cancelled && ownerRef.current === ownerKey) setLoaded(true)
      })
    return () => { cancelled = true }
  }, [legacyOwnerKey, ownerKey])

  const persist = useCallback(async (draft: ComposerDraft) => {
    if (!ownerKey || ownerRef.current !== ownerKey) return
    if (composerDraftHasContent(draft) || draft.pendingSend) {
      await window.cranberri.composerDrafts.write(draft)
    } else {
      await window.cranberri.composerDrafts.delete(ownerKey)
    }
  }, [ownerKey])

  const beginSend = useCallback(async (draft: ComposerDraft, threadId?: string, id?: string | null) => {
    const journaled = journalComposerDraftSend(draft, {
      threadId,
      ...(id ? { id } : {}),
      reusePending: id !== null,
    })
    await persist(journaled)
    return journaled
  }, [persist])

  const clear = useCallback(async () => {
    if (!ownerKey || ownerRef.current !== ownerKey) return
    await window.cranberri.composerDrafts.delete(ownerKey)
    setRestoredDraft(null)
  }, [ownerKey])

  return { loaded, restoredDraft, persist, beginSend, clear }
}
