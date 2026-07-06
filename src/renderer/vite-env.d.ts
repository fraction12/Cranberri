import type { DiffResult, GitFileStatus, FileTreeNode } from '@/shared/git'
import type { CodexEvent, CodexPluginInfo, CodexTurnSettings } from '@/shared/codex'

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
        onEvent: (cb: (event: CodexEvent) => void) => () => void
      }
      terminal: {
        create: (id: string, cwd: string, cols?: number, rows?: number) => Promise<{ pid: number }>
        write: (id: string, data: string) => Promise<void>
        resize: (id: string, cols: number, rows: number) => Promise<void>
        kill: (id: string) => Promise<void>
        onData: (cb: (payload: { id: string; data: string }) => void) => () => void
        onExit: (cb: (payload: { id: string; exitCode: number; signal?: number }) => void) => () => void
      }
      settings: {
        get: () => Promise<{ settings: import('@/shared/settings').AppSettings }>
        set: (settings: import('@/shared/settings').AppSettings) => Promise<{ settings: import('@/shared/settings').AppSettings }>
      }
    }
  }
}
