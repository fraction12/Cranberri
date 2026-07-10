import { CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandRoot } from 'cmdk'
import { Activity, FileDiff, FileText, FolderGit2, Github, Globe, LayoutPanelTop, MessageSquare, PlugZap, Settings, Terminal } from 'lucide-react'
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useRepos } from '../state/repos'
import { useWorkspace } from '../state/workspace'
import { useCodexActions, useCodexThreads, useCodexWindows } from '../state/codex'
import { useAppState } from '../state/appState'
import { useRecentToolEvents } from '../state/tools'
import { pinnedSessionIds as pinnedIdsFromState, pinnedSessionRecords, removePinnedSessions, togglePinnedSession } from '../state/pinned-sessions'
import { actionSearchText, buildActiveThreadMessageActions, buildAppActions, buildFileSearchActions, buildGitHubItemActions, filterAppActions, type AppAction, type AppActionGroup, type AppActionIcon, type LatestRepoChangesContext, type LatestRepoFileContext, type LatestTerminalContext } from '../state/actions'
import { createOpenRightRailFileEvent } from './right-rail/right-rail-file-events'
import { createOpenRightRailCommandEvent } from './right-rail/right-rail-command-events'
import { RIGHT_RAIL_ACTIVE_FILE_EVENT, rightRailActiveFileFromEvent } from './right-rail/right-rail-active-file-events'
import { createSendChatContextEvent } from './chat/chat-context-events'
import { createOpenProcessBrowserEvent } from './process-browser-events'
import { createOpenProcessTerminalEvent } from './process-terminal-events'
import { REPO_FILE_CONTEXT_CAPTURED_EVENT, repoFileContextFromEvent } from './repo-file-context-events'
import { processChatContext } from './process-chat-context'
import { createProcessContextCapturedEvent, PROCESS_CONTEXT_CAPTURED_EVENT, processContextFromEvent } from './process-context-events'
import { terminalBufferChatContext } from './terminal-chat-context'
import { browserInspectionChatContext, browserScreenshotChatContext, browserSnapshotChatContext } from './browser-chat-context'
import { browserScreenshotContextFromEvent, browserSnapshotContextFromEvent, BROWSER_SCREENSHOT_CONTEXT_CAPTURED_EVENT, BROWSER_SNAPSHOT_CONTEXT_CAPTURED_EVENT, createBrowserScreenshotContextCapturedEvent, createBrowserSnapshotContextCapturedEvent, type LatestBrowserScreenshotContext } from './browser-context-events'
import { repoChangesChatContext, repoChangesExplanationChatContext, repoChangesPullRequestChatContext, repoChangesReviewChatContext, repoChangesTestPlanChatContext, repoFileChatContext } from './repo-chat-context'
import { githubItemChatContext, githubPanelChatContext, type LatestGitHubContext } from './github-chat-context'
import { createGitHubContextCapturedEvent, GITHUB_CONTEXT_CAPTURED_EVENT, githubContextFromEvent } from './github-context-events'
import { appContextFromEvent, APP_CONTEXT_CAPTURED_EVENT, createAppContextCapturedEvent, type LatestAppContext } from './app-context-events'
import { workspaceBriefChatContext } from './workspace-chat-context'
import { diagnosticsChatContext } from './diagnostics-chat-context'
import { diagnosticsPathRowByKey, type DiagnosticsPathKey } from './diagnostics-paths'
import { usageChatContext } from './usage-chat-context'
import { activeChatContext } from './active-chat-context'
import { appChatContext, mcpServerChatContext, mcpToolChatContext, skillChatContext, toolRegistryChatContext, type LatestCodexResourceContext } from './codex-resources'
import { codexResourceContextFromEvent, CODEX_RESOURCE_CONTEXT_CAPTURED_EVENT, createCodexResourceContextCapturedEvent } from './codex-resource-context-events'
import { toolEventChatContext } from './tool-chat-context'
import { createToolEventContextCapturedEvent, TOOL_EVENT_CONTEXT_CAPTURED_EVENT, toolEventContextFromEvent } from './tool-event-context-events'
import { createSessionContextCapturedEvent, SESSION_CONTEXT_CAPTURED_EVENT, sessionContextFromEvent } from './session-context-events'
import { createTerminalWindowCommandEvent } from './terminal-window-command-events'
import { assistantResponseChatContext, userPromptChatContext } from './chat/assistant-response-context'
import { activeThreadExportFileName, activeThreadMarkdownExport } from './chat/transcript-export'
import { codexThreadSummary, compactSessionSummary, searchSessionTranscript, sessionChatContext, sessionThreadMatchesSummary, type LatestSessionContext, type SessionSearchResult } from '../state/session-search'
import { repoAbsolutePath } from '../lib/repo-path'
import { ConfirmDialog } from './ConfirmDialog'
import type { CodexMessage, CodexSessionSummary, CodexSessionThread, CodexThread } from '@/shared/codex'
import type { BrowserElementInspection, BrowserSnapshot } from '@/shared/browser'
import type { GitFileStatus, GitHubPanelData, GitHubPanelItem, GitHubPanelKind } from '@/shared/git'
import type { AgentProcessInfo } from '@/shared/processes'
import type { ToolEventRecord } from '@/shared/tools'
import type { SettingsTabValue } from './SettingsDialog'
import type { ActiveBrowserCommand, ActiveBrowserViewportMode, ActiveTerminalCommand, ActiveWindowContextKind, GitHubContextKind, RepoChangesContextKind } from '../state/actions'

const COMMAND_GITHUB_ITEM_KINDS: GitHubPanelKind[] = ['branches', 'commits', 'releases']

interface CommandConfirmation {
  title: string
  description: string
  confirmLabel: string
  busyLabel?: string
  successLabel?: string
  danger?: boolean
  onConfirm: () => Promise<void>
}

interface CommandPaletteProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onOpenSettings: (tab?: SettingsTabValue) => void
}

function ActiveThreadSync({ onThread }: { onThread: (thread: CodexThread | null) => void }) {
  const { activeThread } = useCodexThreads()

  useEffect(() => onThread(activeThread), [activeThread, onThread])
  return null
}

