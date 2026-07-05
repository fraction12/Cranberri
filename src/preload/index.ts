import { contextBridge, ipcRenderer } from 'electron'

const api = {
  getVersion: () => ipcRenderer.invoke('app:get-version'),
}

export type CranberriAPI = typeof api

contextBridge.exposeInMainWorld('cranberri', api)
