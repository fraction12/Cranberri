export type ThreadLifecycleInspection =
  | { threadId: string; state: 'active' | 'archived'; cwd: string }
  | { threadId: string; state: 'missing'; cwd: null }

export interface CodexThreadLifecycleGateway {
  inspectThreadLifecycle(threadId: string): Promise<ThreadLifecycleInspection>
  archiveThread(threadId: string): Promise<void>
  unarchiveThread(threadId: string): Promise<unknown>
  deleteThread(threadId: string): Promise<void>
}

export class ThreadLifecycleDisagreementError extends Error {
  constructor(
    readonly threadId: string,
    readonly cwd: string | null,
    readonly listedActive: boolean,
    readonly listedArchived: boolean,
  ) {
    const detail = cwd
      ? `thread/read succeeded for ${cwd}, but thread/list reported active=${listedActive} and archived=${listedArchived}`
      : 'thread/read succeeded without an authoritative cwd'
    super(`Codex thread lifecycle disagreement for ${threadId}: ${detail}`)
    this.name = 'ThreadLifecycleDisagreementError'
  }
}

export function isAuthoritativeMissingThreadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /\bthread (?:not found|not loaded)\b/i.test(message)
}

export function classifyThreadLifecycle(
  threadId: string,
  cwd: string,
  listedActive: boolean,
  listedArchived: boolean,
): ThreadLifecycleInspection {
  if (listedActive !== listedArchived) {
    return { threadId, state: listedActive ? 'active' : 'archived', cwd }
  }
  throw new ThreadLifecycleDisagreementError(threadId, cwd, listedActive, listedArchived)
}
