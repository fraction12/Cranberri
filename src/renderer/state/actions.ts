import type { WorkspaceWindowState } from '@/shared/appState'
import type { BrowserElementInspection, BrowserSnapshot } from '@/shared/browser'
import type { CodexMessage, CodexPluginInfo, CodexSessionSummary, CodexSkillInfo, CodexThread } from '@/shared/codex'
import type { ToolEventRecord, ToolRegistryApp, ToolRegistryMcpServer, ToolRegistryMcpTool, ToolRegistrySnapshot } from '@/shared/tools'
import type { DiffResult, GitFileStatus, GitHubPanelData, GitHubPanelItem, GitHubPanelKind } from '@/shared/git'
import type { AgentProcessInfo } from '@/shared/processes'
import type { RepoFileSearchMatch, RepoSearchMatch } from '@/shared/search'
import type { RightRailCommand } from '../components/right-rail/right-rail-command-events'
import type { SettingsTabValue } from '../components/SettingsDialog'
import type { LatestCodexResourceContext } from '../components/codex-resources'
import type { LatestAppContext } from '../components/app-context-events'
import type { LatestBrowserScreenshotContext } from '../components/browser-context-events'
import type { LatestGitHubContext } from '../components/github-chat-context'
import type { Repo } from './repos'
import type { LatestSessionContext, SessionSearchResult } from './session-search'
import type { DiagnosticsPathKey } from '../components/diagnostics-paths'
import type { NativeHelperSettingsTarget } from '@/shared/nativeHelpers'
import { latestReusableAssistantMessage, latestReusableUserMessage } from '../components/chat/assistant-response-context'
import { sessionSummaryPreview } from './session-search'

export type AppActionGroup = 'workspace' | 'windows' | 'files' | 'rail' | 'processes' | 'sessions' | 'repos' | 'system'
export type AppActionIcon = 'activity' | 'browser' | 'chat' | 'diff' | 'file' | 'github' | 'repo' | 'session' | 'settings' | 'terminal' | 'tools' | 'window'
export type ActiveWindowContextKind = 'terminal-buffer' | 'browser-page' | 'browser-screenshot' | 'browser-inspection'
export type ActiveBrowserCommand = 'back' | 'forward' | 'reload' | 'stop' | 'inspect-start' | 'inspect-stop' | 'open-external' | 'copy-url' | 'copy-page-context'
export type ActiveBrowserViewportMode = NonNullable<NonNullable<WorkspaceWindowState['browser']>['viewportMode']>
export type ActiveTerminalCommand = 'search' | 'search-next' | 'search-previous' | 'search-close' | 'copy-buffer' | 'clear'
export type RepoChangesContextKind = 'status' | 'diff'
export type GitHubContextKind = GitHubPanelKind

const DIAGNOSTICS_PATH_ACTIONS: Array<{ key: DiagnosticsPathKey; label: string; keywords: string[] }> = [
  { key: 'app', label: 'App', keywords: ['app', 'application', 'bundle'] },
  { key: 'userData', label: 'User data', keywords: ['user data', 'support', 'profile', 'state'] },
  { key: 'resources', label: 'Resources', keywords: ['resources', 'asar', 'bundle'] },
  { key: 'sqlite', label: 'SQLite', keywords: ['sqlite', 'database', 'db'] },
  { key: 'debugTelemetry', label: 'Telemetry JSONL', keywords: ['telemetry', 'jsonl', 'events'] },
  { key: 'electronLog', label: 'Electron log', keywords: ['electron', 'log', 'logs'] },
]

const NATIVE_HELPER_SETTINGS_ACTIONS: Array<{ target: NativeHelperSettingsTarget; label: string; description: string; keywords: string[] }> = [
  {
    target: 'macos-accessibility',
    label: 'Open macOS Accessibility settings',
    description: 'Open the macOS privacy pane used for Accessibility helper permission',
    keywords: ['native', 'helper', 'permission', 'privacy', 'macos', 'accessibility', 'settings'],
  },
  {
    target: 'macos-apple-events',
    label: 'Open Apple Events automation settings',
    description: 'Open the macOS privacy pane used for per-app automation permission',
    keywords: ['native', 'helper', 'permission', 'privacy', 'macos', 'apple events', 'automation', 'settings'],
  },
]

export interface LatestTerminalContext {
  terminalId: string
  repoPath: string | null
  text: string
}

export interface LatestRepoChangesContext {
  kind: RepoChangesContextKind
  repoPath: string
  status: GitFileStatus[]
  diff: DiffResult | null
}

export interface LatestRepoFileContext {
  repoPath: string
  file: GitFileStatus
  workingContent?: string | null
  headContent?: string | null
  diff?: DiffResult | null
}

export interface AppAction {
  id: string
  group: AppActionGroup
  icon: AppActionIcon
  label: string
  description?: string
  keywords: string[]
  disabledReason?: string
  run: () => unknown | Promise<unknown>
}

export interface BuildAppActionsInput {
  repos: Repo[]
  activeRepoId: string | null
  windows: WorkspaceWindowState[]
  activeWindowId: string | null
  activeThread?: CodexThread | null
  sessions: SessionSearchResult[]
  activeSessionIds?: string[]
  pinnedSessionIds?: string[]
  processes?: AgentProcessInfo[]
  plugins?: CodexPluginInfo[]
  skills?: CodexSkillInfo[]
  registry?: ToolRegistrySnapshot | null
  toolEvents?: ToolEventRecord[]
  selectedRightRailFile?: GitFileStatus | null
  changedFileCount?: number | null
  latestRepoFileContext?: LatestRepoFileContext | null
  latestRepoChangesContext?: LatestRepoChangesContext | null
  latestProcessContext?: AgentProcessInfo | null
  latestToolEventContext?: ToolEventRecord | null
  latestSessionContext?: LatestSessionContext | null
  latestCodexResourceContext?: LatestCodexResourceContext | null
  latestAppContext?: LatestAppContext | null
  latestGitHubContext?: LatestGitHubContext | null
  latestTerminalContext?: LatestTerminalContext | null
  latestBrowserSnapshot?: BrowserSnapshot | null
  latestBrowserInspection?: BrowserElementInspection | null
  latestBrowserScreenshot?: LatestBrowserScreenshotContext | null
  openChat: () => string
  openTerminal: () => string
  openBrowser: () => string
  openSettings: (tab?: SettingsTabValue) => void
  openSession: (session: CodexSessionSummary, repoPath: string, archived?: boolean) => void
  sendActiveChatContext?: () => void | Promise<void>
  exportActiveThreadMarkdown?: () => void | false | Promise<void | false>
  copyActiveThreadMarkdown?: () => void | Promise<void>
  sendLatestAssistantResponseToChat?: (message: CodexMessage) => void | Promise<void>
  copyLatestAssistantResponse?: (message: CodexMessage) => void | Promise<void>
  sendLatestUserPromptToChat?: (message: CodexMessage) => void | Promise<void>
  copyLatestUserPrompt?: (message: CodexMessage) => void | Promise<void>
  sendLatestTerminalContextToChat?: (context: LatestTerminalContext) => void | Promise<void>
  copyLatestTerminalContext?: (context: LatestTerminalContext) => void | Promise<void>
  sendLatestRepoChangesContextToChat?: (context: LatestRepoChangesContext) => void | Promise<void>
  copyLatestRepoChangesContext?: (context: LatestRepoChangesContext) => void | Promise<void>
  sendLatestRepoFileContextToChat?: (context: LatestRepoFileContext) => void | Promise<void>
  copyLatestRepoFileContext?: (context: LatestRepoFileContext) => void | Promise<void>
  sendLatestProcessContextToChat?: (processInfo: AgentProcessInfo) => void | Promise<void>
  copyLatestProcessContext?: (processInfo: AgentProcessInfo) => void | Promise<void>
  sendLatestToolEventContextToChat?: (event: ToolEventRecord) => void | Promise<void>
  copyLatestToolEventContext?: (event: ToolEventRecord) => void | Promise<void>
  sendDiagnosticsContext?: () => void | Promise<void>
  copyDiagnosticsContext?: () => void | Promise<void>
  clearDiagnosticsTelemetry?: () => void | false | Promise<void | false>
  copyDiagnosticsPath?: (key: DiagnosticsPathKey) => void | Promise<void>
  openDiagnosticsPath?: (key: DiagnosticsPathKey) => void | Promise<void>
  revealDiagnosticsPath?: (key: DiagnosticsPathKey) => void | Promise<void>
  openNativeHelperSettings?: (target: NativeHelperSettingsTarget) => void | Promise<void>
  sendUsageContext?: () => void | Promise<void>
  copyUsageContext?: () => void | Promise<void>
  copyActiveChatContext?: () => void | Promise<void>
  attachFilesToActiveChat?: () => void | false | Promise<void | false>
  attachRepoFileToActiveChat?: (path: string) => void | Promise<void>
  openSelectedFileExternal?: (path: string) => void | Promise<void>
  revealSelectedFileInFolder?: (path: string) => void | Promise<void>
  copySelectedFileAbsolutePath?: (path: string) => void | Promise<void>
  openLatestBrowserScreenshot?: (path: string) => void | Promise<void>
  revealLatestBrowserScreenshot?: (path: string) => void | Promise<void>
  copyLatestBrowserScreenshotPath?: (path: string) => void | Promise<void>
  sendLatestBrowserScreenshotToChat?: (capture: LatestBrowserScreenshotContext) => void | Promise<void>
  sendLatestBrowserSnapshotToChat?: (snapshot: BrowserSnapshot) => void | Promise<void>
  copyLatestBrowserSnapshot?: (snapshot: BrowserSnapshot) => void | Promise<void>
  sendLatestBrowserInspectionToChat?: (inspection: BrowserElementInspection) => void | Promise<void>
  copyLatestBrowserInspection?: (inspection: BrowserElementInspection) => void | Promise<void>
  installPlugin?: (plugin: CodexPluginInfo) => void | false | Promise<void | false>
  upgradePluginMarketplaces?: () => void | Promise<void>
  sendSkillContext?: (skill: CodexSkillInfo) => void | Promise<void>
  copySkillContext?: (skill: CodexSkillInfo) => void | Promise<void>
  sendToolRegistryContext?: () => void | Promise<void>
  copyToolRegistryContext?: () => void | Promise<void>
  sendAppContext?: (app: ToolRegistryApp) => void | Promise<void>
  copyAppContext?: (app: ToolRegistryApp) => void | Promise<void>
  sendMcpServerContext?: (server: ToolRegistryMcpServer) => void | Promise<void>
  copyMcpServerContext?: (server: ToolRegistryMcpServer) => void | Promise<void>
  sendMcpToolContext?: (server: ToolRegistryMcpServer, tool: ToolRegistryMcpTool) => void | Promise<void>
  copyMcpToolContext?: (server: ToolRegistryMcpServer, tool: ToolRegistryMcpTool) => void | Promise<void>
  sendToolEventContext?: (event: ToolEventRecord) => void | Promise<void>
  copyToolEventContext?: (event: ToolEventRecord) => void | Promise<void>
  sendSessionContext?: (result: SessionSearchResult) => void | Promise<void>
  copySessionContext?: (result: SessionSearchResult) => void | Promise<void>
  sendLatestSessionContextToChat?: (context: LatestSessionContext) => void | Promise<void>
  copyLatestSessionContext?: (context: LatestSessionContext) => void | Promise<void>
  sendLatestCodexResourceContextToChat?: (context: LatestCodexResourceContext) => void | Promise<void>
  copyLatestCodexResourceContext?: (context: LatestCodexResourceContext) => void | Promise<void>
  sendLatestAppContextToChat?: (context: LatestAppContext) => void | Promise<void>
  copyLatestAppContext?: (context: LatestAppContext) => void | Promise<void>
  openProcessTerminal?: (processInfo: AgentProcessInfo) => void
  openProcessBrowser?: (processInfo: AgentProcessInfo) => void
  sendProcessContext?: (processInfo: AgentProcessInfo) => void
  sendActiveWindowContext?: (windowId: string, kind: ActiveWindowContextKind) => void
  copyActiveWindowContext?: (windowId: string, kind: ActiveWindowContextKind) => void | Promise<void>
  sendWorkspaceBrief?: () => void | Promise<void>
  copyWorkspaceBrief?: () => void | Promise<void>
  sendRepoChangesContext?: (kind: RepoChangesContextKind) => void | Promise<void>
  copyRepoChangesContext?: (kind: RepoChangesContextKind) => void | Promise<void>
  reviewRepoChangesContext?: () => void | Promise<void>
  explainRepoChangesContext?: () => void | Promise<void>
  testRepoChangesContext?: () => void | Promise<void>
  draftPullRequestContext?: () => void | Promise<void>
  sendGitHubContext?: (kind: GitHubContextKind) => void | Promise<void>
  copyGitHubContext?: (kind: GitHubContextKind) => void | Promise<void>
  sendLatestGitHubContextToChat?: (context: LatestGitHubContext) => void | Promise<void>
  copyLatestGitHubContext?: (context: LatestGitHubContext) => void | Promise<void>
  compactActiveThread?: () => void | Promise<void>
  interruptActiveThread?: () => void | Promise<void>
  archiveActiveThread?: () => void | Promise<void>
  renameActiveThread?: () => void | false | Promise<void | false>
  deleteActiveThread?: () => void | false | Promise<void | false>
  toggleSessionPinned?: (session: CodexSessionSummary) => void | Promise<void>
  archiveSession?: (threadId: string) => void | Promise<void>
  unarchiveSession?: (threadId: string) => void | Promise<void>
  renameSession?: (threadId: string, title: string) => void | false | Promise<void | false>
  deleteSession?: (threadId: string, title: string) => void | false | Promise<void | false>
  resolveActiveApproval?: (approvalId: string, action: 'approve' | 'deny') => void | Promise<void>
  controlActiveTerminal?: (windowId: string, command: ActiveTerminalCommand) => void | Promise<void>
  controlActiveBrowser?: (windowId: string, command: ActiveBrowserCommand) => void | Promise<void>
  setActiveBrowserViewport?: (windowId: string, mode: ActiveBrowserViewportMode) => void | Promise<void>
  openRightRail?: (command: RightRailCommand) => void
  setActiveRepo: (id: string) => void | Promise<void>
  setActiveWindow: (id: string) => void
}

export interface BuildFileSearchActionsInput {
  contentMatches: RepoSearchMatch[]
  fileMatches: RepoFileSearchMatch[]
  openFile: (path: string, line?: number) => void
  sendFileContext?: (path: string, line?: number) => void | Promise<void>
  copyFileContext?: (path: string, line?: number) => void | Promise<void>
  attachFile?: (path: string) => void | Promise<void>
}

export interface BuildActiveThreadMessageActionsInput {
  activeThread?: CodexThread | null
  query: string
  sendMessageContext: (message: CodexMessage) => void | Promise<void>
  copyMessageText: (message: CodexMessage) => void | Promise<void>
}

export interface BuildGitHubItemActionsInput {
  panels: GitHubPanelData[]
  sendGitHubItemContext: (kind: GitHubPanelKind, item: GitHubPanelItem) => void | Promise<void>
  copyGitHubItemContext?: (kind: GitHubPanelKind, item: GitHubPanelItem) => void | Promise<void>
}

