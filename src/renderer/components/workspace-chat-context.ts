import type { WorkspaceWindowState } from '@/shared/appState'
import type { CodexThread } from '@/shared/codex'
import type { GitFileStatus, GitHubRepoSummary } from '@/shared/git'
import type { AgentProcessInfo } from '@/shared/processes'
import type { Repo } from '../state/repos'

const MAX_WORKSPACE_CONTEXT_CHARS = 14000

function truncateMiddle(value: string, maxChars = MAX_WORKSPACE_CONTEXT_CHARS): string {
  const text = value.trim()
  if (text.length <= maxChars) return text
  const keep = Math.floor((maxChars - 96) / 2)
  return [
    text.slice(0, keep).trimEnd(),
    '',
    `[Workspace brief truncated: ${text.length - (keep * 2)} chars omitted from the middle]`,
    '',
    text.slice(-keep).trimStart(),
  ].join('\n')
}

function optionalLine(label: string, value: string | number | boolean | null | undefined): string | null {
  if (value === null || value === undefined || value === '') return null
  return `${label}: ${value}`
}

function gitHubLine(summary: GitHubRepoSummary | null | undefined): string {
  if (!summary?.isGitHub) return 'GitHub: not detected'
  return [
    `GitHub: ${summary.owner && summary.repo ? `${summary.owner}/${summary.repo}` : summary.webUrl ?? 'detected'}`,
    summary.branch ? `branch ${summary.branch}` : null,
    summary.tracking ? `tracking ${summary.tracking}` : null,
    summary.ahead || summary.behind ? `ahead ${summary.ahead}, behind ${summary.behind}` : null,
  ].filter(Boolean).join(' - ')
}

function formatWindow(window: WorkspaceWindowState, activeWindowId: string | null): string {
  const flags = [
    window.id === activeWindowId ? 'active' : null,
    window.type,
  ].filter(Boolean).join(', ')
  const browser = window.browser
  return [
    `- ${window.title} (${flags})`,
    browser?.url ? `  url: ${browser.url}` : null,
    browser?.profileId ? `  profile: ${browser.profileId}` : null,
    browser?.viewportMode ? `  viewport: ${browser.viewportMode}` : null,
    browser?.devServerProcessId ? `  dev-server process: ${browser.devServerProcessId}` : null,
  ].filter((line): line is string => Boolean(line)).join('\n')
}

function formatStatus(status: GitFileStatus[]): string {
  if (status.length === 0) return 'No changed files.'
  const shown = status.slice(0, 40).map((file) => `- ${file.status}: ${file.path}`)
  if (status.length > shown.length) shown.push(`- ... ${status.length - shown.length} more changed files`)
  return shown.join('\n')
}

function formatProcess(processInfo: AgentProcessInfo): string {
  return [
    `- ${processInfo.command || processInfo.id}`,
    `  kind: ${processInfo.kind}`,
    `  status: ${processInfo.status}`,
    processInfo.pid != null ? `  pid: ${processInfo.pid}` : null,
    processInfo.terminalWindowId ? `  terminal: ${processInfo.terminalWindowId}` : null,
  ].filter((line): line is string => Boolean(line)).join('\n')
}

export function workspaceBriefChatContext(options: {
  repo: Repo
  windows: WorkspaceWindowState[]
  activeWindowId: string | null
  activeThread?: CodexThread | null
  selectedRightRailFile?: GitFileStatus | null
  status: GitFileStatus[]
  githubSummary?: GitHubRepoSummary | null
  processes: AgentProcessInfo[]
}): string {
  const activeWindow = options.windows.find((window) => window.id === options.activeWindowId)
  const runningProcesses = options.processes.filter((processInfo) => processInfo.status === 'running')
  const processText = runningProcesses.length
    ? runningProcesses.slice(0, 20).map(formatProcess).join('\n')
    : 'No running repo processes.'

  const body = [
    'Workspace brief:',
    '',
    'Repo:',
    `Name: ${options.repo.name}`,
    `Path: ${options.repo.path}`,
    gitHubLine(options.githubSummary),
    '',
    'Active state:',
    optionalLine('Active window', activeWindow ? `${activeWindow.title} (${activeWindow.type})` : 'none'),
    optionalLine('Active chat', options.activeThread ? options.activeThread.title || options.activeThread.id : 'none'),
    optionalLine('Active chat running', options.activeThread?.isRunning),
    optionalLine('Active chat messages', options.activeThread?.messages.length),
    options.activeThread?.contextUsage ? `Context: ${options.activeThread.contextUsage.usedTokens}/${options.activeThread.contextUsage.contextWindow} tokens` : null,
    optionalLine('Selected right rail file', options.selectedRightRailFile ? `${options.selectedRightRailFile.path} (${options.selectedRightRailFile.status})` : null),
    '',
    'Open windows:',
    options.windows.length ? options.windows.map((window) => formatWindow(window, options.activeWindowId)).join('\n') : 'No open workspace windows.',
    '',
    'Changed files:',
    formatStatus(options.status),
    '',
    'Running processes:',
    processText,
  ].filter((line): line is string => line !== null).join('\n')

  return truncateMiddle(body)
}
