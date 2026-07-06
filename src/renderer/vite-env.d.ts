import type { DiffResult, GitFileStatus, FileTreeNode, GitHubRepoSummary } from '@/shared/git'
import type { CodexConnectionStatus, CodexEvent, CodexPluginInfo, CodexSessionSummary, CodexSessionThread, CodexTurnSettings } from '@/shared/codex'
import type { AgentProcessInfo } from '@/shared/processes'
import type { CranberriHealthReport } from '@/shared/health'
import type { CranberriAppState } from '@/shared/appState'

declare module '@xterm/xterm/css/xterm.css'
declare module '*.css' {
  const content: string
  export default content
}

export {}

declare global {
  interface Window {
    cranberri: {
      getVersion: () => Promise<string>
      openExternal: (url: string) => Promise<void>
      health: {
        read: () => Promise<CranberriHealthReport>
        doctor: () => Promise<CranberriHealthReport>
      }
      appState: {
        read: () => Promise<CranberriAppState>
        write: (state: CranberriAppState) => Promise<CranberriAppState>
      }
      repos: {
        list: () => Promise<{ repos: Array<{ id: string; name: string; path: string }>; activeRepoId: string | null }>
        add: (path: string) => Promise<{ repos: Array<{ id: string; name: string; path: string }>; activeRepoId: string | null }>
        remove: (id: string) => Promise<{ repos: Array<{ id: string; name: string; path: string }>; activeRepoId: string | null }>
        setActive: (id: string) => Promise<{ repos: Array<{ id: string; name: string; path: string }>; activeRepoId: string | null }>
        pickDirectory: () => Promise<string | null>
      }
      git: {
        status: (repoPath: string) => Promise<GitFileStatus[]>
        files: (repoPath: string) => Promise<FileTreeNode[]>
        diff: (repoPath: string) => Promise<DiffResult>
        diffFile: (repoPath: string, filePath: string) => Promise<DiffResult>
        rawContent: (repoPath: string, filePath: string, ref: 'HEAD' | 'WORKING') => Promise<string>
        githubSummary: (repoPath: string) => Promise<GitHubRepoSummary>
      }
      codex: {
        start: (cwd: string) => Promise<{ started: boolean }>
        createThread: (cwd: string) => Promise<{ threadId: string }>
        sendMessage: (cwd: string, threadId: string, content: string, settings?: CodexTurnSettings) => Promise<{ ok: boolean }>
        approve: (cwd: string, threadId: string, approvalId: string) => Promise<{ ok: boolean }>
        interrupt: (cwd: string, threadId: string) => Promise<{ ok: boolean }>
        stop: (cwd: string) => Promise<{ stopped: boolean }>
        plugins: () => Promise<{ plugins: CodexPluginInfo[] }>
        pickFiles: () => Promise<{ paths: string[] }>
        listThreads: (cwd: string, options?: { archived?: boolean; cursor?: string | null; limit?: number; searchTerm?: string | null }) => Promise<{ sessions: CodexSessionSummary[]; nextCursor?: string | null; backwardsCursor?: string | null }>
        readThread: (cwd: string, threadId: string, archived?: boolean) => Promise<{ thread: CodexSessionThread }>
        resumeThread: (cwd: string, threadId: string, settings?: CodexTurnSettings) => Promise<{ thread: CodexSessionThread }>
        archiveThread: (cwd: string, threadId: string) => Promise<{ ok: boolean }>
        unarchiveThread: (cwd: string, threadId: string) => Promise<{ thread: CodexSessionThread }>
        deleteThread: (cwd: string, threadId: string) => Promise<{ ok: boolean }>
        renameThread: (cwd: string, threadId: string, name: string) => Promise<{ ok: boolean }>
        getConnectionStatus: () => Promise<CodexConnectionStatus>
        connect: () => Promise<CodexConnectionStatus>
        getRateLimits: () => Promise<import('@/shared/codex').CodexRateLimitsReadResult>
        consumeRateLimitResetCredit: () => Promise<{ outcome: string }>
        onEvent: (cb: (event: CodexEvent) => void) => () => void
      }
      terminal: {
        create: (id: string, cwd: string, cols?: number, rows?: number) => Promise<{ pid: number; buffer?: string }>
        snapshot: (id: string) => Promise<{ buffer: string }>
        write: (id: string, data: string) => Promise<void>
        resize: (id: string, cols: number, rows: number) => Promise<void>
        kill: (id: string) => Promise<void>
        onData: (cb: (payload: { id: string; data: string }) => void) => () => void
        onExit: (cb: (payload: { id: string; exitCode: number; signal?: number }) => void) => () => void
      }
      processes: {
        list: (repoPath: string) => Promise<{ processes: AgentProcessInfo[] }>
        terminate: (repoPath: string, processId: string) => Promise<{ process: AgentProcessInfo }>
      }
      settings: {
        get: () => Promise<{ settings: import('@/shared/settings').AppSettings }>
        set: (settings: import('@/shared/settings').AppSettings) => Promise<{ settings: import('@/shared/settings').AppSettings }>
      }
    }
  }
}
