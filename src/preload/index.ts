import { contextBridge, ipcRenderer } from 'electron'

const api = {
  getVersion: () => ipcRenderer.invoke('app:get-version'),
  getBuildInfo: () => ipcRenderer.invoke('app:build-info'),
  openExternal: (url: string) => ipcRenderer.invoke('app:open-external', url),
  health: {
    read: () => ipcRenderer.invoke('health:read'),
    doctor: () => ipcRenderer.invoke('health:doctor'),
  },
  appState: {
    read: () => ipcRenderer.invoke('app-state:read'),
    write: (state: import('@/shared/appState').CranberriAppState) => ipcRenderer.invoke('app-state:write', state),
  },
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
    githubSummary: (repoPath: string) => ipcRenderer.invoke('git:github-summary', repoPath),
    commit: (repoPath: string, title: string, summary: string) => ipcRenderer.invoke('git:commit', repoPath, title, summary),
  },
  github: {
    panelData: (repoPath: string, kind: import('@/shared/git').GitHubPanelKind) => ipcRenderer.invoke('github:panel-data', repoPath, kind),
  },
  codex: {
    start: (cwd: string) => ipcRenderer.invoke('codex:start', cwd),
    createThread: (cwd: string, settings?: unknown) => ipcRenderer.invoke('codex:create-thread', cwd, settings),
    sendMessage: (cwd: string, threadId: string, input: import('@/shared/codex').CodexUserInput[], settings?: unknown) => ipcRenderer.invoke('codex:send-message', cwd, threadId, input, settings),
    compactThread: (cwd: string, threadId: string) => ipcRenderer.invoke('codex:compact-thread', cwd, threadId),
    approve: (cwd: string, threadId: string, event: unknown) => ipcRenderer.invoke('codex:approve', cwd, threadId, event),
    interrupt: (cwd: string, threadId: string) => ipcRenderer.invoke('codex:interrupt', cwd, threadId),
    stop: (cwd: string) => ipcRenderer.invoke('codex:stop', cwd),
    plugins: () => ipcRenderer.invoke('codex:plugins'),
    skills: () => ipcRenderer.invoke('codex:skills'),
    pickFiles: () => ipcRenderer.invoke('codex:pick-files'),
    listThreads: (cwd: string, options?: unknown) => ipcRenderer.invoke('codex:threads:list', cwd, options),
    readThread: (cwd: string, threadId: string, archived?: boolean) => ipcRenderer.invoke('codex:threads:read', cwd, threadId, archived),
    resumeThread: (cwd: string, threadId: string, settings?: unknown) => ipcRenderer.invoke('codex:threads:resume', cwd, threadId, settings),
    archiveThread: (cwd: string, threadId: string) => ipcRenderer.invoke('codex:threads:archive', cwd, threadId),
    unarchiveThread: (cwd: string, threadId: string) => ipcRenderer.invoke('codex:threads:unarchive', cwd, threadId),
    deleteThread: (cwd: string, threadId: string) => ipcRenderer.invoke('codex:threads:delete', cwd, threadId),
    renameThread: (cwd: string, threadId: string, name: string) => ipcRenderer.invoke('codex:threads:rename', cwd, threadId, name),
    getConnectionStatus: () => ipcRenderer.invoke('codex:connection:status'),
    connect: () => ipcRenderer.invoke('codex:connection:connect'),
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
    snapshot: (id: string) => ipcRenderer.invoke('terminal:snapshot', id),
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
    terminate: (repoPath: string, processId: string) => ipcRenderer.invoke('processes:terminate', repoPath, processId),
  },
  update: {
    check: () => ipcRenderer.invoke('updater:check') as Promise<import('@/shared/update').UpdateInfo>,
    status: () => ipcRenderer.invoke('updater:status') as Promise<import('@/shared/update').UpdateInfo>,
    install: () => ipcRenderer.invoke('updater:install') as Promise<import('@/shared/update').InstallResult>,
    onEvent: (cb: (event: import('@/shared/update').UpdateEvent) => void) => {
      const handler = (_: unknown, payload: import('@/shared/update').UpdateEvent) => cb(payload)
      ipcRenderer.on('updater:event', handler)
      return () => ipcRenderer.removeListener('updater:event', handler)
    },
    pendingResult: () => ipcRenderer.invoke('updater:pending-result') as Promise<import('@/shared/update').InstallResult | null>,
    clearResult: () => ipcRenderer.invoke('updater:clear-result') as Promise<{ ok: boolean }>,
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (settings: import('@/shared/settings').AppSettings) => ipcRenderer.invoke('settings:set', settings),
  },
  telemetry: {
    log: (source: string, type: string, payload?: unknown) => ipcRenderer.invoke('telemetry:log', source, type, payload),
    read: (limit?: number) => ipcRenderer.invoke('telemetry:read', limit),
    clear: () => ipcRenderer.invoke('telemetry:clear'),
    path: () => ipcRenderer.invoke('telemetry:path'),
  },
}

export type CranberriAPI = typeof api

contextBridge.exposeInMainWorld('cranberri', api)
