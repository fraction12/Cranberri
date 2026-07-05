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
    diff: (repoPath: string) => ipcRenderer.invoke('git:diff', repoPath),
  },
}

export type CranberriAPI = typeof api

contextBridge.exposeInMainWorld('cranberri', api)