const BROWSER_VIEWPORT_ACTIONS: Array<{ mode: ActiveBrowserViewportMode; label: string; keywords: string[] }> = [
  { mode: 'responsive', label: 'Responsive browser viewport', keywords: ['responsive', 'fluid', 'full width'] },
  { mode: 'mobile', label: 'Mobile browser viewport', keywords: ['mobile', 'phone', '390', '844'] },
  { mode: 'tablet', label: 'Tablet browser viewport', keywords: ['tablet', 'ipad', '820', '1180'] },
  { mode: 'desktop', label: 'Desktop browser viewport', keywords: ['desktop', 'wide', '1440', '900'] },
]
const ACTIVE_TRANSCRIPT_SEARCH_MIN_CHARS = 2
const ACTIVE_TRANSCRIPT_MESSAGE_LIMIT = 30
const ACTIVE_TRANSCRIPT_ACTION_LIMIT = 12
const ACTIVE_TRANSCRIPT_PREVIEW_MAX_CHARS = 72

function normalizeActionText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

export function actionSearchText(action: Pick<AppAction, 'label' | 'description' | 'keywords'>): string {
  return normalizeActionText([action.label, action.description, ...action.keywords].filter(Boolean).join(' '))
}

export function actionMatchesQuery(action: Pick<AppAction, 'label' | 'description' | 'keywords'>, query: string): boolean {
  const terms = normalizeActionText(query).split(' ').filter(Boolean)
  if (terms.length === 0) return true
  const haystack = actionSearchText(action)
  return terms.every((term) => haystack.includes(term))
}

export function filterAppActions(actions: AppAction[], query: string): AppAction[] {
  return actions.filter((action) => actionMatchesQuery(action, query))
}

