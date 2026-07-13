import type { CodexMessage } from '@/shared/codex'

export type ComposerHistorySnapshot<TSnapshot> =
  | { readonly captured: false }
  | { readonly captured: true; readonly value: TSnapshot }

export interface ComposerHistoryState<TSnapshot> {
  readonly prompts: readonly string[]
  readonly cursor: number
  readonly unsentSnapshot: ComposerHistorySnapshot<TSnapshot>
}

export type ComposerHistoryTarget<TSnapshot> =
  | { readonly kind: 'prompt'; readonly prompt: string }
  | { readonly kind: 'snapshot'; readonly snapshot: TSnapshot }

export interface ComposerHistoryNavigation<TSnapshot> {
  readonly state: ComposerHistoryState<TSnapshot>
  readonly target: ComposerHistoryTarget<TSnapshot> | null
}

export type ComposerHistoryDirection = 'previous' | 'next'

export function composerHistoryDirectionForKey({
  key,
  suggestionsOpen,
  atDocumentStart,
  atDocumentEnd,
}: {
  key: string
  suggestionsOpen: boolean
  atDocumentStart: boolean
  atDocumentEnd: boolean
}): ComposerHistoryDirection | null {
  if (suggestionsOpen) return null
  if (key === 'ArrowUp' && atDocumentStart) return 'previous'
  if (key === 'ArrowDown' && atDocumentEnd) return 'next'
  return null
}

export function isComposerHistoryPreview<TSnapshot>(state: ComposerHistoryState<TSnapshot>): boolean {
  return state.cursor < state.prompts.length
}

export function composerHistoryAutosaveValue<TSnapshot, TValue>(
  state: ComposerHistoryState<TSnapshot>,
  currentValue: TValue,
): TValue | null {
  return isComposerHistoryPreview(state) ? null : currentValue
}

export function composerHistoryFlushValue<TSnapshot, TValue>(
  state: ComposerHistoryState<TSnapshot>,
  currentValue: TValue,
  valueBeforePreview: TValue | null,
): TValue | null {
  return isComposerHistoryPreview(state) ? valueBeforePreview : currentValue
}

export function deriveSubmittedPromptHistory(messages: readonly CodexMessage[]): string[] {
  const submitted = messages
    .map((message, index) => ({ message, index }))
    .filter(({ message }) => message.role === 'user' && !message.pending && message.content.trim().length > 0)
    .sort((left, right) => left.message.timestamp - right.message.timestamp || left.index - right.index)

  const prompts: string[] = []
  for (const { message } of submitted) {
    if (prompts.at(-1) !== message.content) prompts.push(message.content)
  }
  return prompts
}

export function createComposerHistory<TSnapshot>(
  prompts: readonly string[],
): ComposerHistoryState<TSnapshot> {
  const promptCopy = [...prompts]
  return {
    prompts: promptCopy,
    cursor: promptCopy.length,
    unsentSnapshot: { captured: false },
  }
}

export function resetComposerHistory<TSnapshot>(
  state: ComposerHistoryState<TSnapshot>,
  prompts: readonly string[] = state.prompts,
): ComposerHistoryState<TSnapshot> {
  return createComposerHistory<TSnapshot>(prompts)
}

export function navigateComposerHistoryUp<TSnapshot>(
  state: ComposerHistoryState<TSnapshot>,
  currentSnapshot: TSnapshot,
): ComposerHistoryNavigation<TSnapshot> {
  if (state.cursor <= 0 || state.prompts.length === 0) return { state, target: null }

  const cursor = state.cursor - 1
  const prompt = state.prompts[cursor]
  if (prompt === undefined) return { state, target: null }

  const unsentSnapshot: ComposerHistorySnapshot<TSnapshot> = state.cursor === state.prompts.length
    ? { captured: true, value: currentSnapshot }
    : state.unsentSnapshot

  return {
    state: { ...state, cursor, unsentSnapshot },
    target: { kind: 'prompt', prompt },
  }
}

export function navigateComposerHistoryDown<TSnapshot>(
  state: ComposerHistoryState<TSnapshot>,
): ComposerHistoryNavigation<TSnapshot> {
  if (state.cursor >= state.prompts.length) return { state, target: null }

  const cursor = state.cursor + 1
  if (cursor === state.prompts.length) {
    const target = state.unsentSnapshot.captured
      ? { kind: 'snapshot' as const, snapshot: state.unsentSnapshot.value }
      : null
    return { state: { ...state, cursor }, target }
  }

  const prompt = state.prompts[cursor]
  if (prompt === undefined) return { state, target: null }
  return {
    state: { ...state, cursor },
    target: { kind: 'prompt', prompt },
  }
}
