import { contextBridge, ipcRenderer } from 'electron'

const api = {
  getVersion: () => ipcRenderer.invoke('app:get-version'),
  repos: {
    list: () => ipcRenderer.invoke('repos:list'),
    add: (path: string) => ipcRenderer.invoke('repos:add', path),
    remove: (id: string) => ipcRenderer.invoke('repos:remove', id),
    setActive: (id: string) => ipcRenderer.invoke('repos:set-active', id),
    pickDirectory: () => ipcRenderer.invoke('repos:pick-directory'),
  },
  git: {
    status: (repoPath: string) => ipcRenderer.invoke('git:status', repoPath),
    files: (repoPath: string) => ipcRenderer.invoke('git:files', repoPath),
    diff: (repoPath: string) => ipcRenderer.invoke('git:diff', repoPath),
    diffFile: (repoPath: string, filePath: string) => ipcRenderer.invoke('git:diff-file', repoPath, filePath),
    rawContent: (repoPath: string, filePath: string, ref: 'HEAD' | 'WORKING') => ipcRenderer.invoke('git:raw-content', repoPath, filePath, ref),
  },
  codex: {
    start: (cwd: string) => ipcRenderer.invoke('codex:start', cwd),
    createThread: (cwd: string) => ipcRenderer.invoke('codex:create-thread', cwd),
    sendMessage: (cwd: string, threadId: string, content: string, settings?: unknown) => ipcRenderer.invoke('codex:send-message', cwd, threadId, content, settings),
    approve: (cwd: string, threadId: string, approvalId: string) => ipcRenderer.invoke('codex:approve', cwd, threadId, approvalId),
    interrupt: (cwd: string, threadId: string) => ipcRenderer.invoke('codex:interrupt', cwd, threadId),
    stop: (cwd: string) => ipcRenderer.invoke('codex:stop', cwd),
    plugins: () => ipcRenderer.invoke('codex:plugins'),
    pickFiles: () => ipcRenderer.invoke('codex:pick-files'),
    listThreads: (cwd: string, options?: unknown) => ipcRenderer.invoke('codex:threads:list', cwd, options),
    readThread: (cwd: string, threadId: string, archived?: boolean) => ipcRenderer.invoke('codex:threads:read', cwd, threadId, archived),
    resumeThread: (cwd: string, threadId: string, settings?: unknown) => ipcRenderer.invoke('codex:threads:resume', cwd, threadId, settings),
    archiveThread: (cwd: string, threadId: string) => ipcRenderer.invoke('codex:threads:archive', cwd, threadId),
    unarchiveThread: (cwd: string, threadId: string) => ipcRenderer.invoke('codex:threads:unarchive', cwd, threadId),
    deleteThread: (cwd: string, threadId: string) => ipcRenderer.invoke('codex:threads:delete', cwd, threadId),
    renameThread: (cwd: string, threadId: string, name: string) => ipcRenderer.invoke('codex:threads:rename', cwd, threadId, name),
    getRateLimits: () => ipcRenderer.invoke('codex:account:rateLimits'),
    consumeRateLimitResetCredit: () => ipcRenderer.invoke('codex:account:consumeResetCredit'),
    onEvent: (cb: (event: unknown) => void) => {
      const handler = (_: unknown, event: unknown) => cb(event)
      ipcRenderer.on('codex:event', handler)
      return () => ipcRenderer.off('codex:event', handler)
    },
  },
  terminal: {
    create: (id: string, cwd: string, cols?: number, rows?: number) => ipcRenderer.invoke('terminal:create', id, cwd, cols, rows),
    write: (id: string, data: string) => ipcRenderer.invoke('terminal:write', id, data),
    resize: (id: string, cols: number, rows: number) => ipcRenderer.invoke('terminal:resize', id, cols, rows),
    kill: (id: string) => ipcRenderer.invoke('terminal:kill', id),
    onData: (cb: (payload: { id: string; data: string }) => void) => {
      const handler = (_: unknown, payload: { id: string; data: string }) => cb(payload)
      ipcRenderer.on('terminal:data', handler)
      return () => ipcRenderer.off('terminal:data', handler)
    },
    onExit: (cb: (payload: { id: string; exitCode: number; signal?: number }) => void) => {
      const handler = (_: unknown, payload: { id: string; exitCode: number; signal?: number }) => cb(payload)
      ipcRenderer.on('terminal:exit', handler)
      return () => ipcRenderer.off('terminal:exit', handler)
    },
  },
  processes: {
    list: (repoPath: string) => ipcRenderer.invoke('processes:list', repoPath),
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (settings: import('@/shared/settings').AppSettings) => ipcRenderer.invoke('settings:set', settings),
  },
}

export type CranberriAPI = typeof api

contextBridge.exposeInMainWorld('cranberri', api)