export function buildAppActions({
  repos,
  activeRepoId,
  windows,
  activeWindowId,
  activeThread,
  sessions,
  activeSessionIds = [],
  pinnedSessionIds = [],
  processes = [],
  plugins = [],
  skills = [],
  registry = null,
  toolEvents = [],
  selectedRightRailFile,
  changedFileCount = null,
  latestRepoFileContext,
  latestRepoChangesContext,
  latestProcessContext,
  latestToolEventContext,
  latestSessionContext,
  latestCodexResourceContext,
  latestAppContext,
  latestGitHubContext,
  latestTerminalContext,
  latestBrowserSnapshot,
  latestBrowserInspection,
  latestBrowserScreenshot,
  openChat,
  openTerminal,
  openBrowser,
  openSettings,
  openSession,
  sendActiveChatContext,
  exportActiveThreadMarkdown,
  copyActiveThreadMarkdown,
  sendLatestAssistantResponseToChat,
  copyLatestAssistantResponse,
  sendLatestUserPromptToChat,
  copyLatestUserPrompt,
  sendLatestTerminalContextToChat,
  copyLatestTerminalContext,
  sendLatestRepoChangesContextToChat,
  copyLatestRepoChangesContext,
  sendLatestRepoFileContextToChat,
  copyLatestRepoFileContext,
  sendLatestProcessContextToChat,
  copyLatestProcessContext,
  sendLatestToolEventContextToChat,
  copyLatestToolEventContext,
  sendDiagnosticsContext,
  copyDiagnosticsContext,
  clearDiagnosticsTelemetry,
  copyDiagnosticsPath,
  openDiagnosticsPath,
  revealDiagnosticsPath,
  openNativeHelperSettings,
  sendUsageContext,
  copyUsageContext,
  copyActiveChatContext,
  attachFilesToActiveChat,
  attachRepoFileToActiveChat,
  openSelectedFileExternal,
  revealSelectedFileInFolder,
  copySelectedFileAbsolutePath,
  openLatestBrowserScreenshot,
  revealLatestBrowserScreenshot,
  copyLatestBrowserScreenshotPath,
  sendLatestBrowserScreenshotToChat,
  sendLatestBrowserSnapshotToChat,
  copyLatestBrowserSnapshot,
  sendLatestBrowserInspectionToChat,
  copyLatestBrowserInspection,
  installPlugin,
  upgradePluginMarketplaces,
  sendSkillContext,
  copySkillContext,
  sendToolRegistryContext,
  copyToolRegistryContext,
  sendAppContext,
  copyAppContext,
  sendMcpServerContext,
  copyMcpServerContext,
  sendMcpToolContext,
  copyMcpToolContext,
  sendToolEventContext,
  copyToolEventContext,
  sendSessionContext,
  copySessionContext,
  sendLatestSessionContextToChat,
  copyLatestSessionContext,
  sendLatestCodexResourceContextToChat,
  copyLatestCodexResourceContext,
  sendLatestAppContextToChat,
  copyLatestAppContext,
  openProcessTerminal,
  openProcessBrowser,
  sendProcessContext,
  sendActiveWindowContext,
  copyActiveWindowContext,
  sendWorkspaceBrief,
  copyWorkspaceBrief,
    sendRepoChangesContext,
    copyRepoChangesContext,
    reviewRepoChangesContext,
    explainRepoChangesContext,
    testRepoChangesContext,
    draftPullRequestContext,
    sendGitHubContext,
  copyGitHubContext,
  sendLatestGitHubContextToChat,
  copyLatestGitHubContext,
  compactActiveThread,
  interruptActiveThread,
  archiveActiveThread,
  renameActiveThread,
  deleteActiveThread,
  toggleSessionPinned,
  archiveSession,
  unarchiveSession,
  renameSession,
  deleteSession,
  resolveActiveApproval,
  controlActiveTerminal,
  controlActiveBrowser,
  setActiveBrowserViewport,
  openRightRail,
  setActiveRepo,
  setActiveWindow,
}: BuildAppActionsInput): AppAction[] {
  const needsRepo = activeRepoId ? undefined : 'Select a repo first'
  const activeWindow = windows.find((win) => win.id === activeWindowId)
  const activeTerminalWindow = activeWindow?.type === 'terminal' ? activeWindow : null
  const activeBrowserWindow = activeWindow?.type === 'browser' ? activeWindow : null
  const activeBrowserInspection = activeBrowserWindow && latestBrowserInspection?.windowId === activeBrowserWindow.id
    ? latestBrowserInspection
    : null
  const latestSavedBrowserScreenshot = latestBrowserScreenshot?.screenshot.path ? latestBrowserScreenshot : null
  const activeThreadTitle = activeThread?.title || 'active chat'
  const activeThreadSession = activeThread ? codexThreadAsSessionSummary(activeThread) : null
  const latestAssistantMessage = activeThread ? latestReusableAssistantMessage(activeThread.messages) : null
  const latestUserMessage = activeThread ? latestReusableUserMessage(activeThread.messages) : null
  const latestAssistantMessageDisabledReason = activeThread ? 'No completed assistant response yet' : 'Open a chat first'
  const latestUserMessageDisabledReason = activeThread ? 'No completed user prompt yet' : 'Open a chat first'
  const actions: AppAction[] = [
    {
      id: 'workspace:new-chat',
      group: 'workspace',
      icon: 'chat',
      label: 'New chat',
      description: 'Open a new Codex chat window',
      keywords: ['codex', 'conversation', 'thread'],
      disabledReason: needsRepo,
      run: openChat,
    },
    {
      id: 'workspace:new-terminal',
      group: 'workspace',
      icon: 'terminal',
      label: 'New terminal',
      description: 'Open a shell in the active repo',
      keywords: ['shell', 'pty', 'command'],
      disabledReason: needsRepo,
      run: openTerminal,
    },
    {
      id: 'workspace:new-browser',
      group: 'workspace',
      icon: 'browser',
      label: 'New browser',
      description: 'Open a shared browser surface',
      keywords: ['web', 'preview', 'dev server'],
      disabledReason: needsRepo,
      run: openBrowser,
    },
    {
      id: 'system:settings',
      group: 'system',
      icon: 'settings',
      label: 'Open settings',
      description: 'Open Cranberri settings and diagnostics',
      keywords: ['preferences', 'apps', 'plugins', 'diagnostics'],
      run: openSettings,
    },
    {
      id: 'system:apps',
      group: 'system',
      icon: 'settings',
      label: 'Open apps and tools',
      description: 'Manage Codex plugins, apps, skills, and MCP tools',
      keywords: ['apps', 'plugins', 'skills', 'mcp', 'tools', 'connectors'],
      run: () => openSettings('apps'),
    },
    {
      id: 'system:diagnostics',
      group: 'system',
      icon: 'settings',
      label: 'Open diagnostics',
      description: 'Inspect health, logs, native helpers, and recent events',
      keywords: ['health', 'logs', 'telemetry', 'native helpers', 'debug'],
      run: () => openSettings('diagnostics'),
    },
    ...(sendDiagnosticsContext ? [{
      id: 'context:diagnostics',
      group: 'system' as const,
      icon: 'chat' as const,
      label: 'Send diagnostics context',
      description: 'Send app health, runtime, native helper, path, and recent event context to Codex',
      keywords: ['diagnostics', 'health', 'logs', 'telemetry', 'native helpers', 'context', 'codex', 'chat'],
      run: sendDiagnosticsContext,
    }] : []),
    ...(copyDiagnosticsContext ? [{
      id: 'context:diagnostics:copy',
      group: 'system' as const,
      icon: 'chat' as const,
      label: 'Copy diagnostics context',
      description: 'Copy app health, runtime, native helper, path, and recent event context',
      keywords: ['diagnostics', 'health', 'logs', 'telemetry', 'native helpers', 'context', 'codex', 'copy', 'clipboard'],
      run: copyDiagnosticsContext,
    }] : []),
    ...(clearDiagnosticsTelemetry ? [{
      id: 'diagnostics:telemetry:clear',
      group: 'system' as const,
      icon: 'activity' as const,
      label: 'Clear diagnostics telemetry',
      description: 'Clear local Cranberri diagnostics events and debug telemetry logs',
      keywords: ['diagnostics', 'health', 'logs', 'telemetry', 'events', 'debug', 'clear', 'reset', 'delete'],
      run: clearDiagnosticsTelemetry,
    }] : []),
    ...DIAGNOSTICS_PATH_ACTIONS.flatMap((pathAction) => ([
      ...(copyDiagnosticsPath ? [{
        id: `diagnostics:path:${pathAction.key}:copy`,
        group: 'system' as const,
        icon: 'file' as const,
        label: `Copy diagnostics ${pathAction.label} path`,
        description: `Copy the diagnostics ${pathAction.label} path to the clipboard`,
        keywords: ['diagnostics', 'health', 'logs', 'path', 'copy', 'clipboard', ...pathAction.keywords],
        run: () => copyDiagnosticsPath(pathAction.key),
      }] : []),
      ...(openDiagnosticsPath ? [{
        id: `diagnostics:path:${pathAction.key}:open`,
        group: 'system' as const,
        icon: 'file' as const,
        label: `Open diagnostics ${pathAction.label} path`,
        description: `Open the diagnostics ${pathAction.label} path with the OS default app`,
        keywords: ['diagnostics', 'health', 'logs', 'path', 'open', 'native', ...pathAction.keywords],
        run: () => openDiagnosticsPath(pathAction.key),
      }] : []),
      ...(revealDiagnosticsPath ? [{
        id: `diagnostics:path:${pathAction.key}:reveal`,
        group: 'system' as const,
        icon: 'file' as const,
        label: `Reveal diagnostics ${pathAction.label} path`,
        description: `Reveal the diagnostics ${pathAction.label} path in the file manager`,
        keywords: ['diagnostics', 'health', 'logs', 'path', 'reveal', 'finder', 'file manager', 'native', ...pathAction.keywords],
        run: () => revealDiagnosticsPath(pathAction.key),
      }] : []),
    ])),
    ...(openNativeHelperSettings ? NATIVE_HELPER_SETTINGS_ACTIONS.map((helperAction) => ({
      id: `native-helper:${helperAction.target}:settings`,
      group: 'system' as const,
      icon: 'settings' as const,
      label: helperAction.label,
      description: helperAction.description,
      keywords: helperAction.keywords,
      run: () => openNativeHelperSettings(helperAction.target),
    })) : []),
    ...(sendUsageContext ? [{
      id: 'context:usage',
      group: 'system' as const,
      icon: 'chat' as const,
      label: 'Send Codex usage context',
      description: 'Send Codex rate limits, reset credits, and account usage history to chat',
      keywords: ['usage', 'account usage', 'history', 'daily', 'rate limit', 'limits', 'credits', 'reset', 'context', 'codex', 'chat'],
      run: sendUsageContext,
    }] : []),
    ...(copyUsageContext ? [{
      id: 'context:usage:copy',
      group: 'system' as const,
      icon: 'chat' as const,
      label: 'Copy Codex usage context',
      description: 'Copy Codex rate limits, reset credits, and account usage history',
      keywords: ['usage', 'account usage', 'history', 'daily', 'rate limit', 'limits', 'credits', 'reset', 'context', 'codex', 'copy', 'clipboard'],
      run: copyUsageContext,
    }] : []),
    ...(sendToolRegistryContext ? [{
      id: 'context:tool-registry',
      group: 'system' as const,
      icon: 'tools' as const,
      label: 'Send Codex tool registry context',
      description: registry
        ? `Send ${registry.apps.length} apps, ${registry.mcpServers.length} MCP servers, and ${registry.mcpServers.reduce((sum, server) => sum + server.toolCount, 0)} tools to chat`
        : 'Fetch and send connected app and MCP registry context to chat',
      keywords: ['codex', 'tool', 'tools', 'registry', 'mcp', 'apps', 'connectors', 'capabilities', 'context', 'chat'],
      run: sendToolRegistryContext,
    }] : []),
    ...(copyToolRegistryContext ? [{
      id: 'context:tool-registry:copy',
      group: 'system' as const,
      icon: 'tools' as const,
      label: 'Copy Codex tool registry context',
      description: registry
        ? `Copy ${registry.apps.length} apps, ${registry.mcpServers.length} MCP servers, and ${registry.mcpServers.reduce((sum, server) => sum + server.toolCount, 0)} tools`
        : 'Fetch and copy connected app and MCP registry context',
      keywords: ['codex', 'tool', 'tools', 'registry', 'mcp', 'apps', 'connectors', 'capabilities', 'context', 'copy', 'clipboard'],
      run: copyToolRegistryContext,
    }] : []),
    ...(upgradePluginMarketplaces ? [{
      id: 'system:plugins:marketplaces:upgrade',
      group: 'system' as const,
      icon: 'tools' as const,
      label: 'Refresh Codex plugin marketplaces',
      description: 'Update configured Codex plugin marketplaces and available plugin metadata',
      keywords: ['apps', 'plugins', 'marketplace', 'update', 'refresh', 'upgrade', 'tools', 'connectors'],
      run: upgradePluginMarketplaces,
    }] : []),
    ...(sendActiveChatContext ? [{
      id: 'context:active-chat',
      group: 'system' as const,
      icon: 'chat' as const,
      label: 'Send active chat context',
      description: activeThread ? `Send ${activeThreadTitle} state, context usage, approvals, and recent messages to chat` : 'No active chat thread',
      keywords: ['active chat', 'thread', 'conversation', 'context usage', 'approvals', 'messages', 'codex', 'chat', 'context', activeThreadTitle],
      disabledReason: activeThread ? undefined : 'Open a chat first',
      run: () => activeThread ? sendActiveChatContext() : undefined,
    }] : []),
    ...(copyActiveChatContext ? [{
      id: 'context:active-chat:copy',
      group: 'system' as const,
      icon: 'chat' as const,
      label: 'Copy active chat context',
      description: activeThread ? `Copy ${activeThreadTitle} state, context usage, approvals, and recent messages` : 'No active chat thread',
      keywords: ['active chat', 'thread', 'conversation', 'context usage', 'approvals', 'messages', 'codex', 'copy', 'clipboard', 'context', activeThreadTitle],
      disabledReason: activeThread ? undefined : 'Open a chat first',
      run: () => activeThread ? copyActiveChatContext() : undefined,
    }] : []),
    ...(exportActiveThreadMarkdown ? [{
      id: 'export:active-chat:markdown',
      group: 'sessions' as const,
      icon: 'chat' as const,
      label: 'Export active chat transcript',
      description: activeThread ? `Save ${activeThreadTitle} transcript as Markdown` : 'No active chat thread',
      keywords: ['active chat', 'thread', 'conversation', 'messages', 'transcript', 'history', 'export', 'save', 'download', 'markdown', activeThreadTitle],
      disabledReason: activeThread ? undefined : 'Open a chat first',
      run: () => activeThread ? exportActiveThreadMarkdown() : undefined,
    }] : []),
    ...(copyActiveThreadMarkdown ? [{
      id: 'clipboard:active-chat:markdown',
      group: 'sessions' as const,
      icon: 'chat' as const,
      label: 'Copy active chat transcript',
      description: activeThread ? `Copy ${activeThreadTitle} transcript as Markdown` : 'No active chat thread',
      keywords: ['active chat', 'thread', 'conversation', 'messages', 'transcript', 'history', 'copy', 'clipboard', 'markdown', activeThreadTitle],
      disabledReason: activeThread ? undefined : 'Open a chat first',
      run: () => activeThread ? copyActiveThreadMarkdown() : undefined,
    }] : []),
    ...(sendLatestAssistantResponseToChat ? [{
      id: 'context:active-chat:latest-assistant-response',
      group: 'system' as const,
      icon: 'chat' as const,
      label: 'Send latest response to chat',
      description: latestAssistantMessage
        ? `Reuse latest ${activeThreadTitle} assistant response as chat context`
        : activeThread
          ? 'No completed assistant response yet'
          : 'No active chat thread',
      keywords: ['active chat', 'thread', 'conversation', 'assistant', 'response', 'answer', 'reuse', 'send', 'context', 'transcript', activeThreadTitle, latestAssistantMessage?.content.slice(0, 160) ?? ''],
      disabledReason: latestAssistantMessage ? undefined : latestAssistantMessageDisabledReason,
      run: () => latestAssistantMessage ? sendLatestAssistantResponseToChat(latestAssistantMessage) : undefined,
    }] : []),
    ...(copyLatestAssistantResponse ? [{
      id: 'clipboard:active-chat:latest-assistant-response',
      group: 'system' as const,
      icon: 'chat' as const,
      label: 'Copy latest response',
      description: latestAssistantMessage
        ? `Copy latest ${activeThreadTitle} assistant response`
        : activeThread
          ? 'No completed assistant response yet'
          : 'No active chat thread',
      keywords: ['active chat', 'thread', 'conversation', 'assistant', 'response', 'answer', 'copy', 'clipboard', 'transcript', activeThreadTitle, latestAssistantMessage?.content.slice(0, 160) ?? ''],
      disabledReason: latestAssistantMessage ? undefined : latestAssistantMessageDisabledReason,
      run: () => latestAssistantMessage ? copyLatestAssistantResponse(latestAssistantMessage) : undefined,
    }] : []),
    ...(sendLatestUserPromptToChat ? [{
      id: 'context:active-chat:latest-user-prompt',
      group: 'system' as const,
      icon: 'chat' as const,
      label: 'Send latest prompt to chat',
      description: latestUserMessage
        ? `Reuse latest ${activeThreadTitle} user prompt as chat context`
        : activeThread
          ? 'No completed user prompt yet'
          : 'No active chat thread',
      keywords: ['active chat', 'thread', 'conversation', 'user', 'prompt', 'request', 'reuse', 'send', 'context', 'transcript', activeThreadTitle, latestUserMessage?.content.slice(0, 160) ?? ''],
      disabledReason: latestUserMessage ? undefined : latestUserMessageDisabledReason,
      run: () => latestUserMessage ? sendLatestUserPromptToChat(latestUserMessage) : undefined,
    }] : []),
    ...(copyLatestUserPrompt ? [{
      id: 'clipboard:active-chat:latest-user-prompt',
      group: 'system' as const,
      icon: 'chat' as const,
      label: 'Copy latest prompt',
      description: latestUserMessage
        ? `Copy latest ${activeThreadTitle} user prompt`
        : activeThread
          ? 'No completed user prompt yet'
          : 'No active chat thread',
      keywords: ['active chat', 'thread', 'conversation', 'user', 'prompt', 'request', 'copy', 'clipboard', 'transcript', activeThreadTitle, latestUserMessage?.content.slice(0, 160) ?? ''],
      disabledReason: latestUserMessage ? undefined : latestUserMessageDisabledReason,
      run: () => latestUserMessage ? copyLatestUserPrompt(latestUserMessage) : undefined,
    }] : []),
    ...(attachFilesToActiveChat ? [{
      id: 'context:active-chat:attach-files',
      group: 'files' as const,
      icon: 'file' as const,
      label: 'Attach files to active chat',
      description: activeThread ? `Attach local files or folders to ${activeThreadTitle}` : 'No active chat thread',
      keywords: ['attach', 'attachment', 'files', 'folders', 'local paths', 'composer', 'codex', 'chat', 'context', activeThreadTitle],
      disabledReason: activeThread ? undefined : 'Open a chat first',
      run: () => activeThread ? attachFilesToActiveChat() : undefined,
    }] : []),
    {
      id: 'system:updates',
      group: 'system',
      icon: 'settings',
      label: 'Open updates',
      description: 'Check Cranberri build, package, and update status',
      keywords: ['update', 'build', 'package', 'version'],
      run: () => openSettings('updates'),
    },
    {
      id: 'system:shortcuts',
      group: 'system',
      icon: 'settings',
      label: 'Open keyboard shortcuts',
      description: 'Review command and composer shortcuts',
      keywords: ['keyboard', 'hotkeys', 'commands'],
      run: () => openSettings('shortcuts'),
    },
  ]

  for (const win of windows) {
    actions.push({
      id: `window:${win.id}`,
      group: 'windows',
      icon: 'window',
      label: `Switch to ${win.title}`,
      description: `${win.type} window${win.id === activeWindowId ? ' - active' : ''}`,
      keywords: ['switch', 'focus', win.type, win.title, win.id],
      run: () => setActiveWindow(win.id),
    })
  }

  if (sendActiveWindowContext || copyActiveWindowContext) {
    actions.push(
      ...(sendActiveWindowContext ? [{
        id: 'context:active-terminal',
        group: 'windows' as const,
        icon: 'terminal' as const,
        label: 'Send active terminal context',
        description: activeTerminalWindow ? `Send ${activeTerminalWindow.title} buffer to chat` : 'Active window is not a terminal',
        keywords: ['chat', 'context', 'terminal', 'shell', 'buffer', 'active window'],
        disabledReason: activeTerminalWindow ? undefined : 'Focus a terminal window first',
        run: () => activeTerminalWindow ? sendActiveWindowContext(activeTerminalWindow.id, 'terminal-buffer') : undefined,
      }] : []),
      ...(copyActiveWindowContext ? [{
        id: 'context:active-terminal:copy',
        group: 'windows' as const,
        icon: 'terminal' as const,
        label: 'Copy active terminal context',
        description: activeTerminalWindow ? `Copy ${activeTerminalWindow.title} formatted buffer context` : 'Active window is not a terminal',
        keywords: ['copy', 'clipboard', 'context', 'terminal', 'shell', 'buffer', 'active window'],
        disabledReason: activeTerminalWindow ? undefined : 'Focus a terminal window first',
        run: () => activeTerminalWindow ? copyActiveWindowContext(activeTerminalWindow.id, 'terminal-buffer') : undefined,
      }] : []),
      ...(sendActiveWindowContext ? [{
        id: 'context:active-browser-page',
        group: 'windows' as const,
        icon: 'browser' as const,
        label: 'Send active browser page context',
        description: activeBrowserWindow ? `Capture ${activeBrowserWindow.title} page text for chat` : 'Active window is not a browser',
        keywords: ['chat', 'context', 'browser', 'page', 'snapshot', 'active window'],
        disabledReason: activeBrowserWindow ? undefined : 'Focus a browser window first',
        run: () => activeBrowserWindow ? sendActiveWindowContext(activeBrowserWindow.id, 'browser-page') : undefined,
      }] : []),
      ...(sendActiveWindowContext ? [{
        id: 'context:active-browser-screenshot',
        group: 'windows' as const,
        icon: 'browser' as const,
        label: 'Send active browser screenshot',
        description: activeBrowserWindow ? `Capture ${activeBrowserWindow.title} screenshot for chat` : 'Active window is not a browser',
        keywords: ['chat', 'context', 'browser', 'screenshot', 'image', 'visual', 'active window'],
        disabledReason: activeBrowserWindow ? undefined : 'Focus a browser window first',
        run: () => activeBrowserWindow ? sendActiveWindowContext(activeBrowserWindow.id, 'browser-screenshot') : undefined,
      }] : []),
      ...(copyActiveWindowContext ? [{
        id: 'context:active-browser-screenshot:copy',
        group: 'windows' as const,
        icon: 'browser' as const,
        label: 'Copy active browser screenshot context',
        description: activeBrowserWindow ? `Capture ${activeBrowserWindow.title} screenshot and copy its context` : 'Active window is not a browser',
        keywords: ['copy', 'clipboard', 'context', 'browser', 'screenshot', 'image', 'visual', 'active window'],
        disabledReason: activeBrowserWindow ? undefined : 'Focus a browser window first',
        run: () => activeBrowserWindow ? copyActiveWindowContext(activeBrowserWindow.id, 'browser-screenshot') : undefined,
      }] : []),
      ...(sendActiveWindowContext ? [{
        id: 'context:active-browser-inspection',
        group: 'windows' as const,
        icon: 'browser' as const,
        label: 'Send active browser element context',
        description: activeBrowserInspection ? `Send inspected ${activeBrowserInspection.selector || activeBrowserInspection.tagName} element to chat` : activeBrowserWindow ? `Capture a visible element in ${activeBrowserWindow.title} for chat` : 'Active window is not a browser',
        keywords: ['chat', 'context', 'browser', 'element', 'inspect', 'inspection', 'selector', 'styles', 'active window', activeBrowserInspection?.selector ?? '', activeBrowserInspection?.text ?? ''],
        disabledReason: activeBrowserWindow ? undefined : 'Focus a browser window first',
        run: () => activeBrowserWindow ? sendActiveWindowContext(activeBrowserWindow.id, 'browser-inspection') : undefined,
      }] : []),
      ...(copyActiveWindowContext ? [{
        id: 'context:active-browser-inspection:copy',
        group: 'windows' as const,
        icon: 'browser' as const,
        label: 'Copy active browser element context',
        description: activeBrowserInspection ? `Copy inspected ${activeBrowserInspection.selector || activeBrowserInspection.tagName} element context` : activeBrowserWindow ? `Capture a visible element in ${activeBrowserWindow.title} and copy its context` : 'Active window is not a browser',
        keywords: ['copy', 'clipboard', 'context', 'browser', 'element', 'inspect', 'inspection', 'selector', 'styles', 'active window', activeBrowserInspection?.selector ?? '', activeBrowserInspection?.text ?? ''],
        disabledReason: activeBrowserWindow ? undefined : 'Focus a browser window first',
        run: () => activeBrowserWindow ? copyActiveWindowContext(activeBrowserWindow.id, 'browser-inspection') : undefined,
      }] : []),
    )
  }

  if (sendLatestTerminalContextToChat || copyLatestTerminalContext) {
    const terminalContext = latestTerminalContext?.terminalId ? latestTerminalContext : null
    const terminalDisabledReason = terminalContext ? undefined : 'Capture terminal context first'
    const sendTerminalDisabledReason = terminalContext ? (activeThread ? undefined : 'Open a chat first') : terminalDisabledReason
    const terminalKeywords = terminalContext
      ? [terminalContext.terminalId, terminalContext.repoPath ?? '', terminalContext.text]
      : []
    actions.push(
      ...(sendLatestTerminalContextToChat ? [{
        id: 'context:terminal:latest',
        group: 'windows' as const,
        icon: 'chat' as const,
        label: 'Send latest terminal context to chat',
        description: terminalContext ? `Send saved terminal buffer from ${terminalContext.terminalId}` : 'No terminal context has been captured yet',
        keywords: ['terminal', 'shell', 'buffer', 'scrollback', 'send', 'chat', 'context', 'latest', ...terminalKeywords],
        disabledReason: sendTerminalDisabledReason,
        run: () => terminalContext && activeThread ? sendLatestTerminalContextToChat(terminalContext) : undefined,
      }] : []),
      ...(copyLatestTerminalContext ? [{
        id: 'terminal:latest:copy',
        group: 'windows' as const,
        icon: 'terminal' as const,
        label: 'Copy latest terminal context',
        description: terminalContext ? `Copy saved terminal buffer from ${terminalContext.terminalId}` : 'No terminal context has been captured yet',
        keywords: ['terminal', 'shell', 'buffer', 'scrollback', 'copy', 'clipboard', 'context', 'latest', ...terminalKeywords],
        disabledReason: terminalDisabledReason,
        run: () => terminalContext ? copyLatestTerminalContext(terminalContext) : undefined,
      }] : []),
    )
  }

  if (sendLatestRepoChangesContextToChat || copyLatestRepoChangesContext) {
    const repoChangesContext = latestRepoChangesContext?.repoPath ? latestRepoChangesContext : null
    const repoChangesKindLabel = repoChangesContext?.kind === 'diff' ? 'repo diff' : 'git status'
    const repoChangesDisabledReason = repoChangesContext ? undefined : 'Send repo status or diff context first'
    const sendRepoChangesDisabledReason = repoChangesContext ? (activeThread ? undefined : 'Open a chat first') : repoChangesDisabledReason
    const repoChangesKeywords = repoChangesContext
      ? [
          repoChangesContext.kind,
          repoChangesContext.repoPath,
          ...repoChangesContext.status.map((file) => `${file.status} ${file.path}`),
          ...(repoChangesContext.diff?.files.map((file) => file.to) ?? []),
        ]
      : []
    actions.push(
      ...(sendLatestRepoChangesContextToChat ? [{
        id: 'context:repo-changes:latest',
        group: 'files' as const,
        icon: 'chat' as const,
        label: 'Send latest repo changes context to chat',
        description: repoChangesContext ? `Send saved ${repoChangesKindLabel} context from ${repoChangesContext.repoPath}` : 'No repo changes context has been sent yet',
        keywords: ['git', 'status', 'diff', 'repo', 'changes', 'send', 'chat', 'context', 'latest', ...repoChangesKeywords],
        disabledReason: sendRepoChangesDisabledReason,
        run: () => repoChangesContext && activeThread ? sendLatestRepoChangesContextToChat(repoChangesContext) : undefined,
      }] : []),
      ...(copyLatestRepoChangesContext ? [{
        id: 'repo:changes:latest:copy',
        group: 'files' as const,
        icon: repoChangesContext?.kind === 'diff' ? 'diff' as const : 'file' as const,
        label: 'Copy latest repo changes context',
        description: repoChangesContext ? `Copy saved ${repoChangesKindLabel} context from ${repoChangesContext.repoPath}` : 'No repo changes context has been sent yet',
        keywords: ['git', 'status', 'diff', 'repo', 'changes', 'copy', 'clipboard', 'context', 'latest', ...repoChangesKeywords],
        disabledReason: repoChangesDisabledReason,
        run: () => repoChangesContext ? copyLatestRepoChangesContext(repoChangesContext) : undefined,
      }] : []),
    )
  }

  if (sendLatestRepoFileContextToChat || copyLatestRepoFileContext) {
    const repoFileContext = latestRepoFileContext?.repoPath && latestRepoFileContext.file.path ? latestRepoFileContext : null
    const repoFileDisabledReason = repoFileContext ? undefined : 'Send a repo file context first'
    const sendRepoFileDisabledReason = repoFileContext ? (activeThread ? undefined : 'Open a chat first') : repoFileDisabledReason
    const repoFileKeywords = repoFileContext
      ? [
          repoFileContext.repoPath,
          repoFileContext.file.path,
          repoFileContext.file.status,
          repoFileContext.workingContent?.slice(0, 240) ?? '',
          repoFileContext.headContent?.slice(0, 240) ?? '',
          ...(repoFileContext.diff?.files.map((file) => file.to) ?? []),
        ]
      : []
    actions.push(
      ...(sendLatestRepoFileContextToChat ? [{
        id: 'context:repo-file:latest',
        group: 'files' as const,
        icon: 'chat' as const,
        label: 'Send latest repo file context to chat',
        description: repoFileContext ? `Send saved file context for ${repoFileContext.file.path}` : 'No repo file context has been sent yet',
        keywords: ['file', 'repo', 'context', 'latest', 'send', 'chat', ...repoFileKeywords],
        disabledReason: sendRepoFileDisabledReason,
        run: () => repoFileContext && activeThread ? sendLatestRepoFileContextToChat(repoFileContext) : undefined,
      }] : []),
      ...(copyLatestRepoFileContext ? [{
        id: 'repo:file:latest:copy',
        group: 'files' as const,
        icon: 'file' as const,
        label: 'Copy latest repo file context',
        description: repoFileContext ? `Copy saved file context for ${repoFileContext.file.path}` : 'No repo file context has been sent yet',
        keywords: ['file', 'repo', 'context', 'latest', 'copy', 'clipboard', ...repoFileKeywords],
        disabledReason: repoFileDisabledReason,
        run: () => repoFileContext ? copyLatestRepoFileContext(repoFileContext) : undefined,
      }] : []),
    )
  }

  if (sendLatestProcessContextToChat || copyLatestProcessContext) {
    const processContext = latestProcessContext?.id ? latestProcessContext : null
    const processCommand = processContext ? shortProcessCommand(processContext) : 'process'
    const processDisabledReason = processContext ? undefined : 'Send a process context first'
    const sendProcessDisabledReason = processContext ? (activeThread ? undefined : 'Open a chat first') : processDisabledReason
    const processKeywords = processContext
      ? [
          processContext.id,
          processContext.command,
          processContext.kind,
          processContext.status,
          processContext.repoPath,
          processContext.cwd ?? '',
          processContext.terminalWindowId ?? '',
        ]
      : []
    actions.push(
      ...(sendLatestProcessContextToChat ? [{
        id: 'context:process:latest',
        group: 'processes' as const,
        icon: 'chat' as const,
        label: 'Send latest process context to chat',
        description: processContext ? `Send saved process context for ${processCommand}` : 'No process context has been sent yet',
        keywords: ['process', 'running', 'dev server', 'terminal', 'context', 'latest', 'send', 'chat', ...processKeywords],
        disabledReason: sendProcessDisabledReason,
        run: () => processContext && activeThread ? sendLatestProcessContextToChat(processContext) : undefined,
      }] : []),
      ...(copyLatestProcessContext ? [{
        id: 'process:latest:copy',
        group: 'processes' as const,
        icon: 'activity' as const,
        label: 'Copy latest process context',
        description: processContext ? `Copy saved process context for ${processCommand}` : 'No process context has been sent yet',
        keywords: ['process', 'running', 'dev server', 'terminal', 'context', 'latest', 'copy', 'clipboard', ...processKeywords],
        disabledReason: processDisabledReason,
        run: () => processContext ? copyLatestProcessContext(processContext) : undefined,
      }] : []),
    )
  }

  if (sendLatestToolEventContextToChat || copyLatestToolEventContext) {
    const toolEventContext = latestToolEventContext?.eventId ? latestToolEventContext : null
    const toolEventTitle = toolEventContext ? (toolEventContext.title ?? toolEventContext.name) : 'tool event'
    const toolEventDisabledReason = toolEventContext ? undefined : 'Send a tool event context first'
    const sendToolEventDisabledReason = toolEventContext ? (activeThread ? undefined : 'Open a chat first') : toolEventDisabledReason
    const toolEventKeywords = toolEventContext
      ? [
          toolEventContext.eventId,
          toolEventContext.threadId,
          toolEventContext.toolCallId ?? '',
          toolEventContext.name,
          toolEventContext.title ?? '',
          toolEventContext.kind,
          toolEventContext.status,
          toolEventContext.server ?? '',
          toolEventContext.connectorName ?? '',
          toolEventContext.argumentsPreview ?? '',
          toolEventContext.resultPreview ?? '',
          toolEventContext.error ?? '',
        ]
      : []
    actions.push(
      ...(sendLatestToolEventContextToChat ? [{
        id: 'context:tool-event:latest',
        group: 'system' as const,
        icon: 'tools' as const,
        label: 'Send latest tool event context to chat',
        description: toolEventContext ? `Send saved tool event context for ${toolEventTitle}` : 'No tool event context has been sent yet',
        keywords: ['tool', 'tools', 'event', 'timeline', 'context', 'latest', 'send', 'chat', ...toolEventKeywords],
        disabledReason: sendToolEventDisabledReason,
        run: () => toolEventContext && activeThread ? sendLatestToolEventContextToChat(toolEventContext) : undefined,
      }] : []),
      ...(copyLatestToolEventContext ? [{
        id: 'tool-event:latest:copy',
        group: 'system' as const,
        icon: 'tools' as const,
        label: 'Copy latest tool event context',
        description: toolEventContext ? `Copy saved tool event context for ${toolEventTitle}` : 'No tool event context has been sent yet',
        keywords: ['tool', 'tools', 'event', 'timeline', 'context', 'latest', 'copy', 'clipboard', ...toolEventKeywords],
        disabledReason: toolEventDisabledReason,
        run: () => toolEventContext ? copyLatestToolEventContext(toolEventContext) : undefined,
      }] : []),
    )
  }

  if (sendLatestSessionContextToChat || copyLatestSessionContext) {
    const sessionContext = latestSessionContext?.thread.id ? latestSessionContext : null
    const title = sessionContext?.thread.title || sessionContext?.result.session.title || 'Untitled session'
    const sessionDisabledReason = sessionContext ? undefined : 'Send a session context first'
    const sendSessionDisabledReason = sessionContext ? (activeThread ? undefined : 'Open a chat first') : sessionDisabledReason
    const sessionKeywords = sessionContext
      ? [
          sessionContext.thread.id,
          sessionContext.thread.sessionId ?? '',
          sessionContext.thread.title ?? '',
          sessionContext.thread.preview ? sessionSummaryPreview(sessionContext.thread.preview) : '',
          sessionContext.thread.cwd ?? '',
          sessionContext.result.repoPath,
          ...((sessionContext.result.transcriptMatches ?? []).flatMap((match) => [match.role, match.preview])),
        ]
      : []
    actions.push(
      ...(sendLatestSessionContextToChat ? [{
        id: 'context:session:latest',
        group: 'sessions' as const,
        icon: 'chat' as const,
        label: 'Send latest session context to chat',
        description: sessionContext ? `Send saved session context from ${title}` : 'No session context has been sent yet',
        keywords: ['session', 'thread', 'history', 'transcript', 'context', 'latest', 'send', 'chat', ...sessionKeywords],
        disabledReason: sendSessionDisabledReason,
        run: () => sessionContext && activeThread ? sendLatestSessionContextToChat(sessionContext) : undefined,
      }] : []),
      ...(copyLatestSessionContext ? [{
        id: 'session:latest:copy',
        group: 'sessions' as const,
        icon: 'session' as const,
        label: 'Copy latest session context',
        description: sessionContext ? `Copy saved session context from ${title}` : 'No session context has been sent yet',
        keywords: ['session', 'thread', 'history', 'transcript', 'context', 'latest', 'copy', 'clipboard', ...sessionKeywords],
        disabledReason: sessionDisabledReason,
        run: () => sessionContext ? copyLatestSessionContext(sessionContext) : undefined,
      }] : []),
    )
  }

  if (sendLatestCodexResourceContextToChat || copyLatestCodexResourceContext) {
    const resourceContext = latestCodexResourceContext?.text ? latestCodexResourceContext : null
    const resourceDisabledReason = resourceContext ? undefined : 'Send a Codex resource context first'
    const sendResourceDisabledReason = resourceContext ? (activeThread ? undefined : 'Open a chat first') : resourceDisabledReason
    const resourceKeywords = resourceContext
      ? [resourceContext.kind, resourceContext.label, resourceContext.text]
      : []
    actions.push(
      ...(sendLatestCodexResourceContextToChat ? [{
        id: 'context:codex-resource:latest',
        group: 'system' as const,
        icon: 'tools' as const,
        label: 'Send latest Codex resource context to chat',
        description: resourceContext ? `Send saved ${resourceContext.label} context` : 'No Codex resource context has been sent yet',
        keywords: ['codex', 'resource', 'skill', 'app', 'mcp', 'tool', 'registry', 'context', 'latest', 'send', 'chat', ...resourceKeywords],
        disabledReason: sendResourceDisabledReason,
        run: () => resourceContext && activeThread ? sendLatestCodexResourceContextToChat(resourceContext) : undefined,
      }] : []),
      ...(copyLatestCodexResourceContext ? [{
        id: 'codex-resource:latest:copy',
        group: 'system' as const,
        icon: 'tools' as const,
        label: 'Copy latest Codex resource context',
        description: resourceContext ? `Copy saved ${resourceContext.label} context` : 'No Codex resource context has been sent yet',
        keywords: ['codex', 'resource', 'skill', 'app', 'mcp', 'tool', 'registry', 'context', 'latest', 'copy', 'clipboard', ...resourceKeywords],
        disabledReason: resourceDisabledReason,
        run: () => resourceContext ? copyLatestCodexResourceContext(resourceContext) : undefined,
      }] : []),
    )
  }

  if (sendLatestBrowserSnapshotToChat || copyLatestBrowserSnapshot) {
    const latestSnapshot = latestBrowserSnapshot ?? null
    const latestSnapshotSource = latestSnapshot?.title || latestSnapshot?.url || 'browser page'
    const latestSnapshotDisabledReason = latestSnapshot ? undefined : 'Capture browser page context first'
    const sendLatestSnapshotDisabledReason = latestSnapshot ? (activeThread ? undefined : 'Open a chat first') : latestSnapshotDisabledReason
    actions.push(
      ...(sendLatestBrowserSnapshotToChat ? [{
        id: 'context:browser-page:latest',
        group: 'windows' as const,
        icon: 'chat' as const,
        label: 'Send latest browser page context to chat',
        description: latestSnapshot ? `Send saved page context from ${latestSnapshotSource}` : 'No browser page context has been captured yet',
        keywords: ['browser', 'page', 'snapshot', 'text', 'visible text', 'send', 'chat', 'context', 'latest', latestSnapshot?.title ?? '', latestSnapshot?.url ?? '', latestSnapshot?.text ?? ''],
        disabledReason: sendLatestSnapshotDisabledReason,
        run: () => latestSnapshot && activeThread ? sendLatestBrowserSnapshotToChat(latestSnapshot) : undefined,
      }] : []),
      ...(copyLatestBrowserSnapshot ? [{
        id: 'browser:page:latest:copy',
        group: 'windows' as const,
        icon: 'browser' as const,
        label: 'Copy latest browser page context',
        description: latestSnapshot ? `Copy saved page context from ${latestSnapshotSource}` : 'No browser page context has been captured yet',
        keywords: ['browser', 'page', 'snapshot', 'text', 'visible text', 'copy', 'clipboard', 'context', 'latest', latestSnapshot?.title ?? '', latestSnapshot?.url ?? '', latestSnapshot?.text ?? ''],
        disabledReason: latestSnapshotDisabledReason,
        run: () => latestSnapshot ? copyLatestBrowserSnapshot(latestSnapshot) : undefined,
      }] : []),
    )
  }

  if (sendLatestBrowserInspectionToChat || copyLatestBrowserInspection) {
    const latestInspection = latestBrowserInspection ?? null
    const latestInspectionLabel = latestInspection?.selector || latestInspection?.tagName || 'element'
    const latestInspectionSource = latestInspection?.title || latestInspection?.url || 'browser page'
    const latestInspectionDisabledReason = latestInspection ? undefined : 'Inspect a browser element first'
    const sendLatestInspectionDisabledReason = latestInspection ? (activeThread ? undefined : 'Open a chat first') : latestInspectionDisabledReason
    actions.push(
      ...(sendLatestBrowserInspectionToChat ? [{
        id: 'context:browser-inspection:latest',
        group: 'windows' as const,
        icon: 'chat' as const,
        label: 'Send latest browser element context to chat',
        description: latestInspection ? `Send inspected ${latestInspectionLabel} element from ${latestInspectionSource}` : 'No browser element has been inspected yet',
        keywords: ['browser', 'element', 'inspect', 'inspection', 'selector', 'styles', 'send', 'chat', 'context', 'latest', latestInspection?.selector ?? '', latestInspection?.tagName ?? '', latestInspection?.text ?? '', latestInspection?.url ?? ''],
        disabledReason: sendLatestInspectionDisabledReason,
        run: () => latestInspection && activeThread ? sendLatestBrowserInspectionToChat(latestInspection) : undefined,
      }] : []),
      ...(copyLatestBrowserInspection ? [{
        id: 'browser:inspection:latest:copy',
        group: 'windows' as const,
        icon: 'browser' as const,
        label: 'Copy latest browser element context',
        description: latestInspection ? `Copy inspected ${latestInspectionLabel} element context from ${latestInspectionSource}` : 'No browser element has been inspected yet',
        keywords: ['browser', 'element', 'inspect', 'inspection', 'selector', 'styles', 'copy', 'clipboard', 'context', 'latest', latestInspection?.selector ?? '', latestInspection?.tagName ?? '', latestInspection?.text ?? '', latestInspection?.url ?? ''],
        disabledReason: latestInspectionDisabledReason,
        run: () => latestInspection ? copyLatestBrowserInspection(latestInspection) : undefined,
      }] : []),
    )
  }

  if (openLatestBrowserScreenshot || revealLatestBrowserScreenshot || copyLatestBrowserScreenshotPath || sendLatestBrowserScreenshotToChat) {
    const screenshotDisabledReason = latestSavedBrowserScreenshot ? undefined : 'Capture a browser screenshot first'
    const sendScreenshotDisabledReason = latestSavedBrowserScreenshot ? (activeThread ? undefined : 'Open a chat first') : screenshotDisabledReason
    const screenshotPath = latestSavedBrowserScreenshot?.screenshot.path ?? ''
    const screenshotTitle = latestSavedBrowserScreenshot?.pageState.title || latestSavedBrowserScreenshot?.pageState.url || 'saved browser page'
    actions.push(
      ...(sendLatestBrowserScreenshotToChat ? [{
        id: 'context:browser-screenshot:latest',
        group: 'windows' as const,
        icon: 'chat' as const,
        label: 'Send latest browser screenshot to chat',
        description: latestSavedBrowserScreenshot ? `Attach saved screenshot from ${screenshotTitle}` : 'No browser screenshot has been captured yet',
        keywords: ['browser', 'screenshot', 'image', 'visual', 'send', 'chat', 'context', 'local image', 'latest', screenshotPath, latestSavedBrowserScreenshot?.pageState.title ?? '', latestSavedBrowserScreenshot?.pageState.url ?? ''],
        disabledReason: sendScreenshotDisabledReason,
        run: () => latestSavedBrowserScreenshot && activeThread ? sendLatestBrowserScreenshotToChat(latestSavedBrowserScreenshot) : undefined,
      }] : []),
      ...(openLatestBrowserScreenshot ? [{
        id: 'browser:screenshot:latest:open',
        group: 'windows' as const,
        icon: 'browser' as const,
        label: 'Open latest browser screenshot',
        description: latestSavedBrowserScreenshot ? `Open ${screenshotPath} in the default app` : 'No browser screenshot has been captured yet',
        keywords: ['browser', 'screenshot', 'image', 'visual', 'open', 'external', 'default app', 'system', screenshotPath],
        disabledReason: screenshotDisabledReason,
        run: () => latestSavedBrowserScreenshot?.screenshot.path ? openLatestBrowserScreenshot(latestSavedBrowserScreenshot.screenshot.path) : undefined,
      }] : []),
      ...(revealLatestBrowserScreenshot ? [{
        id: 'browser:screenshot:latest:reveal',
        group: 'windows' as const,
        icon: 'browser' as const,
        label: 'Reveal latest browser screenshot in Finder',
        description: latestSavedBrowserScreenshot ? `Reveal ${screenshotPath} in Finder` : 'No browser screenshot has been captured yet',
        keywords: ['browser', 'screenshot', 'image', 'visual', 'reveal', 'finder', 'show in finder', 'system', screenshotPath],
        disabledReason: screenshotDisabledReason,
        run: () => latestSavedBrowserScreenshot?.screenshot.path ? revealLatestBrowserScreenshot(latestSavedBrowserScreenshot.screenshot.path) : undefined,
      }] : []),
      ...(copyLatestBrowserScreenshotPath ? [{
        id: 'browser:screenshot:latest:copy-path',
        group: 'windows' as const,
        icon: 'browser' as const,
        label: 'Copy latest browser screenshot path',
        description: latestSavedBrowserScreenshot ? `Copy ${screenshotPath}` : 'No browser screenshot has been captured yet',
        keywords: ['browser', 'screenshot', 'image', 'visual', 'copy', 'path', 'clipboard', 'local image', screenshotPath],
        disabledReason: screenshotDisabledReason,
        run: () => latestSavedBrowserScreenshot?.screenshot.path ? copyLatestBrowserScreenshotPath(latestSavedBrowserScreenshot.screenshot.path) : undefined,
      }] : []),
    )
  }

  if (controlActiveTerminal) {
    const terminalDisabledReason = activeTerminalWindow ? undefined : 'Focus a terminal window first'
    actions.push(
      {
        id: 'terminal:active:search',
        group: 'windows',
        icon: 'terminal',
        label: 'Search active terminal',
        description: activeTerminalWindow ? `Open search in ${activeTerminalWindow.title}` : 'Active window is not a terminal',
        keywords: ['terminal', 'search', 'find', 'shell', 'buffer', 'active window'],
        disabledReason: terminalDisabledReason,
        run: () => activeTerminalWindow ? controlActiveTerminal(activeTerminalWindow.id, 'search') : undefined,
      },
      {
        id: 'terminal:active:search-next',
        group: 'windows',
        icon: 'terminal',
        label: 'Find next in active terminal',
        description: activeTerminalWindow ? `Find next match in ${activeTerminalWindow.title}` : 'Active window is not a terminal',
        keywords: ['terminal', 'search', 'find', 'next', 'shell', 'buffer', 'active window'],
        disabledReason: terminalDisabledReason,
        run: () => activeTerminalWindow ? controlActiveTerminal(activeTerminalWindow.id, 'search-next') : undefined,
      },
      {
        id: 'terminal:active:search-previous',
        group: 'windows',
        icon: 'terminal',
        label: 'Find previous in active terminal',
        description: activeTerminalWindow ? `Find previous match in ${activeTerminalWindow.title}` : 'Active window is not a terminal',
        keywords: ['terminal', 'search', 'find', 'previous', 'back', 'shell', 'buffer', 'active window'],
        disabledReason: terminalDisabledReason,
        run: () => activeTerminalWindow ? controlActiveTerminal(activeTerminalWindow.id, 'search-previous') : undefined,
      },
      {
        id: 'terminal:active:search-close',
        group: 'windows',
        icon: 'terminal',
        label: 'Close active terminal search',
        description: activeTerminalWindow ? `Close search in ${activeTerminalWindow.title}` : 'Active window is not a terminal',
        keywords: ['terminal', 'search', 'find', 'close', 'hide', 'shell', 'active window'],
        disabledReason: terminalDisabledReason,
        run: () => activeTerminalWindow ? controlActiveTerminal(activeTerminalWindow.id, 'search-close') : undefined,
      },
      {
        id: 'terminal:active:copy-buffer',
        group: 'windows',
        icon: 'terminal',
        label: 'Copy active terminal buffer',
        description: activeTerminalWindow ? `Copy ${activeTerminalWindow.title} scrollback` : 'Active window is not a terminal',
        keywords: ['terminal', 'copy', 'clipboard', 'scrollback', 'buffer', 'shell', 'active window'],
        disabledReason: terminalDisabledReason,
        run: () => activeTerminalWindow ? controlActiveTerminal(activeTerminalWindow.id, 'copy-buffer') : undefined,
      },
      {
        id: 'terminal:active:clear',
        group: 'windows',
        icon: 'terminal',
        label: 'Clear active terminal',
        description: activeTerminalWindow ? `Clear ${activeTerminalWindow.title} scrollback` : 'Active window is not a terminal',
        keywords: ['terminal', 'clear', 'reset', 'scrollback', 'buffer', 'shell', 'active window'],
        disabledReason: terminalDisabledReason,
        run: () => activeTerminalWindow ? controlActiveTerminal(activeTerminalWindow.id, 'clear') : undefined,
      },
    )
  }

  if (sendWorkspaceBrief || copyWorkspaceBrief) {
    actions.push(
      ...(sendWorkspaceBrief ? [{
        id: 'context:workspace-brief',
        group: 'workspace' as const,
        icon: 'chat' as const,
        label: 'Send workspace brief',
        description: 'Send repo, windows, changes, GitHub, processes, and active chat state to Codex',
        keywords: ['chat', 'context', 'workspace', 'brief', 'repo', 'windows', 'changes', 'github', 'processes', 'codex'],
        disabledReason: needsRepo,
        run: sendWorkspaceBrief,
      }] : []),
      ...(copyWorkspaceBrief ? [{
        id: 'context:workspace-brief:copy',
        group: 'workspace' as const,
        icon: 'chat' as const,
        label: 'Copy workspace brief',
        description: 'Copy repo, windows, changes, GitHub, processes, and active chat state',
        keywords: ['copy', 'clipboard', 'context', 'workspace', 'brief', 'repo', 'windows', 'changes', 'github', 'processes', 'codex'],
        disabledReason: needsRepo,
        run: copyWorkspaceBrief,
      }] : []),
    )
  }

  if (controlActiveBrowser) {
    const browserDisabledReason = activeBrowserWindow ? undefined : 'Focus a browser window first'
    actions.push(
      {
        id: 'browser:active:reload',
        group: 'windows',
        icon: 'browser',
        label: 'Reload active browser',
        description: activeBrowserWindow ? `Reload ${activeBrowserWindow.title}` : 'Active window is not a browser',
        keywords: ['browser', 'reload', 'refresh', 'preview', 'active window'],
        disabledReason: browserDisabledReason,
        run: () => activeBrowserWindow ? controlActiveBrowser(activeBrowserWindow.id, 'reload') : undefined,
      },
      {
        id: 'browser:active:back',
        group: 'windows',
        icon: 'browser',
        label: 'Go back in active browser',
        description: activeBrowserWindow ? `Navigate ${activeBrowserWindow.title} back` : 'Active window is not a browser',
        keywords: ['browser', 'back', 'history', 'previous', 'active window'],
        disabledReason: browserDisabledReason,
        run: () => activeBrowserWindow ? controlActiveBrowser(activeBrowserWindow.id, 'back') : undefined,
      },
      {
        id: 'browser:active:forward',
        group: 'windows',
        icon: 'browser',
        label: 'Go forward in active browser',
        description: activeBrowserWindow ? `Navigate ${activeBrowserWindow.title} forward` : 'Active window is not a browser',
        keywords: ['browser', 'forward', 'history', 'next', 'active window'],
        disabledReason: browserDisabledReason,
        run: () => activeBrowserWindow ? controlActiveBrowser(activeBrowserWindow.id, 'forward') : undefined,
      },
      {
        id: 'browser:active:stop',
        group: 'windows',
        icon: 'browser',
        label: 'Stop active browser loading',
        description: activeBrowserWindow ? `Stop ${activeBrowserWindow.title}` : 'Active window is not a browser',
        keywords: ['browser', 'stop', 'loading', 'cancel', 'active window'],
        disabledReason: browserDisabledReason,
        run: () => activeBrowserWindow ? controlActiveBrowser(activeBrowserWindow.id, 'stop') : undefined,
      },
      {
        id: 'browser:active:inspect-start',
        group: 'windows',
        icon: 'browser',
        label: 'Inspect active browser element',
        description: activeBrowserWindow ? `Start element inspection in ${activeBrowserWindow.title}` : 'Active window is not a browser',
        keywords: ['browser', 'inspect', 'element', 'selector', 'styles', 'design mode', 'active window'],
        disabledReason: browserDisabledReason,
        run: () => activeBrowserWindow ? controlActiveBrowser(activeBrowserWindow.id, 'inspect-start') : undefined,
      },
      {
        id: 'browser:active:inspect-stop',
        group: 'windows',
        icon: 'browser',
        label: 'Stop active browser inspection',
        description: activeBrowserWindow ? `Stop element inspection in ${activeBrowserWindow.title}` : 'Active window is not a browser',
        keywords: ['browser', 'inspect', 'element', 'stop', 'cancel', 'design mode', 'active window'],
        disabledReason: browserDisabledReason,
        run: () => activeBrowserWindow ? controlActiveBrowser(activeBrowserWindow.id, 'inspect-stop') : undefined,
      },
      {
        id: 'browser:active:open-external',
        group: 'windows',
        icon: 'browser',
        label: 'Open active browser externally',
        description: activeBrowserWindow ? `Open ${activeBrowserWindow.title} in the system browser` : 'Active window is not a browser',
        keywords: ['browser', 'open', 'external', 'system browser', 'url', 'link', 'preview', 'active window'],
        disabledReason: browserDisabledReason,
        run: () => activeBrowserWindow ? controlActiveBrowser(activeBrowserWindow.id, 'open-external') : undefined,
      },
      {
        id: 'browser:active:copy-url',
        group: 'windows',
        icon: 'browser',
        label: 'Copy active browser URL',
        description: activeBrowserWindow ? `Copy ${activeBrowserWindow.title} URL to clipboard` : 'Active window is not a browser',
        keywords: ['browser', 'copy', 'clipboard', 'url', 'link', 'address', 'preview', 'active window'],
        disabledReason: browserDisabledReason,
        run: () => activeBrowserWindow ? controlActiveBrowser(activeBrowserWindow.id, 'copy-url') : undefined,
      },
      {
        id: 'browser:active:copy-page-context',
        group: 'windows',
        icon: 'browser',
        label: 'Copy active browser page context',
        description: activeBrowserWindow ? `Copy ${activeBrowserWindow.title} page context to clipboard` : 'Active window is not a browser',
        keywords: ['browser', 'copy', 'clipboard', 'page', 'context', 'snapshot', 'text', 'codex', 'active window'],
        disabledReason: browserDisabledReason,
        run: () => activeBrowserWindow ? controlActiveBrowser(activeBrowserWindow.id, 'copy-page-context') : undefined,
      },
    )
  }

  if (setActiveBrowserViewport) {
    const browserDisabledReason = activeBrowserWindow ? undefined : 'Focus a browser window first'
    const activeViewportMode = activeBrowserWindow?.browser?.viewportMode ?? 'responsive'
    actions.push(...BROWSER_VIEWPORT_ACTIONS.map((viewport) => ({
      id: `browser:active:viewport:${viewport.mode}`,
      group: 'windows' as const,
      icon: 'browser' as const,
      label: viewport.label,
      description: activeBrowserWindow
        ? `${activeViewportMode === viewport.mode ? 'Keep' : 'Switch'} ${activeBrowserWindow.title} ${activeViewportMode === viewport.mode ? 'in' : 'to'} ${viewport.mode} viewport`
        : 'Active window is not a browser',
      keywords: ['browser', 'viewport', 'responsive design', 'preview', 'active window', viewport.mode, ...viewport.keywords],
      disabledReason: browserDisabledReason,
      run: () => activeBrowserWindow ? setActiveBrowserViewport(activeBrowserWindow.id, viewport.mode) : undefined,
    })))
  }

  if (sendRepoChangesContext || copyRepoChangesContext || reviewRepoChangesContext || explainRepoChangesContext || testRepoChangesContext || draftPullRequestContext) {
    const reviewRepoChangesDisabledReason = needsRepo ?? (activeThread ? undefined : 'Open a chat first')
    actions.push(
      ...(sendRepoChangesContext ? [{
        id: 'context:repo-status',
        group: 'files' as const,
        icon: 'chat' as const,
        label: 'Send git status context',
        description: 'Send changed file status to chat',
        keywords: ['git', 'status', 'changes', 'repo', 'chat', 'context', 'files'],
        disabledReason: needsRepo,
        run: () => sendRepoChangesContext('status'),
      }] : []),
      ...(copyRepoChangesContext ? [{
        id: 'context:repo-status:copy',
        group: 'files' as const,
        icon: 'file' as const,
        label: 'Copy git status context',
        description: 'Copy changed file status context',
        keywords: ['git', 'status', 'changes', 'repo', 'copy', 'clipboard', 'context', 'files'],
        disabledReason: needsRepo,
        run: () => copyRepoChangesContext('status'),
      }] : []),
      ...(sendRepoChangesContext ? [{
        id: 'context:repo-diff',
        group: 'files' as const,
        icon: 'diff' as const,
        label: 'Send repo diff context',
        description: 'Send changed files and diff hunks to chat',
        keywords: ['git', 'diff', 'patch', 'changes', 'repo', 'chat', 'context', 'files'],
        disabledReason: needsRepo,
        run: () => sendRepoChangesContext('diff'),
      }] : []),
      ...(copyRepoChangesContext ? [{
        id: 'context:repo-diff:copy',
        group: 'files' as const,
        icon: 'diff' as const,
        label: 'Copy repo diff context',
        description: 'Copy changed files and diff hunks',
        keywords: ['git', 'diff', 'patch', 'changes', 'repo', 'copy', 'clipboard', 'context', 'files'],
        disabledReason: needsRepo,
        run: () => copyRepoChangesContext('diff'),
      }] : []),
      ...(reviewRepoChangesContext ? [{
        id: 'context:repo-diff:review',
        group: 'files' as const,
        icon: 'chat' as const,
        label: 'Review repo changes',
        description: 'Ask Codex to review the current changed files and diff',
        keywords: ['git', 'diff', 'patch', 'changes', 'repo', 'review', 'code review', 'bugs', 'tests', 'chat', 'codex'],
        disabledReason: reviewRepoChangesDisabledReason,
        run: () => activeThread ? reviewRepoChangesContext() : undefined,
      }] : []),
      ...(explainRepoChangesContext ? [{
        id: 'context:repo-diff:explain',
        group: 'files' as const,
        icon: 'chat' as const,
        label: 'Explain repo changes',
        description: 'Ask Codex to summarize the current changed files and diff',
        keywords: ['git', 'diff', 'patch', 'changes', 'repo', 'explain', 'summary', 'walkthrough', 'implementation', 'behavior', 'chat', 'codex'],
        disabledReason: reviewRepoChangesDisabledReason,
        run: () => activeThread ? explainRepoChangesContext() : undefined,
      }] : []),
      ...(testRepoChangesContext ? [{
        id: 'context:repo-diff:test',
        group: 'files' as const,
        icon: 'chat' as const,
        label: 'Write tests for repo changes',
        description: 'Ask Codex to add or update focused tests for the current diff',
        keywords: ['git', 'diff', 'patch', 'changes', 'repo', 'tests', 'test', 'coverage', 'vitest', 'regression', 'chat', 'codex'],
        disabledReason: reviewRepoChangesDisabledReason,
        run: () => activeThread ? testRepoChangesContext() : undefined,
      }] : []),
      ...(draftPullRequestContext ? [{
        id: 'context:repo-diff:pr-description',
        group: 'files' as const,
        icon: 'chat' as const,
        label: 'Draft PR description from repo changes',
        description: 'Ask Codex to draft a pull request title and body from the current diff',
        keywords: ['git', 'diff', 'patch', 'changes', 'repo', 'pull request', 'pr', 'description', 'summary', 'testing', 'release notes', 'chat', 'codex'],
        disabledReason: reviewRepoChangesDisabledReason,
        run: () => activeThread ? draftPullRequestContext() : undefined,
      }] : []),
    )
  }

  if (sendGitHubContext || copyGitHubContext) {
    const githubActions: Array<{ kind: GitHubContextKind; label: string; description: string; keywords: string[] }> = [
      { kind: 'repo', label: 'Send GitHub repo context', description: 'Send GitHub repository metadata to chat', keywords: ['github', 'repo', 'remote', 'context'] },
      { kind: 'pulls', label: 'Send GitHub PR context', description: 'Send recent pull request context to chat', keywords: ['github', 'pull request', 'pr', 'context'] },
      { kind: 'issues', label: 'Send GitHub issue context', description: 'Send recent issue context to chat', keywords: ['github', 'issue', 'context'] },
      { kind: 'actions', label: 'Send GitHub CI context', description: 'Send recent workflow run context to chat', keywords: ['github', 'actions', 'ci', 'workflow', 'context'] },
      { kind: 'branches', label: 'Send GitHub branch context', description: 'Send repository branch context to chat', keywords: ['github', 'branch', 'branches', 'context'] },
      { kind: 'commits', label: 'Send GitHub commit context', description: 'Send recent commit context to chat', keywords: ['github', 'commit', 'commits', 'history', 'context'] },
      { kind: 'releases', label: 'Send GitHub release context', description: 'Send release context to chat', keywords: ['github', 'release', 'releases', 'tag', 'context'] },
    ]
    actions.push(...githubActions.flatMap((action) => [
      ...(sendGitHubContext ? [{
        id: `context:github:${action.kind}`,
        group: 'rail' as const,
        icon: 'github' as const,
        label: action.label,
        description: action.description,
        keywords: ['chat', 'codex', ...action.keywords],
        disabledReason: needsRepo,
        run: () => sendGitHubContext(action.kind),
      }] : []),
      ...(copyGitHubContext ? [{
        id: `context:github:${action.kind}:copy`,
        group: 'rail' as const,
        icon: 'github' as const,
        label: action.label.replace(/^Send /, 'Copy '),
        description: action.description.replace(/^Send /, 'Copy ').replace(/ to chat$/, ''),
        keywords: ['copy', 'clipboard', 'codex', ...action.keywords],
        disabledReason: needsRepo,
        run: () => copyGitHubContext(action.kind),
      }] : []),
    ]))
  }

  if (sendLatestGitHubContextToChat || copyLatestGitHubContext) {
    const githubContext = latestGitHubContext?.text ? latestGitHubContext : null
    const githubDisabledReason = githubContext ? undefined : 'Send a GitHub context first'
    const sendGitHubDisabledReason = githubContext ? (activeThread ? undefined : 'Open a chat first') : githubDisabledReason
    const githubKeywords = githubContext
      ? [githubContext.kind, githubContext.label, githubContext.repoPath, githubContext.text]
      : []
    actions.push(
      ...(sendLatestGitHubContextToChat ? [{
        id: 'context:github:latest',
        group: 'rail' as const,
        icon: 'github' as const,
        label: 'Send latest GitHub context to chat',
        description: githubContext ? `Send saved GitHub context for ${githubContext.label}` : 'No GitHub context has been sent yet',
        keywords: ['github', 'context', 'latest', 'send', 'chat', 'repo', 'pull request', 'issue', 'branch', 'commit', 'release', ...githubKeywords],
        disabledReason: sendGitHubDisabledReason,
        run: () => githubContext && activeThread ? sendLatestGitHubContextToChat(githubContext) : undefined,
      }] : []),
      ...(copyLatestGitHubContext ? [{
        id: 'github:latest:copy',
        group: 'rail' as const,
        icon: 'github' as const,
        label: 'Copy latest GitHub context',
        description: githubContext ? `Copy saved GitHub context for ${githubContext.label}` : 'No GitHub context has been sent yet',
        keywords: ['github', 'context', 'latest', 'copy', 'clipboard', 'repo', 'pull request', 'issue', 'branch', 'commit', 'release', ...githubKeywords],
        disabledReason: githubDisabledReason,
        run: () => githubContext ? copyLatestGitHubContext(githubContext) : undefined,
      }] : []),
    )
  }

  if (sendLatestAppContextToChat || copyLatestAppContext) {
    const appContext = latestAppContext?.text ? latestAppContext : null
    const appContextDisabledReason = appContext ? undefined : 'Send an app context first'
    const sendAppContextDisabledReason = appContext ? (activeThread ? undefined : 'Open a chat first') : appContextDisabledReason
    const appContextKeywords = appContext
      ? [appContext.kind, appContext.label, appContext.text]
      : []
    actions.push(
      ...(sendLatestAppContextToChat ? [{
        id: 'context:app:latest',
        group: 'system' as const,
        icon: 'chat' as const,
        label: 'Send latest app context to chat',
        description: appContext ? `Send saved ${appContext.label} context` : 'No app, workspace, diagnostics, usage, or active chat context has been sent yet',
        keywords: ['app', 'workspace', 'diagnostics', 'usage', 'active chat', 'system', 'context', 'latest', 'send', 'chat', ...appContextKeywords],
        disabledReason: sendAppContextDisabledReason,
        run: () => appContext && activeThread ? sendLatestAppContextToChat(appContext) : undefined,
      }] : []),
      ...(copyLatestAppContext ? [{
        id: 'app:latest:copy',
        group: 'system' as const,
        icon: 'chat' as const,
        label: 'Copy latest app context',
        description: appContext ? `Copy saved ${appContext.label} context` : 'No app, workspace, diagnostics, usage, or active chat context has been sent yet',
        keywords: ['app', 'workspace', 'diagnostics', 'usage', 'active chat', 'system', 'context', 'latest', 'copy', 'clipboard', ...appContextKeywords],
        disabledReason: appContextDisabledReason,
        run: () => appContext ? copyLatestAppContext(appContext) : undefined,
      }] : []),
    )
  }

  if (compactActiveThread || interruptActiveThread || archiveActiveThread || renameActiveThread || deleteActiveThread || toggleSessionPinned) {
    if (compactActiveThread) {
      actions.push({
        id: 'codex:active:compact',
        group: 'sessions',
        icon: 'session',
        label: 'Compact active chat',
        description: activeThread ? `Compact ${activeThreadTitle}` : 'No active chat thread',
        keywords: ['codex', 'chat', 'thread', 'compact', 'context', activeThreadTitle],
        disabledReason: activeThread ? undefined : 'Open a chat first',
        run: () => activeThread ? compactActiveThread() : undefined,
      })
    }
    if (archiveActiveThread) {
      actions.push({
        id: 'codex:active:archive',
        group: 'sessions',
        icon: 'session',
        label: 'Archive active chat',
        description: activeThread ? `Archive ${activeThreadTitle}` : 'No active chat thread',
        keywords: ['codex', 'chat', 'thread', 'session', 'archive', activeThreadTitle],
        disabledReason: activeThread ? undefined : 'Open a chat first',
        run: () => activeThread ? archiveActiveThread() : undefined,
      })
    }
    if (renameActiveThread) {
      actions.push({
        id: 'codex:active:rename',
        group: 'sessions',
        icon: 'session',
        label: 'Rename active chat',
        description: activeThread ? `Rename ${activeThreadTitle}` : 'No active chat thread',
        keywords: ['codex', 'chat', 'thread', 'session', 'rename', 'title', activeThreadTitle],
        disabledReason: activeThread ? undefined : 'Open a chat first',
        run: () => activeThread ? renameActiveThread() : undefined,
      })
    }
    if (deleteActiveThread) {
      actions.push({
        id: 'codex:active:delete',
        group: 'sessions',
        icon: 'session',
        label: 'Delete active chat',
        description: activeThread ? `Delete ${activeThreadTitle}` : 'No active chat thread',
        keywords: ['codex', 'chat', 'thread', 'session', 'delete', 'remove', activeThreadTitle],
        disabledReason: activeThread ? undefined : 'Open a chat first',
        run: () => activeThread ? deleteActiveThread() : undefined,
      })
    }
    if (toggleSessionPinned) {
      const activeThreadPinned = activeThread ? pinnedSessionIds.includes(activeThread.id) : false
      actions.push({
        id: 'codex:active:pin',
        group: 'sessions',
        icon: 'session',
        label: activeThreadPinned ? 'Unpin active chat' : 'Pin active chat',
        description: activeThread ? `${activeThreadPinned ? 'Unpin' : 'Pin'} ${activeThreadTitle}` : 'No active chat thread',
        keywords: ['codex', 'chat', 'thread', 'session', 'pin', 'pinned', 'favorite', 'star', activeThreadPinned ? 'unpin' : 'pin', activeThreadTitle],
        disabledReason: activeThread ? undefined : 'Open a chat first',
        run: () => activeThreadSession ? toggleSessionPinned(activeThreadSession) : undefined,
      })
    }
    if (interruptActiveThread) {
      actions.push({
        id: 'codex:active:interrupt',
        group: 'sessions',
        icon: 'session',
        label: 'Interrupt active Codex run',
        description: activeThread?.isRunning ? `Stop ${activeThreadTitle}` : 'Active chat is not running',
        keywords: ['codex', 'chat', 'thread', 'interrupt', 'stop', 'abort', 'cancel', activeThreadTitle],
        disabledReason: activeThread?.isRunning ? undefined : 'Active chat is not running',
        run: () => activeThread?.isRunning ? interruptActiveThread() : undefined,
      })
    }
  }

  if (resolveActiveApproval) {
    const pendingApprovals = activeThread?.pendingApprovals ?? []
    for (const approval of pendingApprovals) {
      const description = approval.description || 'Pending Codex approval'
      actions.push(
        {
          id: `codex:approval:${approval.id}:approve`,
          group: 'sessions',
          icon: 'tools',
          label: 'Approve pending Codex action',
          description,
          keywords: ['codex', 'approval', 'approve', 'permission', 'tool', 'action', description, approval.id, approval.reviewId],
          run: () => resolveActiveApproval(approval.id, 'approve'),
        },
        {
          id: `codex:approval:${approval.id}:deny`,
          group: 'sessions',
          icon: 'tools',
          label: 'Deny pending Codex action',
          description,
          keywords: ['codex', 'approval', 'deny', 'reject', 'permission', 'tool', 'action', description, approval.id, approval.reviewId],
          run: () => resolveActiveApproval(approval.id, 'deny'),
        },
      )
    }
  }

  if (openRightRail) {
    const selectedFileDisabledReason = selectedRightRailFile ? undefined : 'Select a file in the right rail first'
    const commitDisabledReason = needsRepo
      ?? (changedFileCount === null ? 'Reading changed files...' : undefined)
      ?? (changedFileCount === 0 ? 'No changed files to commit' : undefined)
    const selectedFileSearchDisabledReason = selectedFileDisabledReason
      ?? (selectedRightRailFile?.status === 'tracked' ? undefined : 'Open a tracked file reader first')
    const selectedFileAttachDisabledReason = selectedFileDisabledReason
      ?? (!activeThread ? 'Open a chat first' : undefined)
      ?? (selectedRightRailFile?.status === 'deleted' ? 'Selected file no longer exists in the working tree' : undefined)
    const selectedFileNativeDisabledReason = selectedFileDisabledReason
      ?? (selectedRightRailFile?.status === 'deleted' ? 'Selected file no longer exists in the working tree' : undefined)
    actions.push(
      {
        id: 'rail:files:changes',
        group: 'rail',
        icon: 'file',
        label: 'Show changed files',
        description: 'Open the right rail Files tab in Changes mode',
        keywords: ['rail', 'right rail', 'files', 'changes', 'git', 'diff'],
        disabledReason: needsRepo,
        run: () => openRightRail({ tab: 'files', filesMode: 'changes' }),
      },
      {
        id: 'rail:files:all',
        group: 'rail',
        icon: 'file',
        label: 'Show all repo files',
        description: 'Open the right rail Files tab in All Files mode',
        keywords: ['rail', 'right rail', 'files', 'tree', 'all files', 'repo'],
        disabledReason: needsRepo,
        run: () => openRightRail({ tab: 'files', filesMode: 'all' }),
      },
      {
        id: 'rail:diff',
        group: 'rail',
        icon: 'diff',
        label: 'Show diff rail',
        description: 'Open the right rail Diff tab',
        keywords: ['rail', 'right rail', 'diff', 'patch', 'changes'],
        disabledReason: needsRepo,
        run: () => openRightRail({ tab: 'diff' }),
      },
      {
        id: 'rail:commit',
        group: 'rail',
        icon: 'diff',
        label: 'Open commit dialog',
        description: changedFileCount === null
          ? 'Open the right rail commit dialog for current changes'
          : `Open the right rail commit dialog for ${changedFileCount} changed file${changedFileCount === 1 ? '' : 's'}`,
        keywords: ['rail', 'right rail', 'git', 'commit', 'changes', 'message', 'diff'],
        disabledReason: commitDisabledReason,
        run: () => openRightRail({ action: 'open-commit' }),
      },
      {
        id: 'rail:commit:draft',
        group: 'rail',
        icon: 'chat',
        label: 'Draft commit message',
        description: changedFileCount === null
          ? 'Ask Codex to draft a commit title and summary for current changes'
          : `Ask Codex to draft a commit title and summary for ${changedFileCount} changed file${changedFileCount === 1 ? '' : 's'}`,
        keywords: ['rail', 'right rail', 'git', 'commit', 'message', 'draft', 'generate', 'codex', 'ai', 'diff'],
        disabledReason: commitDisabledReason,
        run: () => openRightRail({ action: 'open-commit-draft' }),
      },
      {
        id: 'rail:processes',
        group: 'rail',
        icon: 'activity',
        label: 'Show repo processes',
        description: 'Open running repo processes in the right rail',
        keywords: ['rail', 'right rail', 'processes', 'running', 'terminal', 'dev server'],
        disabledReason: needsRepo,
        run: () => openRightRail({ bottomPanel: 'processes' }),
      },
      {
        id: 'rail:tools',
        group: 'rail',
        icon: 'tools',
        label: 'Show tool timeline',
        description: 'Open the right rail tool timeline',
        keywords: ['rail', 'right rail', 'tools', 'timeline', 'events'],
        disabledReason: needsRepo,
        run: () => openRightRail({ bottomPanel: 'tools' }),
      },
      {
        id: 'rail:github',
        group: 'rail',
        icon: 'github',
        label: 'Show GitHub rail',
        description: 'Open GitHub repo context in the right rail',
        keywords: ['rail', 'right rail', 'github', 'pull requests', 'issues', 'repo'],
        disabledReason: needsRepo,
        run: () => openRightRail({ bottomPanel: 'github' }),
      },
      {
        id: 'rail:issue',
        group: 'rail',
        icon: 'activity',
        label: 'Show issue rail',
        description: 'Open issue context in the right rail',
        keywords: ['rail', 'right rail', 'issue', 'linear', 'ticket'],
        disabledReason: needsRepo,
        run: () => openRightRail({ bottomPanel: 'issue' }),
      },
      {
        id: 'rail:close-bottom',
        group: 'rail',
        icon: 'window',
        label: 'Close bottom rail',
        description: 'Hide the right rail bottom panel',
        keywords: ['rail', 'right rail', 'close', 'hide', 'bottom panel'],
        disabledReason: needsRepo,
        run: () => openRightRail({ bottomPanel: null }),
      },
      {
        id: 'rail:file:search',
        group: 'rail',
        icon: 'file',
        label: 'Search selected file',
        description: selectedRightRailFile ? `Open file search in ${selectedRightRailFile.path}` : 'No right rail file is selected',
        keywords: ['rail', 'right rail', 'file', 'search', 'find', 'editor', 'codemirror', selectedRightRailFile?.path ?? ''],
        disabledReason: selectedFileSearchDisabledReason,
        run: () => openRightRail({ selectedFileCommand: 'search' }),
      },
      {
        id: 'rail:file:go-to-line',
        group: 'rail',
        icon: 'file',
        label: 'Go to line in selected file',
        description: selectedRightRailFile ? `Jump to a line in ${selectedRightRailFile.path}` : 'No right rail file is selected',
        keywords: ['rail', 'right rail', 'file', 'go to line', 'line', 'jump', 'editor', 'codemirror', selectedRightRailFile?.path ?? ''],
        disabledReason: selectedFileSearchDisabledReason,
        run: () => openRightRail({ selectedFileCommand: 'go-to-line' }),
      },
      {
        id: 'rail:file:send-context',
        group: 'rail',
        icon: 'chat',
        label: 'Send selected file context',
        description: selectedRightRailFile ? `Send ${selectedRightRailFile.path} context to chat` : 'No right rail file is selected',
        keywords: ['rail', 'right rail', 'file', 'chat', 'context', 'codex', selectedRightRailFile?.path ?? ''],
        disabledReason: selectedFileDisabledReason,
        run: () => openRightRail({ selectedFileCommand: 'send-context' }),
      },
      ...(attachRepoFileToActiveChat ? [{
        id: 'rail:file:attach',
        group: 'rail' as const,
        icon: 'file' as const,
        label: 'Attach selected file to active chat',
        description: selectedRightRailFile ? `Attach ${selectedRightRailFile.path} as a local file path` : 'No right rail file is selected',
        keywords: ['rail', 'right rail', 'file', 'attach', 'attachment', 'local path', 'chat', 'codex', selectedRightRailFile?.path ?? ''],
        disabledReason: selectedFileAttachDisabledReason,
        run: () => selectedRightRailFile && selectedRightRailFile.status !== 'deleted' ? attachRepoFileToActiveChat(selectedRightRailFile.path) : undefined,
      }] : []),
      {
        id: 'rail:file:copy-path',
        group: 'rail',
        icon: 'file',
        label: 'Copy selected file path',
        description: selectedRightRailFile ? `Copy ${selectedRightRailFile.path}` : 'No right rail file is selected',
        keywords: ['rail', 'right rail', 'file', 'copy', 'path', 'clipboard', selectedRightRailFile?.path ?? ''],
        disabledReason: selectedFileDisabledReason,
        run: () => openRightRail({ selectedFileCommand: 'copy-path' }),
      },
      {
        id: 'rail:file:copy-content',
        group: 'rail',
        icon: 'file',
        label: 'Copy selected file content',
        description: selectedRightRailFile ? `Copy ${selectedRightRailFile.path} content` : 'No right rail file is selected',
        keywords: ['rail', 'right rail', 'file', 'copy', 'content', 'clipboard', selectedRightRailFile?.path ?? ''],
        disabledReason: selectedFileDisabledReason,
        run: () => openRightRail({ selectedFileCommand: 'copy-content' }),
      },
      ...(copySelectedFileAbsolutePath ? [{
        id: 'rail:file:copy-absolute-path',
        group: 'rail' as const,
        icon: 'file' as const,
        label: 'Copy selected file absolute path',
        description: selectedRightRailFile ? `Copy absolute path for ${selectedRightRailFile.path}` : 'No right rail file is selected',
        keywords: ['rail', 'right rail', 'file', 'copy', 'absolute path', 'full path', 'clipboard', 'local path', selectedRightRailFile?.path ?? ''],
        disabledReason: selectedFileNativeDisabledReason,
        run: () => selectedRightRailFile && selectedRightRailFile.status !== 'deleted' ? copySelectedFileAbsolutePath(selectedRightRailFile.path) : undefined,
      }] : []),
      ...(openSelectedFileExternal ? [{
        id: 'rail:file:open-external',
        group: 'rail' as const,
        icon: 'file' as const,
        label: 'Open selected file',
        description: selectedRightRailFile ? `Open ${selectedRightRailFile.path} in the default app` : 'No right rail file is selected',
        keywords: ['rail', 'right rail', 'file', 'open', 'external', 'default app', 'system', selectedRightRailFile?.path ?? ''],
        disabledReason: selectedFileNativeDisabledReason,
        run: () => selectedRightRailFile && selectedRightRailFile.status !== 'deleted' ? openSelectedFileExternal(selectedRightRailFile.path) : undefined,
      }] : []),
      ...(revealSelectedFileInFolder ? [{
        id: 'rail:file:reveal',
        group: 'rail' as const,
        icon: 'file' as const,
        label: 'Reveal selected file in Finder',
        description: selectedRightRailFile ? `Reveal ${selectedRightRailFile.path} in Finder` : 'No right rail file is selected',
        keywords: ['rail', 'right rail', 'file', 'reveal', 'finder', 'show in finder', 'system', selectedRightRailFile?.path ?? ''],
        disabledReason: selectedFileNativeDisabledReason,
        run: () => selectedRightRailFile && selectedRightRailFile.status !== 'deleted' ? revealSelectedFileInFolder(selectedRightRailFile.path) : undefined,
      }] : []),
    )
  }

  for (const processInfo of processes) {
    const command = shortProcessCommand(processInfo)
    const processKeywords = [
      'process',
      'running',
      processInfo.kind,
      processInfo.command,
      processInfo.id,
      processInfo.cwd,
      processInfo.pid != null ? `pid ${processInfo.pid}` : '',
    ].filter((value): value is string => Boolean(value))

    if (openProcessTerminal && processInfo.terminalWindowId) {
      actions.push({
        id: `process:${processInfo.id}:terminal`,
        group: 'processes',
        icon: 'terminal',
        label: `Focus process terminal: ${command}`,
        description: processDescription(processInfo),
        keywords: ['terminal', 'focus', 'shell', ...processKeywords],
        run: () => openProcessTerminal(processInfo),
      })
    }

    if (processInfo.kind === 'dev-server' && openProcessBrowser) {
      actions.push({
        id: `process:${processInfo.id}:browser`,
        group: 'processes',
        icon: 'browser',
        label: `Open process browser: ${command}`,
        description: processDescription(processInfo),
        keywords: ['browser', 'preview', 'dev server', ...processKeywords],
        run: () => openProcessBrowser(processInfo),
      })
    }

    if (sendProcessContext) {
      actions.push({
        id: `process:${processInfo.id}:context`,
        group: 'processes',
        icon: 'chat',
        label: `Send process context: ${command}`,
        description: processDescription(processInfo),
        keywords: ['chat', 'context', 'codex', ...processKeywords],
        run: () => sendProcessContext(processInfo),
      })
    }
  }

  if (installPlugin) {
    for (const plugin of plugins.filter((item) => !(item.installed ?? item.enabled))) {
      actions.push({
        id: `plugin:${plugin.id}:install`,
        group: 'system',
        icon: 'tools',
        label: `Install plugin: ${plugin.displayName}`,
        description: plugin.description || plugin.sourceLabel || plugin.id,
        keywords: ['apps', 'plugins', 'install', 'marketplace', 'tools', 'connectors', plugin.id, plugin.name, plugin.displayName, plugin.description, plugin.marketplaceName, plugin.version].filter((value): value is string => Boolean(value)),
        run: () => installPlugin(plugin),
      })
    }
  }

  if (sendSkillContext || copySkillContext) {
    for (const skill of skills.slice(0, 80)) {
      const keywords = ['skill', 'codex', 'capability', 'chat', 'context', skill.id, skill.name, skill.displayName, skill.description, skill.pluginName, skill.source].filter((value): value is string => Boolean(value))
      if (sendSkillContext) actions.push({
        id: `skill:${skill.id}:context`,
        group: 'system',
        icon: 'chat',
        label: `Send skill context: ${skill.displayName}`,
        description: skill.description || skill.pluginName || skill.source,
        keywords: ['send', ...keywords],
        run: () => sendSkillContext(skill),
      })
      if (copySkillContext) actions.push({
        id: `skill:${skill.id}:copy-context`,
        group: 'system',
        icon: 'tools',
        label: `Copy skill context: ${skill.displayName}`,
        description: skill.description || skill.pluginName || skill.source,
        keywords: ['copy', 'clipboard', ...keywords],
        run: () => copySkillContext(skill),
      })
    }
  }

  if (registry && (sendAppContext || copyAppContext || sendMcpServerContext || copyMcpServerContext || sendMcpToolContext || copyMcpToolContext)) {
    if (sendAppContext || copyAppContext) {
      for (const app of registry.apps) {
        const keywords = ['app', 'connected app', 'connector', 'chat', 'context', app.id, app.name, app.description, app.distributionChannel, ...app.pluginDisplayNames].filter((value): value is string => Boolean(value))
        if (sendAppContext) actions.push({
          id: `app:${app.id}:context`,
          group: 'system',
          icon: 'chat',
          label: `Send app context: ${app.name}`,
          description: app.description ?? (app.pluginDisplayNames.join(', ') || app.id),
          keywords: ['send', ...keywords],
          run: () => sendAppContext(app),
        })
        if (copyAppContext) actions.push({
          id: `app:${app.id}:copy-context`,
          group: 'system',
          icon: 'tools',
          label: `Copy app context: ${app.name}`,
          description: app.description ?? (app.pluginDisplayNames.join(', ') || app.id),
          keywords: ['copy', 'clipboard', ...keywords],
          run: () => copyAppContext(app),
        })
      }
    }
    if (sendMcpServerContext || copyMcpServerContext) {
      for (const server of registry.mcpServers) {
        const keywords = ['mcp', 'server', 'tools', 'chat', 'context', server.name, server.authStatus]
        if (sendMcpServerContext) actions.push({
          id: `mcp:${server.name}:context`,
          group: 'system',
          icon: 'chat',
          label: `Send MCP server context: ${server.name}`,
          description: `${server.authStatus} - ${server.toolCount} tools`,
          keywords: ['send', ...keywords],
          run: () => sendMcpServerContext(server),
        })
        if (copyMcpServerContext) actions.push({
          id: `mcp:${server.name}:copy-context`,
          group: 'system',
          icon: 'tools',
          label: `Copy MCP server context: ${server.name}`,
          description: `${server.authStatus} - ${server.toolCount} tools`,
          keywords: ['copy', 'clipboard', ...keywords],
          run: () => copyMcpServerContext(server),
        })
      }
    }
    if (sendMcpToolContext || copyMcpToolContext) {
      for (const server of registry.mcpServers) {
        for (const tool of server.tools.slice(0, 40)) {
          const title = tool.title ?? tool.name
          const keywords = ['mcp', 'tool', 'tools', 'chat', 'context', server.name, server.authStatus, tool.name, tool.title, tool.description].filter((value): value is string => Boolean(value))
          if (sendMcpToolContext) actions.push({
            id: `mcp:${server.name}:tool:${tool.name}:context`,
            group: 'system',
            icon: 'chat',
            label: `Send MCP tool context: ${title}`,
            description: `${server.name} - ${tool.description ?? tool.name}`,
            keywords: ['send', ...keywords],
            run: () => sendMcpToolContext(server, tool),
          })
          if (copyMcpToolContext) actions.push({
            id: `mcp:${server.name}:tool:${tool.name}:copy-context`,
            group: 'system',
            icon: 'tools',
            label: `Copy MCP tool context: ${title}`,
            description: `${server.name} - ${tool.description ?? tool.name}`,
            keywords: ['copy', 'clipboard', ...keywords],
            run: () => copyMcpToolContext(server, tool),
          })
        }
      }
    }
  }

  if (sendToolEventContext || copyToolEventContext) {
    for (const event of [...toolEvents].reverse().slice(0, 30)) {
      const title = event.title ?? event.name
      const description = [event.status, event.kind, event.server, event.error ?? event.resultPreview ?? event.argumentsPreview].filter(Boolean).join(' - ')
      const keywords = [
        'tool',
        'tools',
        'event',
        'timeline',
        'chat',
        'context',
        event.eventId,
        event.threadId,
        event.toolCallId ?? '',
        event.name,
        event.title ?? '',
        event.kind,
        event.status,
        event.server ?? '',
        event.connectorName ?? '',
        event.argumentsPreview ?? '',
        event.resultPreview ?? '',
        event.error ?? '',
      ]
      if (sendToolEventContext) actions.push({
        id: `tool-event:${stableActionId(event.eventId)}:context`,
        group: 'system',
        icon: 'tools',
        label: `Send tool event context: ${title}`,
        description,
        keywords: ['send', ...keywords],
        run: () => sendToolEventContext(event),
      })
      if (copyToolEventContext) actions.push({
        id: `tool-event:${stableActionId(event.eventId)}:copy-context`,
        group: 'system',
        icon: 'tools',
        label: `Copy tool event context: ${title}`,
        description,
        keywords: ['copy', 'clipboard', ...keywords],
        run: () => copyToolEventContext(event),
      })
    }
  }

  for (const result of sessions) {
    const { session, repoPath, archived, transcriptMatches = [] } = result
    const preview = session.preview ? sessionSummaryPreview(session.preview) : ''
    const title = session.title || preview || 'Untitled session'
    const active = activeSessionIds.includes(session.id)
    const pinned = pinnedSessionIds.includes(session.id)
    const matchKeywords = transcriptMatches.flatMap((match) => [match.role, match.preview])
    actions.push({
      id: `session:${archived ? 'archived:' : ''}${session.id}`,
      group: 'sessions',
      icon: 'session',
      label: `${active ? 'Switch to' : 'Open'} ${title}${archived ? ' (archived)' : ''}`,
      description: [active ? 'Open' : null, archived ? 'Archived' : null, transcriptMatches.length ? `${transcriptMatches.length} transcript match${transcriptMatches.length === 1 ? '' : 'es'}` : null, preview || repoPath].filter(Boolean).join(' - '),
      keywords: ['session', 'thread', 'history', archived ? 'archived' : 'recent', active ? 'open' : '', title, preview, session.id, repoPath, ...matchKeywords],
      run: () => openSession(session, repoPath, archived),
    })
    if (sendSessionContext) {
      actions.push({
        id: `session:${archived ? 'archived:' : ''}${session.id}:context`,
        group: 'sessions',
        icon: 'chat',
        label: transcriptMatches.length ? `Send session match: ${title}` : `Send session context: ${title}`,
        description: (transcriptMatches[0]?.preview ?? preview) || repoPath,
        keywords: ['session', 'thread', 'history', 'chat', 'context', 'codex', archived ? 'archived' : 'recent', title, preview, session.id, repoPath, ...matchKeywords],
        run: () => sendSessionContext(result),
      })
    }
    if (copySessionContext) {
      actions.push({
        id: `session:${archived ? 'archived:' : ''}${session.id}:copy-context`,
        group: 'sessions',
        icon: 'session',
        label: transcriptMatches.length ? `Copy session match: ${title}` : `Copy session context: ${title}`,
        description: (transcriptMatches[0]?.preview ?? preview) || repoPath,
        keywords: ['session', 'thread', 'history', 'copy', 'clipboard', 'context', 'codex', archived ? 'archived' : 'recent', title, preview, session.id, repoPath, ...matchKeywords],
        run: () => copySessionContext(result),
      })
    }
    if (archived && unarchiveSession) {
      actions.push({
        id: `session:archived:${session.id}:unarchive`,
        group: 'sessions',
        icon: 'session',
        label: `Unarchive session: ${title}`,
        description: session.preview || repoPath,
        keywords: ['session', 'thread', 'history', 'unarchive', 'restore', title, session.preview, session.id, repoPath, ...matchKeywords],
        run: () => unarchiveSession(session.id),
      })
    } else if (!archived && archiveSession) {
      actions.push({
        id: `session:${session.id}:archive`,
        group: 'sessions',
        icon: 'session',
        label: `Archive session: ${title}`,
        description: session.preview || repoPath,
        keywords: ['session', 'thread', 'history', 'archive', title, session.preview, session.id, repoPath, ...matchKeywords],
        run: () => archiveSession(session.id),
      })
    }
    if (renameSession) {
      actions.push({
        id: `session:${archived ? 'archived:' : ''}${session.id}:rename`,
        group: 'sessions',
        icon: 'session',
        label: `Rename session: ${title}`,
        description: session.preview || repoPath,
        keywords: ['session', 'thread', 'history', 'rename', 'title', archived ? 'archived' : 'recent', title, session.preview, session.id, repoPath, ...matchKeywords],
        run: () => renameSession(session.id, title),
      })
    }
    if (toggleSessionPinned) {
      actions.push({
        id: `session:${archived ? 'archived:' : ''}${session.id}:pin`,
        group: 'sessions',
        icon: 'session',
        label: `${pinned ? 'Unpin' : 'Pin'} session: ${title}`,
        description: session.preview || repoPath,
        keywords: ['session', 'thread', 'history', 'pin', 'pinned', 'favorite', 'star', pinned ? 'unpin' : 'pin', archived ? 'archived' : 'recent', title, session.preview, session.id, repoPath, ...matchKeywords],
        run: () => toggleSessionPinned(session),
      })
    }
    if (deleteSession) {
      actions.push({
        id: `session:${archived ? 'archived:' : ''}${session.id}:delete`,
        group: 'sessions',
        icon: 'session',
        label: `Delete session: ${title}`,
        description: session.preview || repoPath,
        keywords: ['session', 'thread', 'history', 'delete', 'remove', archived ? 'archived' : 'recent', title, session.preview, session.id, repoPath, ...matchKeywords],
        run: () => deleteSession(session.id, title),
      })
    }
  }

  for (const repo of repos) {
    actions.push({
      id: `repo:${repo.id}`,
      group: 'repos',
      icon: 'repo',
      label: repo.id === activeRepoId ? `${repo.name} (active)` : `Switch to ${repo.name}`,
      description: repo.path,
      keywords: ['repo', 'project', repo.name, repo.path],
      run: () => setActiveRepo(repo.id),
    })
  }

  return actions
}

