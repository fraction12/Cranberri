import { useCallback, useEffect, useRef, useState } from 'react'
import type { ComposerDraft } from '@/shared/composer-drafts'

export function composerDraftOwnerKey(projectId: string, windowId: string, threadId?: string | null): string {
  const owner = threadId ? `thread:${threadId}` : `window:${windowId}`
  return `${encodeURIComponent(projectId)}/${encodeURIComponent(owner)}`
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
  options: { id?: string; startedAt?: number; threadId?: string },
): ComposerDraft {
  const startedAt = options.startedAt ?? Date.now()
  return {
    ...draft,
    updatedAt: startedAt,
    pendingSend: {
      id: options.id ?? crypto.randomUUID(),
      startedAt,
      ...(options.threadId ? { threadId: options.threadId } : {}),
    },
  }
}

interface ComposerDraftController {
  loaded: boolean
  restoredDraft: ComposerDraft | null
  persist: (draft: ComposerDraft) => Promise<void>
  beginSend: (draft: ComposerDraft, threadId?: string) => Promise<ComposerDraft>
  clear: () => Promise<void>
}

export function useComposerDraftController(ownerKey: string | null): ComposerDraftController {
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
      .then((draft) => {
        if (!cancelled && ownerRef.current === ownerKey) setRestoredDraft(draft)
      })
      .catch((error) => console.error('Failed to restore composer draft:', error))
      .finally(() => {
        if (!cancelled && ownerRef.current === ownerKey) setLoaded(true)
      })
    return () => { cancelled = true }
  }, [ownerKey])

  const persist = useCallback(async (draft: ComposerDraft) => {
    if (!ownerKey || ownerRef.current !== ownerKey) return
    if (composerDraftHasContent(draft) || draft.pendingSend) {
      await window.cranberri.composerDrafts.write(draft)
    } else {
      await window.cranberri.composerDrafts.delete(ownerKey)
    }
  }, [ownerKey])

  const beginSend = useCallback(async (draft: ComposerDraft, threadId?: string) => {
    const journaled = journalComposerDraftSend(draft, { threadId })
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
