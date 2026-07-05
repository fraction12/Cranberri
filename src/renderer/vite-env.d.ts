import type { DiffResult, GitFileStatus } from '@/shared/git'
import type { CodexEvent } from '@/shared/codex'

export {}

declare global {
  interface Window {
    cranberri: {
      getVersion: () => Promise<string>
      repos: {
        list: () => Promise<{ repos: Array<{ id: string; name: string; path: string }>; activeRepoId: string | null }>
        add: (path: string) => Promise<{ repos: Array<{ id: string; name: string; path: string }>; activeRepoId: string | null }>
        remove: (id: string) => Promise<{ repos: Array<{ id: string; name: string; path: string }>; activeRepoId: string | null }>
        setActive: (id: string) => Promise<{ repos: Array<{ id: string; name: string; path: string }>; activeRepoId: string | null }>
        pickDirectory: () => Promise<string | null>
      }
      git: {
        status: (repoPath: string) => Promise<GitFileStatus[]>
        diff: (repoPath: string) => Promise<DiffResult>
      }
      codex: {
        start: (cwd: string) => Promise<{ started: boolean }>
        createThread: (cwd: string) => Promise<{ threadId: string }>
        sendMessage: (cwd: string, threadId: string, content: string) => Promise<{ ok: boolean }>
        approve: (cwd: string, threadId: string, approvalId: string) => Promise<{ ok: boolean }>
        interrupt: (cwd: string, threadId: string) => Promise<{ ok: boolean }>
        stop: (cwd: string) => Promise<{ stopped: boolean }>
        onEvent: (cb: (event: CodexEvent) => void) => () => void
      }
    }
  }
}