function codexThreadAsSessionSummary(thread: CodexThread): CodexSessionSummary {
  const timestamp = Date.now()
  const lastMessage = [...thread.messages].reverse().find((message) => message.content.trim())
  return {
    id: thread.id,
    title: thread.title || 'Untitled session',
    preview: lastMessage?.content.slice(0, 160) ?? '',
    createdAt: timestamp,
    updatedAt: timestamp,
    archived: false,
    turnCount: thread.messages.filter((message) => message.role === 'user').length,
  }
}

function shortProcessCommand(processInfo: AgentProcessInfo): string {
  const command = processInfo.command.trim() || processInfo.id
  return command.length > 60 ? `${command.slice(0, 57)}...` : command
}

function processDescription(processInfo: AgentProcessInfo): string {
  return [
    processInfo.kind,
    processInfo.pid != null ? `pid ${processInfo.pid}` : null,
    processInfo.cwd,
  ].filter(Boolean).join(' - ')
}

function githubItemKindLabel(kind: GitHubPanelKind): string {
  if (kind === 'pulls') return 'PR'
  if (kind === 'issues') return 'issue'
  if (kind === 'actions') return 'CI'
  if (kind === 'branches') return 'branch'
  if (kind === 'commits') return 'commit'
  if (kind === 'releases') return 'release'
  return 'repo'
}

