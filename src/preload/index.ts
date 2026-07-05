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
  },
  codex: {
    start: (cwd: string) => ipcRenderer.invoke('codex:start', cwd),
    createThread: (cwd: string) => ipcRenderer.invoke('codex:create-thread', cwd),
    sendMessage: (cwd: string, threadId: string, content: string) => ipcRenderer.invoke('codex:send-message', cwd, threadId, content),
    approve: (cwd: string, threadId: string, approvalId: string) => ipcRenderer.invoke('codex:approve', cwd, threadId, approvalId),
    interrupt: (cwd: string, threadId: string) => ipcRenderer.invoke('codex:interrupt', cwd, threadId),
    stop: (cwd: string) => ipcRenderer.invoke('codex:stop', cwd),
    onEvent: (cb: (event: unknown) => void) => {
      const handler = (_: unknown, event: unknown) => cb(event)
      ipcRenderer.on('codex:event', handler)
      return () => ipcRenderer.off('codex:event', handler)
    },
  },
}

export type CranberriAPI = typeof api

contextBridge.exposeInMainWorld('cranberri', api)
