import type { DiffResult, GitCommitResult, GitFileStatus, FileTreeNode, GitHubPanelData, GitHubPanelKind, GitHubRepoSummary } from '@/shared/git'
import type { CodexConnectionStatus, CodexEvent, CodexPluginInfo, CodexSessionSummary, CodexSessionThread, CodexSkillInfo, CodexTurnSettings } from '@/shared/codex'
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
      getBuildInfo: () => Promise<import('@/shared/buildInfo').BuildInfo>
      openExternal: (url: string) => Promise<void>
      openPath: (path: string) => Promise<{ ok: true }>
      revealPath: (path: string) => Promise<{ ok: true }>
      exportTextFile: (params: import('@/shared/app').ExportTextFileParams) => Promise<import('@/shared/app').ExportTextFileResult>
      update: {
        check: () => Promise<import('@/shared/update').UpdateInfo>
        status: () => Promise<import('@/shared/update').UpdateInfo>
        install: () => Promise<import('@/shared/update').InstallResult>
        acknowledgeHealth: () => Promise<{ ok: true }>
        acknowledgeFlush: (requestId: string, errorMessage?: string | null) => Promise<{ ok: boolean }>
        onFlushRequest: (cb: (request: { requestId: string }) => void) => (() => void)
        onEvent: (cb: (event: import('@/shared/update').UpdateEvent) => void) => (() => void)
        pendingResult: () => Promise<import('@/shared/update').InstallResult | null>
        clearResult: () => Promise<{ ok: boolean }>
      }
      health: {
        read: () => Promise<CranberriHealthReport>
        doctor: () => Promise<CranberriHealthReport>
        diagnostics: () => Promise<import('@/shared/health').CranberriDiagnosticsReport>
      }
      nativeHelpers: {
        openSettings: (target: import('@/shared/nativeHelpers').NativeHelperSettingsTarget) => Promise<{ ok: true }>
      }
      appState: {
        read: () => Promise<CranberriAppState>
        write: (state: CranberriAppState) => Promise<CranberriAppState>
      }
      lifecycle: {
        acknowledgePersistenceFlush: (acknowledgement: import('@/shared/appState').PersistenceFlushAcknowledgement) => Promise<{ ok: boolean }>
        onPersistenceFlushRequest: (cb: (request: import('@/shared/appState').PersistenceFlushRequest) => void) => (() => void)
        onPersistenceFlushFailure: (cb: (failure: import('@/shared/appState').PersistenceFlushFailure) => void) => (() => void)
        forceClose: (reason: import('@/shared/appState').PersistenceFlushRequest['reason']) => Promise<{ ok: true }>
      }
      composerDrafts: {
        read: (ownerKey: string) => Promise<import('@/shared/composer-drafts').ComposerDraft | null>
        write: (draft: import('@/shared/composer-drafts').ComposerDraft) => Promise<import('@/shared/composer-drafts').ComposerDraft>
        delete: (ownerKey: string) => Promise<{ ok: true }>
        migrate: (legacyOwnerKey: string, ownerKey: string) => Promise<import('@/shared/composer-drafts').ComposerDraft | null>
      }
      recovery: {
        read: () => Promise<import('@/shared/recovery').StartupRecoveryReport | null>
        retry: () => Promise<import('@/shared/recovery').StartupRecoveryReport>
      }
      repos: {
        list: () => Promise<import('@/shared/projects').ProjectRegistryView>
        add: (path: string) => Promise<import('@/shared/projects').ProjectRegistryView>
        remove: (id: string) => Promise<import('@/shared/projects').ProjectRegistryView>
        setActive: (id: string) => Promise<import('@/shared/projects').ProjectRegistryView>
        setPinnedBranch: (projectId: string, branch: string) => Promise<import('@/shared/projects').ProjectRegistryView>
        pickDirectory: () => Promise<string | null>
      }
      git: {
        status: (repoPath: string) => Promise<GitFileStatus[]>
        files: (repoPath: string) => Promise<FileTreeNode[]>
        diff: (repoPath: string) => Promise<DiffResult>
        diffFile: (repoPath: string, filePath: string) => Promise<DiffResult>
        rawContent: (repoPath: string, filePath: string, ref: 'HEAD' | 'WORKING') => Promise<string>
        githubSummary: (repoPath: string) => Promise<GitHubRepoSummary>
        commit: (repoPath: string, title: string, summary: string) => Promise<GitCommitResult>
        draftCommitMessage: (repoPath: string) => Promise<import('@/shared/git').GitCommitMessageDraft>
        taskStatus: (taskId: string) => Promise<GitFileStatus[]>
        taskFiles: (taskId: string) => Promise<FileTreeNode[]>
        taskDiff: (taskId: string) => Promise<DiffResult>
        taskGithubSummary: (taskId: string) => Promise<GitHubRepoSummary>
        taskDiffFile: (taskId: string, filePath: string) => Promise<DiffResult>
        taskRawContent: (taskId: string, filePath: string, ref: 'HEAD' | 'WORKING') => Promise<string>
        taskCommit: (taskId: string, title: string, summary: string) => Promise<GitCommitResult>
      }
      github: {
        panelData: (repoPath: string, kind: GitHubPanelKind) => Promise<GitHubPanelData>
        taskPanelData: (taskId: string, kind: GitHubPanelKind) => Promise<GitHubPanelData>
      }
      search: {
        repo: (repoPath: string, options: import('@/shared/search').RepoSearchOptions) => Promise<import('@/shared/search').RepoSearchResult>
        files: (repoPath: string, options: import('@/shared/search').RepoFileSearchOptions) => Promise<import('@/shared/search').RepoFileSearchResult>
        previewFile: (repoPath: string, filePath: string, maxBytes?: number) => Promise<import('@/shared/search').FilePreviewResult>
        watchStart: (repoPath: string) => Promise<{ watching: boolean; repoPath: string }>
        watchStop: (repoPath: string) => Promise<{ watching: boolean; repoPath: string }>
        taskRepo: (taskId: string, options: import('@/shared/search').RepoSearchOptions) => Promise<import('@/shared/search').RepoSearchResult>
        taskFiles: (taskId: string, options: import('@/shared/search').RepoFileSearchOptions) => Promise<import('@/shared/search').RepoFileSearchResult>
        taskPreviewFile: (taskId: string, filePath: string, maxBytes?: number) => Promise<import('@/shared/search').FilePreviewResult>
        taskWatchStart: (taskId: string) => Promise<{ watching: boolean; repoPath: string }>
        taskWatchStop: (taskId: string) => Promise<{ watching: boolean; repoPath: string }>
        onRepoChanged: (cb: (event: import('@/shared/search').RepoWatchEvent) => void) => () => void
      }
      codex: {
        start: (cwd: string) => Promise<{ started: boolean }>
        createThread: (cwd: string, settings?: CodexTurnSettings) => Promise<{ threadId: string; title?: string | null }>
        sendMessage: (cwd: string, threadId: string, input: import('@/shared/codex').CodexUserInput[], settings?: CodexTurnSettings) => Promise<{ ok: boolean }>
        steerThread: (cwd: string, threadId: string, input: import('@/shared/codex').CodexUserInput[]) => Promise<{ ok: boolean }>
        controlWorker: (cwd: string, parentThreadId: string, workerThreadId: string, action: import('@/shared/codex-worker-control').CodexWorkerControlAction, input: import('@/shared/codex').CodexUserInput[]) => Promise<{ ok: boolean }>
        compactThread: (cwd: string, threadId: string) => Promise<{ ok: boolean }>
        approve: (cwd: string, threadId: string, event: unknown) => Promise<{ ok: boolean }>
        respondToServerRequest: (response: import('@/shared/codex-requests').CodexHumanServerRequestResponse) => Promise<{ ok: boolean }>
        listServerRequests: (threadId?: string) => Promise<{
          pending: import('@/shared/codex-requests').CodexPendingHumanServerRequest[]
          outcomes: import('@/shared/codex-requests').CodexRequestOutcomeEntry[]
        }>
        interrupt: (cwd: string, threadId: string) => Promise<{ ok: boolean }>
        stop: (cwd: string) => Promise<{ stopped: boolean }>
        plugins: () => Promise<{ plugins: CodexPluginInfo[] }>
        installPlugin: (pluginId: string) => Promise<import('@/shared/codex').CodexPluginActionResult>
        upgradePluginMarketplaces: () => Promise<import('@/shared/codex').CodexPluginActionResult>
        skills: () => Promise<{ skills: CodexSkillInfo[] }>
        pickFiles: () => Promise<{ paths: string[] }>
        listThreads: (cwd: string, options?: { archived?: boolean; cursor?: string | null; limit?: number; searchTerm?: string | null }) => Promise<{ sessions: CodexSessionSummary[]; nextCursor?: string | null; backwardsCursor?: string | null }>
        readThread: (cwd: string, threadId: string, archived?: boolean) => Promise<{ thread: CodexSessionThread }>
        resumeThread: (cwd: string, threadId: string, settings?: CodexTurnSettings) => Promise<{ thread: CodexSessionThread }>
        renameThread: (cwd: string, threadId: string, name: string) => Promise<{ ok: boolean }>
        getConnectionStatus: () => Promise<CodexConnectionStatus>
        pickRuntime: () => Promise<{ path: string | null }>
        reloadRuntime: () => Promise<CodexConnectionStatus>
        connect: () => Promise<CodexConnectionStatus>
        getRateLimits: () => Promise<import('@/shared/codex').CodexRateLimitsReadResult>
        getAccountUsage: () => Promise<import('@/shared/codex').CodexAccountUsageReadResult>
        consumeRateLimitResetCredit: () => Promise<{ outcome: string }>
        onEvent: (cb: (event: CodexEvent) => void) => () => void
      }
      tasks: {
        snapshot: () => Promise<{ revision: number; projects: import('@/shared/projects').Project[]; checkouts: import('@/shared/projects').Checkout[]; tasks: import('@/shared/tasks').Task[]; managedWorktrees: import('@/shared/worktrees').ManagedWorktree[] }>
        onAuthorityChanged: (cb: (event: import('@/shared/state-events').AuthorityChangedEvent) => void) => () => void
        list: (projectId?: string) => Promise<{ tasks: import('@/shared/tasks').Task[] }>
        createLocalDraft: (request: import('@/shared/tasks').LocalTaskDraftRequest) => Promise<{ task: import('@/shared/tasks').Task }>
        adoptLocalThread: (request: import('@/shared/tasks').LocalTaskAdoptRequest) => Promise<{ task: import('@/shared/tasks').Task }>
        history: (request: import('@/shared/tasks').TaskHistoryRequest) => Promise<{ sessions: CodexSessionSummary[]; nextCursor?: string | null; backwardsCursor?: string | null }>
        read: (taskId: string, archived?: boolean) => Promise<{ task: import('@/shared/tasks').Task; thread: CodexSessionThread }>
        resume: (taskId: string) => Promise<{ task: import('@/shared/tasks').Task; thread?: CodexSessionThread; threadId?: string }>
        send: (request: import('@/shared/tasks').TaskSendRequest) => Promise<{ ok: true; task: import('@/shared/tasks').Task }>
        createWorktreeDraft: (request: import('@/shared/tasks').TaskDraftRequest) => Promise<{ task: import('@/shared/tasks').Task }>
        provision: (request: import('@/shared/tasks').TaskProvisionRequest) => Promise<{ task: import('@/shared/tasks').Task }>
        continueInWorktree: (taskId: string) => Promise<{ task: import('@/shared/tasks').Task; warning: string | null; includedLocalChanges: boolean }>
        status: (taskId: string) => Promise<{ task: import('@/shared/tasks').Task; worktree: import('@/shared/worktrees').ManagedWorktree | null; setupJob: import('@/shared/terminal').EnvironmentJob | null }>
        handoffToLocal: (request: import('@/shared/tasks').TaskHandoffRequest) => Promise<{ task: import('@/shared/tasks').Task }>
        handoffToWorktree: (request: import('@/shared/tasks').TaskHandoffRequest) => Promise<{ task: import('@/shared/tasks').Task }>
        archive: (taskId: string) => Promise<import('@/shared/tasks').TaskLifecycleResult>
        unarchive: (taskId: string) => Promise<import('@/shared/tasks').TaskLifecycleResult>
        delete: (taskId: string) => Promise<{ ok: true }>
      }
      worktrees: {
        listRefs: (projectId: string) => Promise<import('@/shared/worktrees').SelectableRefsResult>
        refreshRefs: (projectId: string) => Promise<import('@/shared/worktrees').RefreshRefsResult>
      }
      terminal: {
        create: (id: string, cwd: string, cols?: number, rows?: number) => Promise<{ pid: number; buffer?: string }>
        createForTask: (request: import('@/shared/terminal').TaskTerminalCreateRequest) => Promise<{ pid: number; buffer?: string }>
        snapshot: (id: string) => Promise<{ buffer: string }>
        clear: (id: string) => Promise<void>
        write: (id: string, data: string) => Promise<void>
        resize: (id: string, cols: number, rows: number) => Promise<void>
        kill: (id: string) => Promise<void>
        onData: (cb: (payload: { id: string; data: string }) => void) => () => void
        onExit: (cb: (payload: { id: string; exitCode: number; signal?: number }) => void) => () => void
      }
      environments: {
        list: (projectId: string) => Promise<{ environments: import('@/shared/environments').EnvironmentRecord[] }>
        read: (projectId: string, environmentId: string) => Promise<import('@/shared/environments').EnvironmentRecord>
        save: (request: import('@/shared/environments').EnvironmentSaveRequest) => Promise<import('@/shared/environments').EnvironmentRecord>
        trust: (projectId: string, environmentId: string, revision: string) => Promise<{ manifest: import('@/shared/environments').EnvironmentManifest }>
        delete: (projectId: string, environmentId: string) => Promise<{ ok: true }>
        setDefault: (projectId: string, environmentId: string | null) => Promise<{ project: import('@/shared/projects').Project }>
        startSetup: (request: import('@/shared/terminal').EnvironmentSetupRequest) => Promise<import('@/shared/terminal').EnvironmentJob>
        retrySetup: (request: import('@/shared/terminal').EnvironmentSetupRequest) => Promise<import('@/shared/terminal').EnvironmentJob>
        startTest: (request: import('@/shared/terminal').EnvironmentTestRequest) => Promise<import('@/shared/terminal').EnvironmentJob>
        snapshotJob: (jobId: string) => Promise<import('@/shared/terminal').EnvironmentJob>
        writeJob: (jobId: string, data: string) => Promise<void>
        cancelJob: (jobId: string) => Promise<void>
        openAction: (request: import('@/shared/terminal').EnvironmentActionRequest) => Promise<{ terminalId: string; pid: number }>
        onJobData: (cb: (payload: import('@/shared/terminal').EnvironmentJobDataEvent) => void) => () => void
        onJobExit: (cb: (payload: import('@/shared/terminal').EnvironmentJobExitEvent) => void) => () => void
      }
      processes: {
        list: (repoPath: string) => Promise<{ processes: AgentProcessInfo[] }>
        terminate: (repoPath: string, processId: string) => Promise<{ process: AgentProcessInfo }>
        listForTask: (taskId: string) => Promise<{ processes: AgentProcessInfo[] }>
        terminateForTask: (taskId: string, processId: string) => Promise<{ process: AgentProcessInfo }>
      }
      browser: {
        attach: (params: import('@/shared/browser').BrowserAttachParams) => Promise<import('@/shared/browser').BrowserPageState>
        attachForTask: (params: import('@/shared/browser').TaskBrowserAttachParams) => Promise<import('@/shared/browser').BrowserPageState>
        bounds: (windowId: string, bounds: import('@/shared/browser').BrowserBounds) => Promise<import('@/shared/browser').BrowserPageState>
        detach: (windowId: string) => Promise<{ ok: boolean }>
        destroy: (windowId: string) => Promise<{ ok: boolean }>
        navigate: (windowId: string, url: string) => Promise<import('@/shared/browser').BrowserPageState>
        reload: (windowId: string) => Promise<import('@/shared/browser').BrowserPageState>
        stop: (windowId: string) => Promise<import('@/shared/browser').BrowserPageState>
        back: (windowId: string) => Promise<import('@/shared/browser').BrowserPageState>
        forward: (windowId: string) => Promise<import('@/shared/browser').BrowserPageState>
        state: (windowId: string) => Promise<import('@/shared/browser').BrowserPageState>
        screenshot: (windowId: string) => Promise<import('@/shared/browser').BrowserScreenshot>
        saveScreenshot: (windowId: string) => Promise<import('@/shared/browser').BrowserScreenshot>
        snapshot: (windowId: string) => Promise<import('@/shared/browser').BrowserSnapshot>
        inspectElement: (windowId: string, params?: import('@/shared/browser').BrowserInspectElementParams) => Promise<import('@/shared/browser').BrowserElementInspection>
        startInspect: (windowId: string) => Promise<{ ok: true }>
        stopInspect: (windowId: string) => Promise<{ ok: true }>
        onEvent: (cb: (event: import('@/shared/browser').BrowserEvent) => void) => () => void
      }
      settings: {
        get: () => Promise<{ settings: import('@/shared/settings').AppSettings }>
        set: (settings: import('@/shared/settings').AppSettings) => Promise<{ settings: import('@/shared/settings').AppSettings }>
      }
      telemetry: {
        log: (source: string, type: string, payload?: unknown) => Promise<{ ok: boolean }>
        read: (limit?: number) => Promise<{ path: string; lines: string[] }>
        readEvents: (limit?: number) => Promise<{ events: import('@/shared/telemetry').TelemetryEventRecord[] }>
        clear: () => Promise<{ ok: boolean; path: string }>
        path: () => Promise<{ path: string }>
      }
      tools: {
        registry: (threadId?: string | null, forceRefetch?: boolean) => Promise<import('@/shared/tools').ToolRegistrySnapshot>
        catalog: {
          list: (activeThreadId?: string | null) => Promise<import('@/shared/tools').ToolCatalogSnapshot>
          refresh: (activeThreadId?: string | null) => Promise<import('@/shared/tools').ToolCatalogSnapshot>
          test: (
            catalogId: import('@/shared/tools').ToolCatalogId,
            activeThreadId?: string | null,
          ) => Promise<import('@/shared/tools').ToolCatalogSnapshot>
        }
      }
    }
  }
}