function githubItemDescription(panel: GitHubPanelData, item: GitHubPanelItem): string {
  return [
    item.state,
    item.subtitle,
    item.author ? `@${item.author}` : null,
    panel.source ? `source: ${panel.source}` : null,
  ].filter(Boolean).join(' - ') || `Send ${githubItemKindLabel(panel.kind)} item to chat`
}

function stableActionId(value: string): string {
  return value.trim().replace(/[^a-zA-Z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '') || 'item'
}

export function buildActiveThreadMessageActions({
  activeThread,
  query,
  sendMessageContext,
  copyMessageText,
}: BuildActiveThreadMessageActionsInput): AppAction[] {
  if (!activeThread || normalizeActionText(query).length < ACTIVE_TRANSCRIPT_SEARCH_MIN_CHARS) return []

  const actions = [...activeThread.messages]
    .reverse()
    .filter((message) => (message.role === 'user' || message.role === 'assistant') && !message.pending && message.content.trim())
    .slice(0, ACTIVE_TRANSCRIPT_MESSAGE_LIMIT)
    .flatMap((message): AppAction[] => {
      const roleLabel = transcriptMessageRoleLabel(message)
      const preview = transcriptMessagePreview(message.content)
      const description = `${activeThread.title || 'Active chat'} - ${roleLabel}`
      const keywords = [
        'active chat',
        'thread',
        'conversation',
        'message',
        'transcript',
        'history',
        'reuse',
        'context',
        roleLabel,
        activeThread.title,
        message.content.slice(0, 300),
      ]
      return [
        {
          id: `context:active-chat:message:${stableActionId(message.id)}`,
          group: 'system',
          icon: 'chat',
          label: `Send transcript message to chat: ${preview}`,
          description,
          keywords: ['send', ...keywords],
          run: () => sendMessageContext(message),
        },
        {
          id: `clipboard:active-chat:message:${stableActionId(message.id)}`,
          group: 'system',
          icon: 'chat',
          label: `Copy transcript message: ${preview}`,
          description,
          keywords: ['copy', 'clipboard', ...keywords],
          run: () => copyMessageText(message),
        },
      ]
    })

  return actions
    .filter((action) => actionMatchesQuery(action, query))
    .slice(0, ACTIVE_TRANSCRIPT_ACTION_LIMIT)
}

function transcriptMessageRoleLabel(message: CodexMessage): string {
  return message.role === 'assistant' ? 'assistant response' : 'user prompt'
}

function transcriptMessagePreview(content: string): string {
  const normalized = content.replace(/\s+/g, ' ').trim()
  if (normalized.length <= ACTIVE_TRANSCRIPT_PREVIEW_MAX_CHARS) return normalized
  return `${normalized.slice(0, ACTIVE_TRANSCRIPT_PREVIEW_MAX_CHARS - 3)}...`
}

export function buildFileSearchActions({ contentMatches, fileMatches, openFile, sendFileContext, copyFileContext, attachFile }: BuildFileSearchActionsInput): AppAction[] {
  const filePathActions: AppAction[] = fileMatches.flatMap((match, index) => {
    const openAction: AppAction = {
      id: `file:path:${match.path}:${index}`,
      group: 'files',
      icon: 'file',
      label: match.path,
      description: match.directory ? `Path match in ${match.directory}` : 'Path match',
      keywords: ['file', 'path', 'open', match.path, match.basename, match.directory],
      run: () => openFile(match.path),
    }
    const companionActions: AppAction[] = []
    if (sendFileContext) {
      companionActions.push(
        {
          id: `file:path:${match.path}:${index}:context`,
          group: 'files',
          icon: 'chat',
          label: `Send file context: ${match.path}`,
          description: match.directory ? `Send path match in ${match.directory} to chat` : 'Send path match to chat',
          keywords: ['file', 'path', 'chat', 'context', 'codex', match.path, match.basename, match.directory],
          run: () => sendFileContext(match.path),
        },
      )
    }
    if (copyFileContext) {
      companionActions.push({
        id: `file:path:${match.path}:${index}:copy-context`,
        group: 'files',
        icon: 'file',
        label: `Copy file context: ${match.path}`,
        description: match.directory ? `Copy path match in ${match.directory}` : 'Copy path match context',
        keywords: ['file', 'path', 'copy', 'clipboard', 'context', 'codex', match.path, match.basename, match.directory],
        run: () => copyFileContext(match.path),
      })
    }
    if (attachFile) {
      companionActions.push({
        id: `file:path:${match.path}:${index}:attach`,
        group: 'files',
        icon: 'file',
        label: `Attach file to active chat: ${match.path}`,
        description: match.directory ? `Attach path match in ${match.directory}` : 'Attach path match',
        keywords: ['file', 'path', 'attach', 'attachment', 'local path', 'chat', 'codex', match.path, match.basename, match.directory],
        run: () => attachFile(match.path),
      })
    }
    return [
      openAction,
      ...companionActions,
    ]
  })
  const contentActions: AppAction[] = contentMatches.flatMap((match, index) => {
    const openAction: AppAction = {
      id: `file:${match.path}:${match.line}:${match.column}:${index}`,
      group: 'files',
      icon: 'file',
      label: `${match.path}:${match.line}`,
      description: match.text.trim(),
      keywords: ['file', 'search', 'code', match.path, String(match.line), match.text],
      run: () => openFile(match.path, match.line),
    }
    const companionActions: AppAction[] = []
    if (sendFileContext) {
      companionActions.push(
        {
          id: `file:${match.path}:${match.line}:${match.column}:${index}:context`,
          group: 'files',
          icon: 'chat',
          label: `Send file context: ${match.path}:${match.line}`,
          description: match.text.trim(),
          keywords: ['file', 'search', 'code', 'chat', 'context', 'codex', match.path, String(match.line), match.text],
          run: () => sendFileContext(match.path, match.line),
        },
      )
    }
    if (copyFileContext) {
      companionActions.push({
        id: `file:${match.path}:${match.line}:${match.column}:${index}:copy-context`,
        group: 'files',
        icon: 'file',
        label: `Copy file context: ${match.path}:${match.line}`,
        description: match.text.trim(),
        keywords: ['file', 'search', 'code', 'copy', 'clipboard', 'context', 'codex', match.path, String(match.line), match.text],
        run: () => copyFileContext(match.path, match.line),
      })
    }
    if (attachFile) {
      companionActions.push({
        id: `file:${match.path}:${match.line}:${match.column}:${index}:attach`,
        group: 'files',
        icon: 'file',
        label: `Attach file to active chat: ${match.path}`,
        description: match.text.trim(),
        keywords: ['file', 'search', 'code', 'attach', 'attachment', 'local path', 'chat', 'codex', match.path, String(match.line), match.text],
        run: () => attachFile(match.path),
      })
    }
    return [
      openAction,
      ...companionActions,
    ]
  })
  return [...filePathActions, ...contentActions]
}

export function buildGitHubItemActions({ panels, sendGitHubItemContext, copyGitHubItemContext }: BuildGitHubItemActionsInput): AppAction[] {
  const actions: AppAction[] = []
  for (const panel of panels) {
    if (panel.kind === 'repo') continue
    for (const item of panel.items.slice(0, 20)) {
      const keywords = [
        'github',
        'chat',
        'codex',
        'context',
        panel.kind,
        githubItemKindLabel(panel.kind),
        item.id,
        item.title,
        item.subtitle ?? '',
        item.state ?? '',
        item.author ?? '',
        item.url ?? '',
        ...Object.entries(item.meta ?? {}).map(([key, value]) => `${key} ${String(value)}`),
      ].filter(Boolean)
      actions.push({
        id: `context:github:${panel.kind}:item:${stableActionId(item.id)}`,
        group: 'rail',
        icon: 'github',
        label: `Send GitHub ${githubItemKindLabel(panel.kind)} context: ${item.title}`,
        description: githubItemDescription(panel, item),
        keywords: ['send', ...keywords],
        run: () => sendGitHubItemContext(panel.kind, item),
      })
      if (copyGitHubItemContext) {
        actions.push({
          id: `context:github:${panel.kind}:item:${stableActionId(item.id)}:copy`,
          group: 'rail',
          icon: 'github',
          label: `Copy GitHub ${githubItemKindLabel(panel.kind)} context: ${item.title}`,
          description: githubItemDescription(panel, item),
          keywords: ['copy', 'clipboard', ...keywords],
          run: () => copyGitHubItemContext(panel.kind, item),
        })
      }
    }
  }
  return actions
}