export function CommandPalette({ open, onOpenChange, onOpenSettings }: CommandPaletteProps) {
  const queryClient = useQueryClient()
  const { repos, activeRepoId, activeRepo, setActiveRepo } = useRepos()
  const { windows, activeWindowId, openChat, openTerminal, openBrowser, updateBrowserState, setActiveWindow } = useWorkspace()
  const { activeThreadId, openThreadIds } = useCodexWindows()
  const { getThreadSnapshot, compactThread, archiveSession, unarchiveSession, deleteSession, renameSession, approve, abort } = useCodexActions()
  const activeThreadSnapshot = activeThreadId ? getThreadSnapshot(activeThreadId) ?? null : null
  const [liveActiveThread, setLiveActiveThread] = useState<CodexThread | null>(null)
  const actionQueueRef = useRef<Promise<void>>(Promise.resolve())
  const activeThread = open && liveActiveThread?.id === activeThreadId ? liveActiveThread : activeThreadSnapshot
  const { state: appState, updateAppState } = useAppState()
  const [query, setQuery] = useState('')
  const [selectedRightRailFile, setSelectedRightRailFile] = useState<GitFileStatus | null>(null)
  const [latestProcessContext, setLatestProcessContext] = useState<AgentProcessInfo | null>(null)
  const [latestToolEventContext, setLatestToolEventContext] = useState<ToolEventRecord | null>(null)
  const [latestSessionContext, setLatestSessionContext] = useState<LatestSessionContext | null>(null)
  const [latestCodexResourceContext, setLatestCodexResourceContext] = useState<LatestCodexResourceContext | null>(null)
  const [latestAppContext, setLatestAppContext] = useState<LatestAppContext | null>(null)
  const [latestGitHubContext, setLatestGitHubContext] = useState<LatestGitHubContext | null>(null)
  const [latestRepoFileContext, setLatestRepoFileContext] = useState<LatestRepoFileContext | null>(null)
  const [latestRepoChangesContext, setLatestRepoChangesContext] = useState<LatestRepoChangesContext | null>(null)
  const [latestTerminalContext, setLatestTerminalContext] = useState<LatestTerminalContext | null>(null)
  const [latestBrowserSnapshot, setLatestBrowserSnapshot] = useState<BrowserSnapshot | null>(null)
  const [latestBrowserInspection, setLatestBrowserInspection] = useState<BrowserElementInspection | null>(null)
  const [latestBrowserScreenshot, setLatestBrowserScreenshot] = useState<LatestBrowserScreenshotContext | null>(null)
  const [renameTarget, setRenameTarget] = useState<{ threadId: string; title: string } | null>(null)
  const [renameInput, setRenameInput] = useState('')
  const [renameError, setRenameError] = useState<string | null>(null)
  const [confirmation, setConfirmation] = useState<CommandConfirmation | null>(null)
  const [confirmationBusy, setConfirmationBusy] = useState(false)
  const [confirmationError, setConfirmationError] = useState<string | null>(null)
  const trimmedQuery = query.trim()

  useEffect(() => {
    if (!open) setLiveActiveThread(null)
  }, [open])

  useEffect(() => {
    const onActiveRailFile = (event: Event) => {
      setSelectedRightRailFile(rightRailActiveFileFromEvent(event))
    }
    window.addEventListener(RIGHT_RAIL_ACTIVE_FILE_EVENT, onActiveRailFile)
    return () => window.removeEventListener(RIGHT_RAIL_ACTIVE_FILE_EVENT, onActiveRailFile)
  }, [])
  useEffect(() => {
    const onRepoFileContextCaptured = (event: Event) => {
      const context = repoFileContextFromEvent(event)
      if (context) setLatestRepoFileContext(context)
    }
    window.addEventListener(REPO_FILE_CONTEXT_CAPTURED_EVENT, onRepoFileContextCaptured)
    return () => window.removeEventListener(REPO_FILE_CONTEXT_CAPTURED_EVENT, onRepoFileContextCaptured)
  }, [])
  useEffect(() => {
    const onProcessContextCaptured = (event: Event) => {
      const processInfo = processContextFromEvent(event)
      if (processInfo) setLatestProcessContext(processInfo)
    }
    window.addEventListener(PROCESS_CONTEXT_CAPTURED_EVENT, onProcessContextCaptured)
    return () => window.removeEventListener(PROCESS_CONTEXT_CAPTURED_EVENT, onProcessContextCaptured)
  }, [])
  useEffect(() => {
    const onToolEventContextCaptured = (event: Event) => {
      const toolEvent = toolEventContextFromEvent(event)
      if (toolEvent) setLatestToolEventContext(toolEvent)
    }
    window.addEventListener(TOOL_EVENT_CONTEXT_CAPTURED_EVENT, onToolEventContextCaptured)
    return () => window.removeEventListener(TOOL_EVENT_CONTEXT_CAPTURED_EVENT, onToolEventContextCaptured)
  }, [])
  useEffect(() => {
    const onSessionContextCaptured = (event: Event) => {
      const context = sessionContextFromEvent(event)
      if (context) setLatestSessionContext(context)
    }
    window.addEventListener(SESSION_CONTEXT_CAPTURED_EVENT, onSessionContextCaptured)
    return () => window.removeEventListener(SESSION_CONTEXT_CAPTURED_EVENT, onSessionContextCaptured)
  }, [])
  useEffect(() => {
    const onCodexResourceContextCaptured = (event: Event) => {
      const context = codexResourceContextFromEvent(event)
      if (context) setLatestCodexResourceContext(context)
    }
    window.addEventListener(CODEX_RESOURCE_CONTEXT_CAPTURED_EVENT, onCodexResourceContextCaptured)
    return () => window.removeEventListener(CODEX_RESOURCE_CONTEXT_CAPTURED_EVENT, onCodexResourceContextCaptured)
  }, [])
  useEffect(() => {
    const onAppContextCaptured = (event: Event) => {
      const context = appContextFromEvent(event)
      if (context) setLatestAppContext(context)
    }
    window.addEventListener(APP_CONTEXT_CAPTURED_EVENT, onAppContextCaptured)
    return () => window.removeEventListener(APP_CONTEXT_CAPTURED_EVENT, onAppContextCaptured)
  }, [])
  useEffect(() => {
    const onGitHubContextCaptured = (event: Event) => {
      const context = githubContextFromEvent(event)
      if (context) setLatestGitHubContext(context)
    }
    window.addEventListener(GITHUB_CONTEXT_CAPTURED_EVENT, onGitHubContextCaptured)
    return () => window.removeEventListener(GITHUB_CONTEXT_CAPTURED_EVENT, onGitHubContextCaptured)
  }, [])
  useEffect(() => {
    const onBrowserSnapshotContextCaptured = (event: Event) => {
      const snapshot = browserSnapshotContextFromEvent(event)
      if (snapshot) setLatestBrowserSnapshot(snapshot)
    }
    window.addEventListener(BROWSER_SNAPSHOT_CONTEXT_CAPTURED_EVENT, onBrowserSnapshotContextCaptured)
    return () => window.removeEventListener(BROWSER_SNAPSHOT_CONTEXT_CAPTURED_EVENT, onBrowserSnapshotContextCaptured)
  }, [])
  useEffect(() => {
    const onBrowserScreenshotContextCaptured = (event: Event) => {
      const context = browserScreenshotContextFromEvent(event)
      if (context) setLatestBrowserScreenshot(context)
    }
    window.addEventListener(BROWSER_SCREENSHOT_CONTEXT_CAPTURED_EVENT, onBrowserScreenshotContextCaptured)
    return () => window.removeEventListener(BROWSER_SCREENSHOT_CONTEXT_CAPTURED_EVENT, onBrowserScreenshotContextCaptured)
  }, [])
  useEffect(() => {
    return window.cranberri.browser.onEvent((event) => {
      if (event.type === 'inspection') setLatestBrowserInspection(event.inspection)
    })
  }, [])
  const pinnedRecords = useMemo(() => (
    activeRepo ? pinnedSessionRecords(appState, activeRepo.path) : []
  ), [activeRepo, appState])
  const pinnedSessionIds = useMemo(() => (
    activeRepo ? pinnedIdsFromState(appState, activeRepo.path) : []
  ), [activeRepo, appState])
  const pinnedSessionCacheKey = useMemo(() => (
    pinnedRecords.map((record) => `${record.id}:${record.archived ? 'archived' : 'recent'}`).join('|')
  ), [pinnedRecords])
  const sessionsQuery = useQuery({
    queryKey: ['command-palette', 'sessions', activeRepo?.path, trimmedQuery, pinnedSessionCacheKey],
    queryFn: async () => {
      if (!activeRepo) return []
      const searchTerm = trimmedQuery.length >= 2 ? trimmedQuery : null
      const [recentResult, archivedResult, broadRecentResult, broadArchivedResult] = await Promise.all([
        window.cranberri.codex.listThreads(activeRepo.path, { archived: false, limit: searchTerm ? 20 : 10, searchTerm }),
        window.cranberri.codex.listThreads(activeRepo.path, { archived: true, limit: searchTerm ? 20 : 5, searchTerm }),
        searchTerm ? window.cranberri.codex.listThreads(activeRepo.path, { archived: false, limit: 30 }) : Promise.resolve(null),
        searchTerm ? window.cranberri.codex.listThreads(activeRepo.path, { archived: true, limit: 20 }) : Promise.resolve(null),
      ])
      const baseItems: SessionSearchResult[] = [
        ...recentResult.sessions.map((session) => ({ session: compactSessionSummary(session), repoPath: activeRepo.path, archived: false })),
        ...archivedResult.sessions.map((session) => ({ session: compactSessionSummary(session), repoPath: activeRepo.path, archived: true })),
      ]
      const listedIds = new Set(baseItems.map((item) => item.session.id))
      const pinnedItems = await Promise.all(pinnedSessionIds
        .filter((id) => !listedIds.has(id))
        .map(async (id): Promise<SessionSearchResult | null> => {
          const record = pinnedRecords.find((item) => item.id === id)
          const primaryArchived = record?.archived ?? false
          const fallbackArchived = !primaryArchived
          try {
            const { thread } = await window.cranberri.codex.readThread(activeRepo.path, id, primaryArchived)
            return { session: codexThreadSummary(thread), repoPath: activeRepo.path, archived: thread.archived, thread }
          } catch {
            try {
              const { thread } = await window.cranberri.codex.readThread(activeRepo.path, id, fallbackArchived)
              return { session: codexThreadSummary(thread), repoPath: activeRepo.path, archived: thread.archived, thread }
            } catch {
              return null
            }
          }
        }))
      const sessionItems = [
        ...pinnedItems.filter((item): item is SessionSearchResult => Boolean(item)),
        ...baseItems,
      ]
      if (!searchTerm) return sessionItems

      const byId = new Map<string, SessionSearchResult>()
      for (const item of [
        ...sessionItems,
        ...(broadRecentResult?.sessions ?? []).map((session) => ({ session: compactSessionSummary(session), repoPath: activeRepo.path, archived: false })),
        ...(broadArchivedResult?.sessions ?? []).map((session) => ({ session: compactSessionSummary(session), repoPath: activeRepo.path, archived: true })),
      ]) {
        byId.set(`${item.archived ? 'archived' : 'recent'}:${item.session.id}`, item)
      }

      const hydrated = await Promise.all([...byId.values()].slice(0, 50).map(async (item): Promise<SessionSearchResult | null> => {
        const summaryMatched = sessionThreadMatchesSummary(item.session, searchTerm)
        try {
          const { thread } = await window.cranberri.codex.readThread(item.repoPath, item.session.id, item.archived)
          const transcriptMatches = searchSessionTranscript(thread, searchTerm)
          if (!summaryMatched && transcriptMatches.length === 0) return null
          return { ...item, thread, transcriptMatches }
        } catch {
          return summaryMatched ? item : null
        }
      }))

      return hydrated.filter((item): item is SessionSearchResult => Boolean(item))
    },
    enabled: open && Boolean(activeRepo),
    staleTime: 10000,
  })
  const sessions = useMemo(() => sessionsQuery.data ?? [], [sessionsQuery.data])
  const processesQuery = useQuery({
    queryKey: ['command-palette', 'processes', activeRepo?.path],
    queryFn: async () => {
      if (!activeRepo) return []
      const result = await window.cranberri.processes.list(activeRepo.path)
      return result.processes
    },
    enabled: open && Boolean(activeRepo),
    staleTime: 3000,
    refetchInterval: open ? 3000 : false,
  })
  const processes = useMemo(() => processesQuery.data ?? [], [processesQuery.data])
  const gitStatusQuery = useQuery({
    queryKey: ['command-palette', 'git-status', activeRepo?.path],
    queryFn: async () => {
      if (!activeRepo) return []
      return window.cranberri.git.status(activeRepo.path)
    },
    enabled: open && Boolean(activeRepo),
    staleTime: 3000,
    refetchInterval: open ? 3000 : false,
  })
  const changedFileCount = gitStatusQuery.data?.length ?? null
  const pluginsQuery = useQuery({
    queryKey: ['command-palette', 'plugins'],
    queryFn: async () => (await window.cranberri.codex.plugins()).plugins,
    enabled: open,
    staleTime: 15000,
  })
  const plugins = useMemo(() => pluginsQuery.data ?? [], [pluginsQuery.data])
  const skillsQuery = useQuery({
    queryKey: ['command-palette', 'skills'],
    queryFn: async () => (await window.cranberri.codex.skills()).skills,
    enabled: open,
    staleTime: 15000,
  })
  const skills = useMemo(() => skillsQuery.data ?? [], [skillsQuery.data])
  const registryQuery = useQuery({
    queryKey: ['command-palette', 'tools', 'registry', activeThread?.id ?? null],
    queryFn: async () => window.cranberri.tools.registry(activeThread?.id ?? null, false),
    enabled: open,
    staleTime: 10000,
  })
  const registry = registryQuery.data ?? null
  const toolEventsQuery = useRecentToolEvents(80, open)
  const toolEvents = useMemo(() => toolEventsQuery.data ?? [], [toolEventsQuery.data])
  const repoFileSearchQuery = useQuery({
    queryKey: ['command-palette', 'repo-file-search', activeRepo?.path, trimmedQuery],
    queryFn: async () => {
      if (!activeRepo || trimmedQuery.length < 2) return []
      const result = await window.cranberri.search.files(activeRepo.path, {
        query: trimmedQuery,
        maxResults: 8,
        globs: ['!package-lock.json'],
      })
      return result.matches
    },
    enabled: open && Boolean(activeRepo) && trimmedQuery.length >= 2,
    staleTime: 5000,
  })
  const repoContentSearchQuery = useQuery({
    queryKey: ['command-palette', 'repo-content-search', activeRepo?.path, trimmedQuery],
    queryFn: async () => {
      if (!activeRepo || trimmedQuery.length < 2) return []
      const result = await window.cranberri.search.repo(activeRepo.path, {
        query: trimmedQuery,
        maxResults: 6,
        globs: ['!package-lock.json'],
      })
      return result.matches
    },
    enabled: open && Boolean(activeRepo) && trimmedQuery.length >= 2,
    staleTime: 5000,
  })
  const githubItemPanelsQuery = useQuery({
    queryKey: ['command-palette', 'github-item-panels', activeRepo?.path],
    queryFn: async () => {
      if (!activeRepo) return []
      const summary = await window.cranberri.git.githubSummary(activeRepo.path)
      if (!summary.isGitHub || !summary.webUrl) return []
      const panels = await Promise.all(COMMAND_GITHUB_ITEM_KINDS.map(async (kind) => {
        try {
          return await window.cranberri.github.panelData(activeRepo.path, kind)
        } catch {
          return null
        }
      }))
      return panels.filter((panel): panel is GitHubPanelData => Boolean(panel))
    },
    enabled: open && Boolean(activeRepo),
    staleTime: 10000,
  })

  const sendActiveWindowContext = useCallback(async (windowId: string, kind: ActiveWindowContextKind) => {
    if (kind === 'terminal-buffer') {
      const terminalId = `terminal-${windowId}`
      const snapshot = await window.cranberri.terminal.snapshot(terminalId)
      const terminalContext = {
        terminalId,
        repoPath: activeRepo?.path ?? null,
        text: snapshot.buffer,
      }
      setLatestTerminalContext(terminalContext)
      window.dispatchEvent(createSendChatContextEvent({
        text: terminalBufferChatContext(terminalContext),
      }))
      return
    }

    if (kind === 'browser-page') {
      const snapshot = await window.cranberri.browser.snapshot(windowId)
      setLatestBrowserSnapshot(snapshot)
      window.dispatchEvent(createBrowserSnapshotContextCapturedEvent(snapshot))
      window.dispatchEvent(createSendChatContextEvent({ text: browserSnapshotChatContext(snapshot) }))
      return
    }

    if (kind === 'browser-inspection') {
      const inspection = latestBrowserInspection?.windowId === windowId
        ? latestBrowserInspection
        : await window.cranberri.browser.inspectElement(windowId)
      setLatestBrowserInspection(inspection)
      window.dispatchEvent(createSendChatContextEvent({ text: browserInspectionChatContext(inspection) }))
      return
    }

    const [screenshot, pageState] = await Promise.all([
      window.cranberri.browser.saveScreenshot(windowId),
      window.cranberri.browser.state(windowId),
    ])
    if (!screenshot.path) throw new Error('Screenshot path was not saved')
    setLatestBrowserScreenshot({
      screenshot,
      pageState: {
        title: pageState.title,
        url: pageState.url,
      },
    })
    window.dispatchEvent(createBrowserScreenshotContextCapturedEvent({
      screenshot,
      pageState: {
        title: pageState.title,
        url: pageState.url,
      },
    }))
    window.dispatchEvent(createSendChatContextEvent({
      text: browserScreenshotChatContext(screenshot, pageState),
      inputParts: [{ type: 'localImage', path: screenshot.path, detail: 'high' }],
    }))
  }, [activeRepo?.path, latestBrowserInspection])

  const copyActiveWindowContext = useCallback(async (windowId: string, kind: ActiveWindowContextKind) => {
    if (kind === 'terminal-buffer') {
      const terminalId = `terminal-${windowId}`
      const snapshot = await window.cranberri.terminal.snapshot(terminalId)
      const terminalContext = {
        terminalId,
        repoPath: activeRepo?.path ?? null,
        text: snapshot.buffer,
      }
      setLatestTerminalContext(terminalContext)
      await navigator.clipboard.writeText(terminalBufferChatContext(terminalContext))
      return
    }

    if (kind === 'browser-page') {
      const snapshot = await window.cranberri.browser.snapshot(windowId)
      setLatestBrowserSnapshot(snapshot)
      window.dispatchEvent(createBrowserSnapshotContextCapturedEvent(snapshot))
      await navigator.clipboard.writeText(browserSnapshotChatContext(snapshot))
      return
    }

    if (kind === 'browser-inspection') {
      const inspection = latestBrowserInspection?.windowId === windowId
        ? latestBrowserInspection
        : await window.cranberri.browser.inspectElement(windowId)
      setLatestBrowserInspection(inspection)
      await navigator.clipboard.writeText(browserInspectionChatContext(inspection))
      return
    }

    const [screenshot, pageState] = await Promise.all([
      window.cranberri.browser.saveScreenshot(windowId),
      window.cranberri.browser.state(windowId),
    ])
    if (!screenshot.path) throw new Error('Screenshot path was not saved')
    const context = {
      screenshot,
      pageState: {
        title: pageState.title,
        url: pageState.url,
      },
    }
    setLatestBrowserScreenshot(context)
    window.dispatchEvent(createBrowserScreenshotContextCapturedEvent(context))
    await navigator.clipboard.writeText(browserScreenshotChatContext(screenshot, pageState))
  }, [activeRepo?.path, latestBrowserInspection])

  const controlActiveBrowser = useCallback(async (windowId: string, command: ActiveBrowserCommand) => {
    if (command === 'reload') {
      await window.cranberri.browser.reload(windowId)
      return
    }
    if (command === 'back') {
      await window.cranberri.browser.back(windowId)
      return
    }
    if (command === 'forward') {
      await window.cranberri.browser.forward(windowId)
      return
    }
    if (command === 'inspect-start') {
      await window.cranberri.browser.startInspect(windowId)
      return
    }
    if (command === 'inspect-stop') {
      await window.cranberri.browser.stopInspect(windowId)
      return
    }
    if (command === 'open-external') {
      const state = await window.cranberri.browser.state(windowId)
      await window.cranberri.openExternal(state.url)
      return
    }
    if (command === 'copy-url') {
      const state = await window.cranberri.browser.state(windowId)
      await navigator.clipboard.writeText(state.url)
      return
    }
    if (command === 'copy-page-context') {
      const snapshot = await window.cranberri.browser.snapshot(windowId)
      setLatestBrowserSnapshot(snapshot)
      window.dispatchEvent(createBrowserSnapshotContextCapturedEvent(snapshot))
      await navigator.clipboard.writeText(browserSnapshotChatContext(snapshot))
      return
    }
    await window.cranberri.browser.stop(windowId)
  }, [])

  const setActiveBrowserViewport = useCallback((windowId: string, viewportMode: ActiveBrowserViewportMode) => {
    updateBrowserState(windowId, { viewportMode })
  }, [updateBrowserState])

  const controlActiveTerminal = useCallback(async (windowId: string, command: ActiveTerminalCommand) => {
    window.dispatchEvent(createTerminalWindowCommandEvent(windowId, command))
  }, [])

  const sendFileContext = useCallback(async (path: string) => {
    if (!activeRepo) throw new Error('Select a repo first')
    const workingContent = await window.cranberri.git.rawContent(activeRepo.path, path, 'WORKING')
    const context = {
      repoPath: activeRepo.path,
      file: { path, status: 'tracked' as const },
      workingContent,
    }
    setLatestRepoFileContext(context)
    window.dispatchEvent(createSendChatContextEvent({
      text: repoFileChatContext(context),
    }))
  }, [activeRepo])

  const copyFileContext = useCallback(async (path: string) => {
    if (!activeRepo) throw new Error('Select a repo first')
    const workingContent = await window.cranberri.git.rawContent(activeRepo.path, path, 'WORKING')
    const context = {
      repoPath: activeRepo.path,
      file: { path, status: 'tracked' as const },
      workingContent,
    }
    setLatestRepoFileContext(context)
    await navigator.clipboard.writeText(repoFileChatContext(context))
  }, [activeRepo])

  const sendSessionContext = useCallback(async (result: SessionSearchResult) => {
    const thread = result.thread ?? await readSessionThread(result)
    const context = { result: { ...result, thread }, thread }
    setLatestSessionContext(context)
    window.dispatchEvent(createSessionContextCapturedEvent(context))
    window.dispatchEvent(createSendChatContextEvent({
      text: sessionChatContext(thread, result.transcriptMatches ?? []),
    }))
  }, [])

  const copySessionContext = useCallback(async (result: SessionSearchResult) => {
    const thread = result.thread ?? await readSessionThread(result)
    const context = { result: { ...result, thread }, thread }
    setLatestSessionContext(context)
    window.dispatchEvent(createSessionContextCapturedEvent(context))
    await navigator.clipboard.writeText(sessionChatContext(thread, result.transcriptMatches ?? []))
  }, [])

  const sendAppContextToChat = useCallback((context: LatestAppContext) => {
    setLatestAppContext(context)
    window.dispatchEvent(createAppContextCapturedEvent(context))
    window.dispatchEvent(createSendChatContextEvent({ text: context.text }))
  }, [])

  const copyAppContextToClipboard = useCallback(async (context: LatestAppContext) => {
    setLatestAppContext(context)
    window.dispatchEvent(createAppContextCapturedEvent(context))
    await navigator.clipboard.writeText(context.text)
  }, [])

  const sendDiagnosticsContext = useCallback(async () => {
    const report = await window.cranberri.health.diagnostics()
    sendAppContextToChat({
      kind: 'diagnostics',
      label: 'Diagnostics',
      text: diagnosticsChatContext(report),
    })
  }, [sendAppContextToChat])

  const copyDiagnosticsContext = useCallback(async () => {
    const report = await window.cranberri.health.diagnostics()
    await copyAppContextToClipboard({
      kind: 'diagnostics',
      label: 'Diagnostics',
      text: diagnosticsChatContext(report),
    })
  }, [copyAppContextToClipboard])

  const clearDiagnosticsTelemetryFromCommand = useCallback((): false => {
    setConfirmation({
      title: 'Clear diagnostics telemetry',
      description: 'Clear local Cranberri diagnostics events and debug telemetry logs? This only affects local debug history.',
      confirmLabel: 'Clear',
      busyLabel: 'Clearing...',
      successLabel: 'Cleared diagnostics telemetry',
      danger: true,
      onConfirm: async () => {
        await window.cranberri.telemetry.clear()
      },
    })
    setConfirmationError(null)
    return false
  }, [])

  const readDiagnosticsPath = useCallback(async (key: DiagnosticsPathKey) => {
    const report = await window.cranberri.health.diagnostics()
    const row = diagnosticsPathRowByKey(report, key)
    if (!row?.actionable) {
      throw new Error(`${row?.label ?? 'Diagnostics path'} is not available`)
    }
    return row
  }, [])

  const copyDiagnosticsPath = useCallback(async (key: DiagnosticsPathKey) => {
    const row = await readDiagnosticsPath(key)
    await navigator.clipboard.writeText(row.value)
  }, [readDiagnosticsPath])

  const openDiagnosticsPath = useCallback(async (key: DiagnosticsPathKey) => {
    const row = await readDiagnosticsPath(key)
    await window.cranberri.openPath(row.value)
  }, [readDiagnosticsPath])

  const revealDiagnosticsPath = useCallback(async (key: DiagnosticsPathKey) => {
    const row = await readDiagnosticsPath(key)
    await window.cranberri.revealPath(row.value)
  }, [readDiagnosticsPath])

  const openNativeHelperSettings = useCallback(async (target: import('@/shared/nativeHelpers').NativeHelperSettingsTarget) => {
    await window.cranberri.nativeHelpers.openSettings(target)
  }, [])

  const sendUsageContext = useCallback(async () => {
    const [data, accountUsage] = await Promise.all([
      window.cranberri.codex.getRateLimits(),
      window.cranberri.codex.getAccountUsage(),
    ])
    sendAppContextToChat({
      kind: 'usage',
      label: 'Codex usage',
      text: usageChatContext(data, accountUsage),
    })
  }, [sendAppContextToChat])

  const copyUsageContext = useCallback(async () => {
    const [data, accountUsage] = await Promise.all([
      window.cranberri.codex.getRateLimits(),
      window.cranberri.codex.getAccountUsage(),
    ])
    await copyAppContextToClipboard({
      kind: 'usage',
      label: 'Codex usage',
      text: usageChatContext(data, accountUsage),
    })
  }, [copyAppContextToClipboard])

  const sendActiveChatContext = useCallback(() => {
    if (!activeThread) throw new Error('Open a chat first')
    sendAppContextToChat({
      kind: 'active-chat',
      label: activeThread.title || activeThread.id,
      text: activeChatContext(activeThread),
    })
  }, [activeThread, sendAppContextToChat])

  const copyActiveChatContext = useCallback(async () => {
    if (!activeThread) throw new Error('Open a chat first')
    await copyAppContextToClipboard({
      kind: 'active-chat',
      label: activeThread.title || activeThread.id,
      text: activeChatContext(activeThread),
    })
  }, [activeThread, copyAppContextToClipboard])

  const exportActiveThreadMarkdown = useCallback(async () => {
    if (!activeThread) throw new Error('Open a chat first')
    const result = await window.cranberri.exportTextFile({
      defaultPath: activeThreadExportFileName(activeThread),
      content: activeThreadMarkdownExport(activeThread, activeRepo?.path ?? null),
      filters: [
        { name: 'Markdown', extensions: ['md'] },
        { name: 'Text', extensions: ['txt'] },
      ],
    })
    return result.canceled ? false : undefined
  }, [activeRepo?.path, activeThread])

  const copyActiveThreadMarkdown = useCallback(async () => {
    if (!activeThread) throw new Error('Open a chat first')
    await navigator.clipboard.writeText(activeThreadMarkdownExport(activeThread, activeRepo?.path ?? null))
  }, [activeRepo?.path, activeThread])

  const sendLatestAssistantResponseToChat = useCallback((message: CodexMessage) => {
    window.dispatchEvent(createSendChatContextEvent({ text: assistantResponseChatContext(message.content) }))
  }, [])

  const copyLatestAssistantResponse = useCallback(async (message: CodexMessage) => {
    await navigator.clipboard.writeText(message.content)
  }, [])

  const sendLatestUserPromptToChat = useCallback((message: CodexMessage) => {
    window.dispatchEvent(createSendChatContextEvent({ text: userPromptChatContext(message.content) }))
  }, [])

  const copyLatestUserPrompt = useCallback(async (message: CodexMessage) => {
    await navigator.clipboard.writeText(message.content)
  }, [])

  const sendLatestTerminalContextToChat = useCallback((context: LatestTerminalContext) => {
    if (!activeThread) throw new Error('Open a chat first')
    window.dispatchEvent(createSendChatContextEvent({ text: terminalBufferChatContext(context) }))
  }, [activeThread])

  const copyLatestTerminalContext = useCallback(async (context: LatestTerminalContext) => {
    await navigator.clipboard.writeText(terminalBufferChatContext(context))
  }, [])

  const sendLatestRepoChangesContextToChat = useCallback((context: LatestRepoChangesContext) => {
    if (!activeThread) throw new Error('Open a chat first')
    window.dispatchEvent(createSendChatContextEvent({ text: repoChangesChatContext(context) }))
  }, [activeThread])

  const copyLatestRepoChangesContext = useCallback(async (context: LatestRepoChangesContext) => {
    await navigator.clipboard.writeText(repoChangesChatContext(context))
  }, [])

  const sendLatestRepoFileContextToChat = useCallback((context: LatestRepoFileContext) => {
    if (!activeThread) throw new Error('Open a chat first')
    window.dispatchEvent(createSendChatContextEvent({ text: repoFileChatContext(context) }))
  }, [activeThread])

  const copyLatestRepoFileContext = useCallback(async (context: LatestRepoFileContext) => {
    await navigator.clipboard.writeText(repoFileChatContext(context))
  }, [])

  const sendProcessContext = useCallback((processInfo: AgentProcessInfo) => {
    setLatestProcessContext(processInfo)
    window.dispatchEvent(createProcessContextCapturedEvent(processInfo))
    window.dispatchEvent(createSendChatContextEvent({ text: processChatContext(processInfo) }))
  }, [])

  const sendLatestProcessContextToChat = useCallback((processInfo: AgentProcessInfo) => {
    if (!activeThread) throw new Error('Open a chat first')
    window.dispatchEvent(createSendChatContextEvent({ text: processChatContext(processInfo) }))
  }, [activeThread])

  const copyLatestProcessContext = useCallback(async (processInfo: AgentProcessInfo) => {
    await navigator.clipboard.writeText(processChatContext(processInfo))
  }, [])

  const sendToolEventContext = useCallback((event: ToolEventRecord) => {
    setLatestToolEventContext(event)
    window.dispatchEvent(createToolEventContextCapturedEvent(event))
    window.dispatchEvent(createSendChatContextEvent({ text: toolEventChatContext(event) }))
  }, [])

  const sendLatestToolEventContextToChat = useCallback((event: ToolEventRecord) => {
    if (!activeThread) throw new Error('Open a chat first')
    window.dispatchEvent(createSendChatContextEvent({ text: toolEventChatContext(event) }))
  }, [activeThread])

  const copyLatestToolEventContext = useCallback(async (event: ToolEventRecord) => {
    await navigator.clipboard.writeText(toolEventChatContext(event))
  }, [])

  const sendLatestSessionContextToChat = useCallback((context: LatestSessionContext) => {
    if (!activeThread) throw new Error('Open a chat first')
    window.dispatchEvent(createSendChatContextEvent({
      text: sessionChatContext(context.thread, context.result.transcriptMatches ?? []),
    }))
  }, [activeThread])

  const copyLatestSessionContext = useCallback(async (context: LatestSessionContext) => {
    await navigator.clipboard.writeText(sessionChatContext(context.thread, context.result.transcriptMatches ?? []))
  }, [])

  const sendCodexResourceContext = useCallback((context: LatestCodexResourceContext) => {
    setLatestCodexResourceContext(context)
    window.dispatchEvent(createCodexResourceContextCapturedEvent(context))
    window.dispatchEvent(createSendChatContextEvent({
      text: context.text,
      inputParts: context.inputParts,
    }))
  }, [])

  const copyCodexResourceContext = useCallback(async (context: LatestCodexResourceContext) => {
    setLatestCodexResourceContext(context)
    window.dispatchEvent(createCodexResourceContextCapturedEvent(context))
    await navigator.clipboard.writeText(context.text)
  }, [])

  const sendLatestCodexResourceContextToChat = useCallback((context: LatestCodexResourceContext) => {
    if (!activeThread) throw new Error('Open a chat first')
    window.dispatchEvent(createSendChatContextEvent({
      text: context.text,
      inputParts: context.inputParts,
    }))
  }, [activeThread])

  const copyLatestCodexResourceContext = useCallback(async (context: LatestCodexResourceContext) => {
    await navigator.clipboard.writeText(context.text)
  }, [])

  const sendLatestAppContextToChat = useCallback((context: LatestAppContext) => {
    if (!activeThread) throw new Error('Open a chat first')
    window.dispatchEvent(createSendChatContextEvent({ text: context.text }))
  }, [activeThread])

  const copyLatestAppContext = useCallback(async (context: LatestAppContext) => {
    await navigator.clipboard.writeText(context.text)
  }, [])

  const sendGitHubChatContext = useCallback((context: LatestGitHubContext) => {
    setLatestGitHubContext(context)
    window.dispatchEvent(createGitHubContextCapturedEvent(context))
    window.dispatchEvent(createSendChatContextEvent({ text: context.text }))
  }, [])

  const sendLatestGitHubContextToChat = useCallback((context: LatestGitHubContext) => {
    if (!activeThread) throw new Error('Open a chat first')
    window.dispatchEvent(createSendChatContextEvent({ text: context.text }))
  }, [activeThread])

  const copyLatestGitHubContext = useCallback(async (context: LatestGitHubContext) => {
    await navigator.clipboard.writeText(context.text)
  }, [])

  const sendTranscriptMessageToChat = useCallback((message: CodexMessage) => {
    const text = message.role === 'assistant'
      ? assistantResponseChatContext(message.content)
      : userPromptChatContext(message.content)
    window.dispatchEvent(createSendChatContextEvent({ text }))
  }, [])

  const copyTranscriptMessage = useCallback(async (message: CodexMessage) => {
    await navigator.clipboard.writeText(message.content)
  }, [])

  const attachFilesToActiveChat = useCallback(async () => {
    if (!activeThread) throw new Error('Open a chat first')
    const result = await window.cranberri.codex.pickFiles()
    if (result.paths.length === 0) return false
    window.dispatchEvent(createSendChatContextEvent({
      text: '',
      attachmentPaths: result.paths,
    }))
  }, [activeThread])

  const attachRepoFileToActiveChat = useCallback((path: string) => {
    if (!activeRepo) throw new Error('Select a repo first')
    if (!activeThread) throw new Error('Open a chat first')
    window.dispatchEvent(createSendChatContextEvent({
      text: '',
      attachmentPaths: [repoAbsolutePath(activeRepo.path, path)],
    }))
  }, [activeRepo, activeThread])

  const openSelectedFileExternal = useCallback(async (path: string) => {
    if (!activeRepo) throw new Error('Select a repo first')
    await window.cranberri.openPath(repoAbsolutePath(activeRepo.path, path))
  }, [activeRepo])

  const revealSelectedFileInFolder = useCallback(async (path: string) => {
    if (!activeRepo) throw new Error('Select a repo first')
    await window.cranberri.revealPath(repoAbsolutePath(activeRepo.path, path))
  }, [activeRepo])

  const copySelectedFileAbsolutePath = useCallback(async (path: string) => {
    if (!activeRepo) throw new Error('Select a repo first')
    await navigator.clipboard.writeText(repoAbsolutePath(activeRepo.path, path))
  }, [activeRepo])

  const openLatestBrowserScreenshot = useCallback(async (path: string) => {
    await window.cranberri.openPath(path)
  }, [])

  const revealLatestBrowserScreenshot = useCallback(async (path: string) => {
    await window.cranberri.revealPath(path)
  }, [])

  const copyLatestBrowserScreenshotPath = useCallback(async (path: string) => {
    await navigator.clipboard.writeText(path)
  }, [])

  const sendLatestBrowserSnapshotToChat = useCallback((snapshot: BrowserSnapshot) => {
    if (!activeThread) throw new Error('Open a chat first')
    window.dispatchEvent(createSendChatContextEvent({ text: browserSnapshotChatContext(snapshot) }))
  }, [activeThread])

  const copyLatestBrowserSnapshot = useCallback(async (snapshot: BrowserSnapshot) => {
    await navigator.clipboard.writeText(browserSnapshotChatContext(snapshot))
  }, [])

  const sendLatestBrowserInspectionToChat = useCallback((inspection: BrowserElementInspection) => {
    if (!activeThread) throw new Error('Open a chat first')
    window.dispatchEvent(createSendChatContextEvent({ text: browserInspectionChatContext(inspection) }))
  }, [activeThread])

  const copyLatestBrowserInspection = useCallback(async (inspection: BrowserElementInspection) => {
    await navigator.clipboard.writeText(browserInspectionChatContext(inspection))
  }, [])

  const sendLatestBrowserScreenshotToChat = useCallback((capture: LatestBrowserScreenshotContext) => {
    if (!activeThread) throw new Error('Open a chat first')
    const path = capture.screenshot.path
    if (!path) throw new Error('Screenshot path was not saved')
    window.dispatchEvent(createSendChatContextEvent({
      text: browserScreenshotChatContext(capture.screenshot, capture.pageState),
      inputParts: [{ type: 'localImage', path, detail: 'high' }],
    }))
  }, [activeThread])

  const sendToolRegistryContext = useCallback(async () => {
    const snapshot = await window.cranberri.tools.registry(activeThread?.id ?? null, true)
    sendCodexResourceContext({
      kind: 'tool-registry',
      label: 'Codex tool registry',
      text: toolRegistryChatContext(snapshot),
    })
  }, [activeThread?.id, sendCodexResourceContext])

  const copyToolRegistryContext = useCallback(async () => {
    const snapshot = await window.cranberri.tools.registry(activeThread?.id ?? null, true)
    await copyCodexResourceContext({
      kind: 'tool-registry',
      label: 'Codex tool registry',
      text: toolRegistryChatContext(snapshot),
    })
  }, [activeThread?.id, copyCodexResourceContext])

  const renameSessionFromCommand = useCallback((threadId: string, title: string): false => {
    setRenameTarget({ threadId, title })
    setRenameInput(title)
    setRenameError(null)
    return false
  }, [])

  const submitRenameSession = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!renameTarget) return
    const nextName = renameInput.trim()
    if (!nextName) {
      setRenameError('Enter a session name')
      return
    }
    if (nextName === renameTarget.title) {
      setRenameTarget(null)
      setRenameError(null)
      return
    }
    try {
      await renameSession(renameTarget.threadId, nextName)
      setRenameTarget(null)
      setRenameError(null)
      toast.success('Renamed session')
    } catch (error) {
      setRenameError(error instanceof Error ? error.message : 'Failed to rename session')
    }
  }, [renameInput, renameSession, renameTarget])

  const deleteSessionFromCommand = useCallback((threadId: string, title: string): false => {
    setConfirmation({
      title: 'Delete session',
      description: `Delete Codex session "${title}"? This cannot be undone.`,
      confirmLabel: 'Delete',
      busyLabel: 'Deleting...',
      successLabel: 'Deleted session',
      danger: true,
      onConfirm: async () => {
        await deleteSession(threadId)
        if (activeRepo) updateAppState((current) => removePinnedSessions(current, activeRepo.path, [threadId]))
      },
    })
    setConfirmationError(null)
    return false
  }, [activeRepo, deleteSession, updateAppState])

  const toggleSessionPinnedFromCommand = useCallback((session: CodexSessionSummary) => {
    if (!activeRepo) throw new Error('Select a repo first')
    updateAppState((current) => togglePinnedSession(current, activeRepo.path, session))
  }, [activeRepo, updateAppState])

  const refreshPluginQueries = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['codex', 'plugins'] }),
      queryClient.invalidateQueries({ queryKey: ['codex', 'skills'] }),
      queryClient.invalidateQueries({ queryKey: ['tools', 'registry'] }),
      queryClient.invalidateQueries({ queryKey: ['command-palette', 'plugins'] }),
    ])
  }, [queryClient])

  const installPluginFromCommand = useCallback((plugin: (typeof plugins)[number]): false => {
    setConfirmation({
      title: 'Install plugin',
      description: `Install Codex plugin "${plugin.displayName}" from ${plugin.marketplaceName ?? 'the configured marketplace'}?`,
      confirmLabel: 'Install',
      busyLabel: 'Installing...',
      successLabel: 'Installed plugin',
      onConfirm: async () => {
        await window.cranberri.codex.installPlugin(plugin.id)
        await refreshPluginQueries()
      },
    })
    setConfirmationError(null)
    return false
  }, [refreshPluginQueries])

  const submitConfirmation = useCallback(async () => {
    if (!confirmation || confirmationBusy) return
    setConfirmationBusy(true)
    setConfirmationError(null)
    try {
      await confirmation.onConfirm()
      if (confirmation.successLabel) toast.success(confirmation.successLabel)
      setConfirmation(null)
    } catch (error) {
      setConfirmationError(error instanceof Error ? error.message : 'Action failed')
    } finally {
      setConfirmationBusy(false)
    }
  }, [confirmation, confirmationBusy])

  const upgradePluginMarketplaces = useCallback(async () => {
    await window.cranberri.codex.upgradePluginMarketplaces()
    await refreshPluginQueries()
  }, [refreshPluginQueries])

  const sendRepoChangesContext = useCallback(async (kind: RepoChangesContextKind) => {
    if (!activeRepo) throw new Error('Select a repo first')
    const [status, diff] = await Promise.all([
      window.cranberri.git.status(activeRepo.path),
      kind === 'diff' ? window.cranberri.git.diff(activeRepo.path) : Promise.resolve(null),
    ])
    const context = {
      kind,
      repoPath: activeRepo.path,
      status,
      diff,
    }
    setLatestRepoChangesContext(context)
    window.dispatchEvent(createSendChatContextEvent({
      text: repoChangesChatContext(context),
    }))
  }, [activeRepo])

  const copyRepoChangesContext = useCallback(async (kind: RepoChangesContextKind) => {
    if (!activeRepo) throw new Error('Select a repo first')
    const [status, diff] = await Promise.all([
      window.cranberri.git.status(activeRepo.path),
      kind === 'diff' ? window.cranberri.git.diff(activeRepo.path) : Promise.resolve(null),
    ])
    const context = {
      kind,
      repoPath: activeRepo.path,
      status,
      diff,
    }
    setLatestRepoChangesContext(context)
    await navigator.clipboard.writeText(repoChangesChatContext(context))
  }, [activeRepo])

  const reviewRepoChangesContext = useCallback(async () => {
    if (!activeRepo) throw new Error('Select a repo first')
    if (!activeThread) throw new Error('Open a chat first')
    const [status, diff] = await Promise.all([
      window.cranberri.git.status(activeRepo.path),
      window.cranberri.git.diff(activeRepo.path),
    ])
    const context = {
      kind: 'diff' as const,
      repoPath: activeRepo.path,
      status,
      diff,
    }
    setLatestRepoChangesContext(context)
    window.dispatchEvent(createSendChatContextEvent({
      text: repoChangesReviewChatContext(context),
    }))
  }, [activeRepo, activeThread])

  const explainRepoChangesContext = useCallback(async () => {
    if (!activeRepo) throw new Error('Select a repo first')
    if (!activeThread) throw new Error('Open a chat first')
    const [status, diff] = await Promise.all([
      window.cranberri.git.status(activeRepo.path),
      window.cranberri.git.diff(activeRepo.path),
    ])
    const context = {
      kind: 'diff' as const,
      repoPath: activeRepo.path,
      status,
      diff,
    }
    setLatestRepoChangesContext(context)
    window.dispatchEvent(createSendChatContextEvent({
      text: repoChangesExplanationChatContext(context),
    }))
  }, [activeRepo, activeThread])

  const testRepoChangesContext = useCallback(async () => {
    if (!activeRepo) throw new Error('Select a repo first')
    if (!activeThread) throw new Error('Open a chat first')
    const [status, diff] = await Promise.all([
      window.cranberri.git.status(activeRepo.path),
      window.cranberri.git.diff(activeRepo.path),
    ])
    const context = {
      kind: 'diff' as const,
      repoPath: activeRepo.path,
      status,
      diff,
    }
    setLatestRepoChangesContext(context)
    window.dispatchEvent(createSendChatContextEvent({
      text: repoChangesTestPlanChatContext(context),
    }))
  }, [activeRepo, activeThread])

  const draftPullRequestContext = useCallback(async () => {
    if (!activeRepo) throw new Error('Select a repo first')
    if (!activeThread) throw new Error('Open a chat first')
    const [status, diff] = await Promise.all([
      window.cranberri.git.status(activeRepo.path),
      window.cranberri.git.diff(activeRepo.path),
    ])
    const context = {
      kind: 'diff' as const,
      repoPath: activeRepo.path,
      status,
      diff,
    }
    setLatestRepoChangesContext(context)
    window.dispatchEvent(createSendChatContextEvent({
      text: repoChangesPullRequestChatContext(context),
    }))
  }, [activeRepo, activeThread])

  const sendWorkspaceBrief = useCallback(async () => {
    if (!activeRepo) throw new Error('Select a repo first')
    const [status, githubSummary] = await Promise.all([
      window.cranberri.git.status(activeRepo.path),
      window.cranberri.git.githubSummary(activeRepo.path).catch(() => null),
    ])
    sendAppContextToChat({
      kind: 'workspace-brief',
      label: activeRepo.name,
      text: workspaceBriefChatContext({
        repo: activeRepo,
        windows,
        activeWindowId,
        activeThread,
        selectedRightRailFile,
        status,
        githubSummary,
        processes,
      }),
    })
  }, [activeRepo, activeThread, activeWindowId, processes, selectedRightRailFile, sendAppContextToChat, windows])

  const copyWorkspaceBrief = useCallback(async () => {
    if (!activeRepo) throw new Error('Select a repo first')
    const [status, githubSummary] = await Promise.all([
      window.cranberri.git.status(activeRepo.path),
      window.cranberri.git.githubSummary(activeRepo.path).catch(() => null),
    ])
    await copyAppContextToClipboard({
      kind: 'workspace-brief',
      label: activeRepo.name,
      text: workspaceBriefChatContext({
        repo: activeRepo,
        windows,
        activeWindowId,
        activeThread,
        selectedRightRailFile,
        status,
        githubSummary,
        processes,
      }),
    })
  }, [activeRepo, activeThread, activeWindowId, copyAppContextToClipboard, processes, selectedRightRailFile, windows])

  const sendGitHubContext = useCallback(async (kind: GitHubContextKind) => {
    if (!activeRepo) throw new Error('Select a repo first')
    const summary = await window.cranberri.git.githubSummary(activeRepo.path)
    if (!summary.isGitHub || !summary.webUrl) throw new Error('No GitHub remote detected for this repo')
    const data = kind === 'repo'
      ? null
      : await window.cranberri.github.panelData(activeRepo.path, kind as GitHubPanelKind)
    sendGitHubChatContext({
      kind: 'panel',
      label: data?.kind ?? 'repo',
      repoPath: activeRepo.path,
      text: githubPanelChatContext({
        repoPath: activeRepo.path,
        summary,
        data,
      }),
    })
  }, [activeRepo, sendGitHubChatContext])

  const copyGitHubContext = useCallback(async (kind: GitHubContextKind) => {
    if (!activeRepo) throw new Error('Select a repo first')
    const summary = await window.cranberri.git.githubSummary(activeRepo.path)
    if (!summary.isGitHub || !summary.webUrl) throw new Error('No GitHub remote detected for this repo')
    const data = kind === 'repo'
      ? null
      : await window.cranberri.github.panelData(activeRepo.path, kind as GitHubPanelKind)
    const context = {
      kind: 'panel' as const,
      label: data?.kind ?? 'repo',
      repoPath: activeRepo.path,
      text: githubPanelChatContext({
        repoPath: activeRepo.path,
        summary,
        data,
      }),
    }
    setLatestGitHubContext(context)
    window.dispatchEvent(createGitHubContextCapturedEvent(context))
    await navigator.clipboard.writeText(context.text)
  }, [activeRepo])

  const sendGitHubItemContext = useCallback(async (kind: GitHubPanelKind, item: GitHubPanelItem) => {
    if (!activeRepo) throw new Error('Select a repo first')
    const summary = await window.cranberri.git.githubSummary(activeRepo.path)
    if (!summary.isGitHub || !summary.webUrl) throw new Error('No GitHub remote detected for this repo')
    sendGitHubChatContext({
      kind: 'item',
      label: item.title,
      repoPath: activeRepo.path,
      text: githubItemChatContext({
        repoPath: activeRepo.path,
        summary,
        kind,
        item,
      }),
    })
  }, [activeRepo, sendGitHubChatContext])

  const copyGitHubItemContext = useCallback(async (kind: GitHubPanelKind, item: GitHubPanelItem) => {
    if (!activeRepo) throw new Error('Select a repo first')
    const summary = await window.cranberri.git.githubSummary(activeRepo.path)
    if (!summary.isGitHub || !summary.webUrl) throw new Error('No GitHub remote detected for this repo')
    const context = {
      kind: 'item' as const,
      label: item.title,
      repoPath: activeRepo.path,
      text: githubItemChatContext({
        repoPath: activeRepo.path,
        summary,
        kind,
        item,
      }),
    }
    setLatestGitHubContext(context)
    window.dispatchEvent(createGitHubContextCapturedEvent(context))
    await navigator.clipboard.writeText(context.text)
  }, [activeRepo])

  const actions = useMemo(() => buildAppActions({
    repos,
    activeRepoId,
    windows,
    activeWindowId,
    activeThread,
    sessions,
    selectedRightRailFile,
    changedFileCount,
    latestTerminalContext,
    latestBrowserSnapshot,
    latestBrowserScreenshot,
    processes,
    plugins,
    skills,
    registry,
    toolEvents,
    activeSessionIds: openThreadIds,
    pinnedSessionIds,
    latestProcessContext,
    latestToolEventContext,
    latestSessionContext,
    latestCodexResourceContext,
    latestAppContext,
    latestGitHubContext,
    latestRepoFileContext,
    latestRepoChangesContext,
    latestBrowserInspection,
    openChat,
    openTerminal,
    openBrowser,
    openSettings: onOpenSettings,
    openSession: openCodexSession,
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
    sendLatestSessionContextToChat,
    copyLatestSessionContext,
    sendLatestCodexResourceContextToChat,
    copyLatestCodexResourceContext,
    sendLatestAppContextToChat,
    copyLatestAppContext,
    sendLatestGitHubContextToChat,
    copyLatestGitHubContext,
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
    sendDiagnosticsContext,
    copyDiagnosticsContext,
    clearDiagnosticsTelemetry: clearDiagnosticsTelemetryFromCommand,
    copyDiagnosticsPath,
    openDiagnosticsPath,
    revealDiagnosticsPath,
    openNativeHelperSettings,
    sendUsageContext,
    copyUsageContext,
    copyActiveChatContext,
    installPlugin: installPluginFromCommand,
    upgradePluginMarketplaces,
    sendSkillContext: (skill) => {
      sendCodexResourceContext({
        kind: 'skill',
        label: skill.displayName,
        text: skillChatContext(skill),
        inputParts: [{ type: 'skill', name: skill.name, path: skill.path }],
      })
    },
    copySkillContext: (skill) => {
      return copyCodexResourceContext({
        kind: 'skill',
        label: skill.displayName,
        text: skillChatContext(skill),
        inputParts: [{ type: 'skill', name: skill.name, path: skill.path }],
      })
    },
    sendToolRegistryContext,
    copyToolRegistryContext,
    sendAppContext: (app) => {
      sendCodexResourceContext({ kind: 'app', label: app.name, text: appChatContext(app) })
    },
    copyAppContext: (app) => {
      return copyCodexResourceContext({ kind: 'app', label: app.name, text: appChatContext(app) })
    },
    sendMcpServerContext: (server) => {
      sendCodexResourceContext({ kind: 'mcp-server', label: server.name, text: mcpServerChatContext(server) })
    },
    copyMcpServerContext: (server) => {
      return copyCodexResourceContext({ kind: 'mcp-server', label: server.name, text: mcpServerChatContext(server) })
    },
    sendMcpToolContext: (server, tool) => {
      sendCodexResourceContext({ kind: 'mcp-tool', label: tool.title ?? tool.name, text: mcpToolChatContext(server, tool) })
    },
    copyMcpToolContext: (server, tool) => {
      return copyCodexResourceContext({ kind: 'mcp-tool', label: tool.title ?? tool.name, text: mcpToolChatContext(server, tool) })
    },
    sendToolEventContext,
    copyToolEventContext: async (event) => {
      setLatestToolEventContext(event)
      window.dispatchEvent(createToolEventContextCapturedEvent(event))
      await navigator.clipboard.writeText(toolEventChatContext(event))
    },
    sendSessionContext,
    copySessionContext,
    openProcessTerminal: (processInfo) => window.dispatchEvent(createOpenProcessTerminalEvent(processInfo)),
    openProcessBrowser: (processInfo) => window.dispatchEvent(createOpenProcessBrowserEvent(processInfo)),
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
    compactActiveThread: () => {
      if (!activeThread) throw new Error('Open a chat first')
      return compactThread(activeThread.id)
    },
    archiveActiveThread: () => {
      if (!activeThread) throw new Error('Open a chat first')
      return archiveSession(activeThread.id)
    },
    renameActiveThread: () => {
      if (!activeThread) throw new Error('Open a chat first')
      return renameSessionFromCommand(activeThread.id, activeThread.title || 'Untitled session')
    },
    deleteActiveThread: () => {
      if (!activeThread) throw new Error('Open a chat first')
      return deleteSessionFromCommand(activeThread.id, activeThread.title || 'Untitled session')
    },
    toggleSessionPinned: toggleSessionPinnedFromCommand,
    archiveSession,
    unarchiveSession,
    renameSession: renameSessionFromCommand,
    deleteSession: deleteSessionFromCommand,
    interruptActiveThread: () => {
      if (!activeThread) throw new Error('Open a chat first')
      return abort(activeThread.id)
    },
    resolveActiveApproval: (approvalId, action) => {
      if (!activeThread) throw new Error('Open a chat first')
      return approve(activeThread.id, approvalId, action)
    },
    controlActiveTerminal,
    controlActiveBrowser,
    setActiveBrowserViewport,
    openRightRail: (command) => window.dispatchEvent(createOpenRightRailCommandEvent(command)),
    setActiveRepo,
    setActiveWindow,
  }), [abort, activeRepoId, activeThread, activeWindowId, approve, archiveSession, attachFilesToActiveChat, attachRepoFileToActiveChat, changedFileCount, clearDiagnosticsTelemetryFromCommand, compactThread, controlActiveBrowser, controlActiveTerminal, copyActiveChatContext, copyActiveThreadMarkdown, copyActiveWindowContext, copyCodexResourceContext, copyDiagnosticsContext, copyDiagnosticsPath, copyGitHubContext, copyLatestAppContext, copyLatestAssistantResponse, copyLatestBrowserInspection, copyLatestBrowserScreenshotPath, copyLatestBrowserSnapshot, copyLatestCodexResourceContext, copyLatestGitHubContext, copyLatestProcessContext, copyLatestRepoChangesContext, copyLatestRepoFileContext, copyLatestSessionContext, copyLatestTerminalContext, copyLatestToolEventContext, copyLatestUserPrompt, copyRepoChangesContext, copySelectedFileAbsolutePath, copySessionContext, copyToolRegistryContext, copyUsageContext, copyWorkspaceBrief, deleteSessionFromCommand, draftPullRequestContext, explainRepoChangesContext, exportActiveThreadMarkdown, installPluginFromCommand, latestAppContext, latestBrowserInspection, latestBrowserScreenshot, latestBrowserSnapshot, latestCodexResourceContext, latestGitHubContext, latestProcessContext, latestRepoChangesContext, latestRepoFileContext, latestSessionContext, latestTerminalContext, latestToolEventContext, onOpenSettings, openBrowser, openChat, openDiagnosticsPath, openLatestBrowserScreenshot, openNativeHelperSettings, openSelectedFileExternal, openTerminal, openThreadIds, pinnedSessionIds, plugins, processes, registry, renameSessionFromCommand, repos, revealDiagnosticsPath, revealLatestBrowserScreenshot, revealSelectedFileInFolder, reviewRepoChangesContext, selectedRightRailFile, sendActiveChatContext, sendActiveWindowContext, sendCodexResourceContext, sendLatestAppContextToChat, sendLatestAssistantResponseToChat, sendLatestBrowserInspectionToChat, sendLatestBrowserScreenshotToChat, sendLatestBrowserSnapshotToChat, sendLatestCodexResourceContextToChat, sendLatestGitHubContextToChat, sendLatestProcessContextToChat, sendLatestRepoChangesContextToChat, sendLatestRepoFileContextToChat, sendLatestSessionContextToChat, sendLatestTerminalContextToChat, sendLatestToolEventContextToChat, sendLatestUserPromptToChat, sendProcessContext, sendToolEventContext, setActiveBrowserViewport, sendDiagnosticsContext, sendGitHubContext, sendRepoChangesContext, sendSessionContext, sendToolRegistryContext, sendUsageContext, sendWorkspaceBrief, sessions, setActiveRepo, setActiveWindow, skills, testRepoChangesContext, toggleSessionPinnedFromCommand, toolEvents, unarchiveSession, upgradePluginMarketplaces, windows])

  const activeThreadMessageActions = useMemo(() => buildActiveThreadMessageActions({
    activeThread,
    query: trimmedQuery,
    sendMessageContext: sendTranscriptMessageToChat,
    copyMessageText: copyTranscriptMessage,
  }), [activeThread, copyTranscriptMessage, sendTranscriptMessageToChat, trimmedQuery])

  const fileActions = useMemo(() => buildFileSearchActions({
    fileMatches: repoFileSearchQuery.data ?? [],
    contentMatches: repoContentSearchQuery.data ?? [],
    openFile: (path, line) => {
      window.dispatchEvent(createOpenRightRailFileEvent({ path, status: 'tracked' }, line))
    },
    sendFileContext,
    copyFileContext,
    attachFile: attachRepoFileToActiveChat,
  }), [attachRepoFileToActiveChat, copyFileContext, repoContentSearchQuery.data, repoFileSearchQuery.data, sendFileContext])
  const githubItemActions = useMemo(() => buildGitHubItemActions({
    panels: githubItemPanelsQuery.data ?? [],
    sendGitHubItemContext,
    copyGitHubItemContext,
  }), [copyGitHubItemContext, githubItemPanelsQuery.data, sendGitHubItemContext])

  const filteredActions = [
    ...filterAppActions(actions, query),
    ...activeThreadMessageActions,
    ...fileActions,
    ...githubItemActions,
  ]

  const run = (action: AppAction) => {
    if (action.disabledReason) {
      toast.error(action.disabledReason)
      return
    }
    actionQueueRef.current = actionQueueRef.current
      .then(async () => {
        const result = await action.run()
        if (result !== false) toast.success(action.label)
      })
      .catch((error) => {
        toast.error(error instanceof Error ? error.message : `Failed to run ${action.label}`)
      })
    onOpenChange(false)
  }

  const grouped = groupActions(filteredActions)
  const renameDialog = renameTarget ? (
    <div className="fixed inset-0 z-[60] flex items-start justify-center bg-[var(--app-overlay)] px-4 pt-[18vh]" role="presentation">
      <form
        role="dialog"
        aria-label="Rename Codex session"
        className="w-full max-w-[420px] rounded-lg border border-app-border bg-app-surface p-4 shadow-2xl"
        onSubmit={submitRenameSession}
      >
        <div className="text-sm font-semibold text-app-text">Rename session</div>
        <label htmlFor="command-palette-rename-session" className="mt-3 block text-caption font-medium text-app-text-muted">Name</label>
        <input
          id="command-palette-rename-session"
          autoFocus
          className="mt-1 h-9 w-full rounded border border-app-border bg-app-bg px-2 text-sm text-app-text outline-none focus:border-app-accent"
          value={renameInput}
          onChange={(event) => {
            setRenameInput(event.target.value)
            setRenameError(null)
          }}
        />
        {renameError && <div className="mt-2 text-xs text-app-danger">{renameError}</div>}
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            className="h-8 rounded px-3 text-xs font-medium text-app-text-muted hover:bg-app-surface-2 hover:text-app-text"
            onClick={() => {
              setRenameTarget(null)
              setRenameError(null)
            }}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="h-8 rounded bg-app-accent px-3 text-xs font-semibold text-app-accent-contrast hover:bg-app-accent/90"
          >
            Rename
          </button>
        </div>
      </form>
    </div>
  ) : null
  const confirmationDialog = confirmation ? (
    <ConfirmDialog
      title={confirmation.title}
      description={confirmation.description}
      confirmLabel={confirmation.confirmLabel}
      busyLabel={confirmation.busyLabel}
      busy={confirmationBusy}
      danger={confirmation.danger}
      error={confirmationError}
      onCancel={() => {
        if (confirmationBusy) return
        setConfirmation(null)
        setConfirmationError(null)
      }}
      onConfirm={() => {
        void submitConfirmation()
      }}
    />
  ) : null
  const modalDialogs = (
    <>
      {renameDialog}
      {confirmationDialog}
    </>
  )

  if (!open) return modalDialogs

  return (
    <>
      <ActiveThreadSync onThread={setLiveActiveThread} />
      {modalDialogs}
      <div
        className="fixed inset-0 z-50 flex items-start justify-center bg-[var(--app-overlay)] px-4 pt-[12vh]"
        role="presentation"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) onOpenChange(false)
        }}
      >
        <CommandRoot className="w-full max-w-[640px] overflow-hidden rounded-lg border border-app-border bg-app-surface shadow-2xl">
          <CommandInput
            autoFocus
            placeholder="Run command or switch repo..."
            value={query}
            onValueChange={setQuery}
            className="h-12 w-full border-b border-app-border bg-transparent px-4 text-sm text-app-text outline-none placeholder:text-app-text-muted"
            onKeyDown={(event) => {
              if (event.key === 'Escape') onOpenChange(false)
            }}
          />
          <CommandList className="max-h-[420px] overflow-y-auto p-2">
            <CommandEmpty className="px-3 py-8 text-center text-sm text-app-text-muted">No command found.</CommandEmpty>
            {sessionsQuery.isLoading && (
              <div className="px-3 py-2 text-xs text-app-text-muted">Loading recent sessions...</div>
            )}
            {processesQuery.isLoading && (
              <div className="px-3 py-2 text-xs text-app-text-muted">Loading running processes...</div>
            )}
            {pluginsQuery.isLoading && (
              <div className="px-3 py-2 text-xs text-app-text-muted">Loading Codex plugins...</div>
            )}
            {(skillsQuery.isLoading || registryQuery.isLoading) && (
              <div className="px-3 py-2 text-xs text-app-text-muted">Loading Codex capabilities...</div>
            )}
            {(repoFileSearchQuery.isLoading || repoContentSearchQuery.isLoading) && (
              <div className="px-3 py-2 text-xs text-app-text-muted">Searching repo...</div>
            )}
            {githubItemPanelsQuery.isLoading && (
              <div className="px-3 py-2 text-xs text-app-text-muted">Loading GitHub refs...</div>
            )}
            {GROUP_ORDER.map((group) => grouped[group]?.length ? (
              <CommandGroup key={group} heading={GROUP_LABELS[group]} className="text-xs text-app-text-muted [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5">
                {grouped[group].map((action) => (
                  <CommandItem
                    key={action.id}
                    value={actionSearchText(action)}
                    disabled={Boolean(action.disabledReason)}
                    onSelect={() => run(action)}
                    className="flex cursor-default items-center gap-2 rounded-md px-2 py-2 text-sm text-app-text aria-disabled:cursor-not-allowed aria-disabled:opacity-50 aria-selected:bg-app-surface-2"
                  >
                    <ActionIcon icon={action.icon} />
                    <span className="min-w-0 flex-1 truncate">{action.label}</span>
                    {action.description && <span className="hidden max-w-[240px] truncate text-xs text-app-text-muted sm:inline">{action.disabledReason ?? action.description}</span>}
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null)}
          </CommandList>
        </CommandRoot>
      </div>
    </>
  )
}

const GROUP_ORDER: AppActionGroup[] = ['workspace', 'windows', 'files', 'rail', 'processes', 'sessions', 'repos', 'system']
const GROUP_LABELS: Record<AppActionGroup, string> = {
  workspace: 'Workspace',
  windows: 'Windows',
  files: 'Files',
  rail: 'Right Rail',
  processes: 'Processes',
  sessions: 'Sessions',
  repos: 'Repos',
  system: 'System',
}

function groupActions(actions: AppAction[]): Record<AppActionGroup, AppAction[]> {
  return actions.reduce((groups, action) => {
    groups[action.group].push(action)
    return groups
  }, {
    workspace: [],
    windows: [],
    files: [],
    rail: [],
    processes: [],
    sessions: [],
    repos: [],
    system: [],
  } as Record<AppActionGroup, AppAction[]>)
}

function ActionIcon({ icon }: { icon: AppActionIcon }) {
  const Icon = icon === 'activity'
    ? Activity
    : icon === 'chat'
    ? MessageSquare
    : icon === 'terminal'
      ? Terminal
      : icon === 'browser'
        ? Globe
        : icon === 'diff'
          ? FileDiff
          : icon === 'file'
            ? FileText
            : icon === 'github'
              ? Github
              : icon === 'repo'
                ? FolderGit2
                : icon === 'session'
                  ? MessageSquare
                  : icon === 'settings'
                    ? Settings
                    : icon === 'tools'
                      ? PlugZap
                      : LayoutPanelTop
  return <Icon className="h-4 w-4 shrink-0 text-app-text-muted" />
}

function openCodexSession(session: CodexSessionSummary, repoPath: string, archived = false) {
  window.dispatchEvent(new CustomEvent('cranberri:open-codex-session', { detail: { session, repoPath, archived } }))
}

async function readSessionThread(result: SessionSearchResult): Promise<CodexSessionThread> {
  const { thread } = await window.cranberri.codex.readThread(result.repoPath, result.session.id, result.archived)
  return thread
}
