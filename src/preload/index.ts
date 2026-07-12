import { contextBridge, ipcRenderer } from 'electron'

const api = {
  getVersion: () => ipcRenderer.invoke('app:get-version'),
  getBuildInfo: () => ipcRenderer.invoke('app:build-info'),
  openExternal: (url: string) => ipcRenderer.invoke('app:open-external', url),
  openPath: (path: string) => ipcRenderer.invoke('app:open-path', path),
  revealPath: (path: string) => ipcRenderer.invoke('app:reveal-path', path),
  exportTextFile: (params: import('@/shared/app').ExportTextFileParams) => ipcRenderer.invoke('app:export-text-file', params),
  health: {
    read: () => ipcRenderer.invoke('health:read'),
    doctor: () => ipcRenderer.invoke('health:doctor'),
    diagnostics: () => ipcRenderer.invoke('health:diagnostics'),
  },
  nativeHelpers: {
    openSettings: (target: import('@/shared/nativeHelpers').NativeHelperSettingsTarget) => ipcRenderer.invoke('native-helpers:open-settings', target),
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
    draftCommitMessage: (repoPath: string) => ipcRenderer.invoke('git:commit-message:draft', repoPath),
    taskStatus: (taskId: string) => ipcRenderer.invoke('git:task:status', { taskId }),
    taskFiles: (taskId: string) => ipcRenderer.invoke('git:task:files', { taskId }),
    taskDiff: (taskId: string) => ipcRenderer.invoke('git:task:diff', { taskId }),
    taskDiffFile: (taskId: string, filePath: string) => ipcRenderer.invoke('git:task:diff-file', { taskId, filePath }),
    taskRawContent: (taskId: string, filePath: string, ref: 'HEAD' | 'WORKING') => ipcRenderer.invoke('git:task:raw-content', { taskId, filePath }, ref),
    taskCommit: (taskId: string, title: string, summary: string) => ipcRenderer.invoke('git:task:commit', { taskId }, title, summary),
  },
  github: {
    panelData: (repoPath: string, kind: import('@/shared/git').GitHubPanelKind) => ipcRenderer.invoke('github:panel-data', repoPath, kind),
  },
  search: {
    repo: (repoPath: string, options: import('@/shared/search').RepoSearchOptions) => ipcRenderer.invoke('search:repo', repoPath, options),
    files: (repoPath: string, options: import('@/shared/search').RepoFileSearchOptions) => ipcRenderer.invoke('search:repo-files', repoPath, options),
    previewFile: (repoPath: string, filePath: string, maxBytes?: number) => ipcRenderer.invoke('search:preview-file', repoPath, filePath, maxBytes),
    watchStart: (repoPath: string) => ipcRenderer.invoke('search:watch:start', repoPath),
    watchStop: (repoPath: string) => ipcRenderer.invoke('search:watch:stop', repoPath),
    taskRepo: (taskId: string, options: import('@/shared/search').RepoSearchOptions) => ipcRenderer.invoke('search:task:repo', { taskId }, options),
    taskFiles: (taskId: string, options: import('@/shared/search').RepoFileSearchOptions) => ipcRenderer.invoke('search:task:repo-files', { taskId }, options),
    taskPreviewFile: (taskId: string, filePath: string, maxBytes?: number) => ipcRenderer.invoke('search:task:preview-file', { taskId, filePath }, maxBytes),
    taskWatchStart: (taskId: string) => ipcRenderer.invoke('search:task:watch:start', { taskId }),
    taskWatchStop: (taskId: string) => ipcRenderer.invoke('search:task:watch:stop', { taskId }),
    onRepoChanged: (cb: (event: import('@/shared/search').RepoWatchEvent) => void) => {
      const handler = (_: unknown, payload: import('@/shared/search').RepoWatchEvent) => cb(payload)
      ipcRenderer.on('search:repo-changed', handler)
      return () => ipcRenderer.off('search:repo-changed', handler)
    },
  },
  codex: {
    start: (cwd: string) => ipcRenderer.invoke('codex:start', cwd),
    createThread: (cwd: string, settings?: unknown) => ipcRenderer.invoke('codex:create-thread', cwd, settings),
    sendMessage: (cwd: string, threadId: string, input: import('@/shared/codex').CodexUserInput[], settings?: unknown) => ipcRenderer.invoke('codex:send-message', cwd, threadId, input, settings),
    steerThread: (cwd: string, threadId: string, input: import('@/shared/codex').CodexUserInput[]) => ipcRenderer.invoke('codex:steer-thread', cwd, threadId, input),
    controlWorker: (
      cwd: string,
      parentThreadId: string,
      workerThreadId: string,
      action: import('@/shared/codex-worker-control').CodexWorkerControlAction,
      input: import('@/shared/codex').CodexUserInput[],
    ) => ipcRenderer.invoke('codex:control-worker', cwd, parentThreadId, workerThreadId, action, input),
    compactThread: (cwd: string, threadId: string) => ipcRenderer.invoke('codex:compact-thread', cwd, threadId),
    approve: (cwd: string, threadId: string, event: unknown) => ipcRenderer.invoke('codex:approve', cwd, threadId, event),
    interrupt: (cwd: string, threadId: string) => ipcRenderer.invoke('codex:interrupt', cwd, threadId),
    stop: (cwd: string) => ipcRenderer.invoke('codex:stop', cwd),
    plugins: () => ipcRenderer.invoke('codex:plugins'),
    installPlugin: (pluginId: string) => ipcRenderer.invoke('codex:plugins:install', pluginId),
    upgradePluginMarketplaces: () => ipcRenderer.invoke('codex:plugins:marketplaces:upgrade'),
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
    getAccountUsage: () => ipcRenderer.invoke('codex:account:usage'),
    consumeRateLimitResetCredit: () => ipcRenderer.invoke('codex:account:consumeResetCredit'),
    onEvent: (cb: (event: unknown) => void) => {
      const handler = (_: unknown, event: unknown) => cb(event)
      ipcRenderer.on('codex:event', handler)
      return () => ipcRenderer.off('codex:event', handler)
    },
  },
  tasks: {
    snapshot: () => ipcRenderer.invoke('tasks:snapshot'),
    list: (projectId?: string) => ipcRenderer.invoke('tasks:list', { projectId }),
    createLocalDraft: (request: import('@/shared/tasks').LocalTaskDraftRequest): Promise<{ task: import('@/shared/tasks').Task }> => ipcRenderer.invoke('tasks:create-local-draft', request),
    adoptLocalThread: (request: import('@/shared/tasks').LocalTaskAdoptRequest): Promise<{ task: import('@/shared/tasks').Task }> => ipcRenderer.invoke('tasks:adopt-local-thread', request),
    history: (request: import('@/shared/tasks').TaskHistoryRequest) => ipcRenderer.invoke('tasks:history', request),
    read: (taskId: string, archived?: boolean) => ipcRenderer.invoke('tasks:read', { taskId, archived }),
    resume: (taskId: string) => ipcRenderer.invoke('tasks:resume', { taskId }),
    send: (request: import('@/shared/tasks').TaskSendRequest) => ipcRenderer.invoke('tasks:send', request),
    createWorktreeDraft: (request: import('@/shared/tasks').TaskDraftRequest) => ipcRenderer.invoke('tasks:create-worktree-draft', request),
    provision: (request: import('@/shared/tasks').TaskProvisionRequest) => ipcRenderer.invoke('tasks:provision', request),
    continueInWorktree: (taskId: string): Promise<{ task: import('@/shared/tasks').Task; warning: string | null; includedLocalChanges: boolean }> => ipcRenderer.invoke('tasks:continue-in-worktree', { taskId }),
    status: (taskId: string) => ipcRenderer.invoke('tasks:status', { taskId }),
    handoffToLocal: (request: import('@/shared/tasks').TaskHandoffRequest) => ipcRenderer.invoke('tasks:handoff-local', request),
    handoffToWorktree: (request: import('@/shared/tasks').TaskHandoffRequest) => ipcRenderer.invoke('tasks:handoff-worktree', request),
    archive: (taskId: string) => ipcRenderer.invoke('tasks:archive', { taskId }),
    unarchive: (taskId: string) => ipcRenderer.invoke('tasks:unarchive', { taskId }),
    delete: (taskId: string): Promise<{ ok: true }> => ipcRenderer.invoke('tasks:delete', { taskId }),
  },
  worktrees: {
    listRefs: (projectId: string) => ipcRenderer.invoke('worktrees:refs:list', { projectId }),
    refreshRefs: (projectId: string) => ipcRenderer.invoke('worktrees:refs:refresh', { projectId }),
  },
  terminal: {
    create: (id: string, cwd: string, cols?: number, rows?: number) => ipcRenderer.invoke('terminal:create', id, cwd, cols, rows),
    createForTask: (request: import('@/shared/terminal').TaskTerminalCreateRequest) => ipcRenderer.invoke('terminal:task:create', request),
    snapshot: (id: string) => ipcRenderer.invoke('terminal:snapshot', id),
    clear: (id: string) => ipcRenderer.invoke('terminal:clear', id),
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
  environments: {
    list: (projectId: string) => ipcRenderer.invoke('environments:list', { projectId }),
    read: (projectId: string, environmentId: string) => ipcRenderer.invoke('environments:read', { projectId, environmentId }),
    save: (request: import('@/shared/environments').EnvironmentSaveRequest) => ipcRenderer.invoke('environments:save', request),
    trust: (projectId: string, environmentId: string, revision: string) => ipcRenderer.invoke('environments:trust', { projectId, environmentId, revision }),
    delete: (projectId: string, environmentId: string) => ipcRenderer.invoke('environments:delete', { projectId, environmentId }),
    setDefault: (projectId: string, environmentId: string | null) => ipcRenderer.invoke('environments:set-default', { projectId, environmentId }),
    startSetup: (request: import('@/shared/terminal').EnvironmentSetupRequest) => ipcRenderer.invoke('environments:setup:start', request),
    retrySetup: (request: import('@/shared/terminal').EnvironmentSetupRequest) => ipcRenderer.invoke('environments:setup:retry', request),
    startTest: (request: import('@/shared/terminal').EnvironmentTestRequest) => ipcRenderer.invoke('environments:test:start', request),
    snapshotJob: (jobId: string) => ipcRenderer.invoke('environments:job:snapshot', { jobId }),
    writeJob: (jobId: string, data: string) => ipcRenderer.invoke('environments:job:write', { jobId, data }),
    cancelJob: (jobId: string) => ipcRenderer.invoke('environments:job:cancel', { jobId }),
    openAction: (request: import('@/shared/terminal').EnvironmentActionRequest) => ipcRenderer.invoke('environments:action:open', request),
    onJobData: (cb: (payload: import('@/shared/terminal').EnvironmentJobDataEvent) => void) => {
      const handler = (_: unknown, payload: import('@/shared/terminal').EnvironmentJobDataEvent) => cb(payload)
      ipcRenderer.on('environments:job:data', handler)
      return () => ipcRenderer.off('environments:job:data', handler)
    },
    onJobExit: (cb: (payload: import('@/shared/terminal').EnvironmentJobExitEvent) => void) => {
      const handler = (_: unknown, payload: import('@/shared/terminal').EnvironmentJobExitEvent) => cb(payload)
      ipcRenderer.on('environments:job:exit', handler)
      return () => ipcRenderer.off('environments:job:exit', handler)
    },
  },
  processes: {
    list: (repoPath: string) => ipcRenderer.invoke('processes:list', repoPath),
    terminate: (repoPath: string, processId: string) => ipcRenderer.invoke('processes:terminate', repoPath, processId),
    listForTask: (taskId: string) => ipcRenderer.invoke('processes:task:list', { taskId }),
    terminateForTask: (taskId: string, processId: string) => ipcRenderer.invoke('processes:task:terminate', { taskId }, processId),
  },
  browser: {
    attach: (params: import('@/shared/browser').BrowserAttachParams) => ipcRenderer.invoke('browser:attach', params),
    attachForTask: (params: import('@/shared/browser').TaskBrowserAttachParams) => ipcRenderer.invoke('browser:task:attach', params),
    bounds: (windowId: string, bounds: import('@/shared/browser').BrowserBounds) => ipcRenderer.invoke('browser:bounds', windowId, bounds),
    detach: (windowId: string) => ipcRenderer.invoke('browser:detach', windowId),
    destroy: (windowId: string) => ipcRenderer.invoke('browser:destroy', windowId),
    navigate: (windowId: string, url: string) => ipcRenderer.invoke('browser:navigate', windowId, url),
    reload: (windowId: string) => ipcRenderer.invoke('browser:reload', windowId),
    stop: (windowId: string) => ipcRenderer.invoke('browser:stop', windowId),
    back: (windowId: string) => ipcRenderer.invoke('browser:back', windowId),
    forward: (windowId: string) => ipcRenderer.invoke('browser:forward', windowId),
    state: (windowId: string) => ipcRenderer.invoke('browser:state', windowId),
    screenshot: (windowId: string) => ipcRenderer.invoke('browser:screenshot', windowId),
    saveScreenshot: (windowId: string) => ipcRenderer.invoke('browser:screenshot:save', windowId),
    snapshot: (windowId: string) => ipcRenderer.invoke('browser:snapshot', windowId),
    inspectElement: (windowId: string, params?: import('@/shared/browser').BrowserInspectElementParams) => ipcRenderer.invoke('browser:inspect:element', windowId, params),
    startInspect: (windowId: string) => ipcRenderer.invoke('browser:inspect:start', windowId),
    stopInspect: (windowId: string) => ipcRenderer.invoke('browser:inspect:stop', windowId),
    onEvent: (cb: (event: import('@/shared/browser').BrowserEvent) => void) => {
      const handler = (_: unknown, payload: import('@/shared/browser').BrowserEvent) => cb(payload)
      ipcRenderer.on('browser:event', handler)
      return () => ipcRenderer.off('browser:event', handler)
    },
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
    readEvents: (limit?: number) => ipcRenderer.invoke('telemetry:read-events', limit),
    clear: () => ipcRenderer.invoke('telemetry:clear'),
    path: () => ipcRenderer.invoke('telemetry:path'),
  },
  tools: {
    registry: (threadId?: string | null, forceRefetch?: boolean) => ipcRenderer.invoke('tools:registry', threadId, forceRefetch),
    catalog: {
      list: (activeThreadId: string | null = null): Promise<import('@/shared/tools').ToolCatalogSnapshot> => (
        ipcRenderer.invoke('tools:catalog:list', { activeThreadId })
      ),
      refresh: (activeThreadId: string | null = null): Promise<import('@/shared/tools').ToolCatalogSnapshot> => (
        ipcRenderer.invoke('tools:catalog:refresh', { activeThreadId })
      ),
      test: (
        catalogId: import('@/shared/tools').ToolCatalogId,
        activeThreadId: string | null = null,
      ): Promise<import('@/shared/tools').ToolCatalogSnapshot> => (
        ipcRenderer.invoke('tools:catalog:test', { catalogId, activeThreadId })
      ),
    },
  },
}

export type CranberriAPI = typeof api

contextBridge.exposeInMainWorld('cranberri', api)
