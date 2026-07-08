import { describe, expect, it } from 'vitest'
import { workspaceBriefChatContext } from './workspace-chat-context'
import type { CodexThread } from '@/shared/codex'
import type { GitHubRepoSummary } from '@/shared/git'
import type { AgentProcessInfo } from '@/shared/processes'
import type { Repo } from '../state/repos'

const repo: Repo = {
  id: 'repo-1',
  name: 'Cranberri',
  path: '/repo/cranberri',
}

const githubSummary: GitHubRepoSummary = {
  remoteUrl: 'git@github.com:fraction12/Cranberri.git',
  webUrl: 'https://github.com/fraction12/Cranberri',
  owner: 'fraction12',
  repo: 'Cranberri',
  branch: 'main',
  tracking: 'origin/main',
  ahead: 2,
  behind: 1,
  isGitHub: true,
}

const activeThread: CodexThread = {
  id: 'thread-1',
  title: 'Build browser context',
  repoId: 'repo-1',
  messages: [
    { id: 'message-1', role: 'user', content: 'hello', timestamp: 1 },
    { id: 'message-2', role: 'assistant', content: 'hi', timestamp: 2 },
  ],
  pendingApprovals: [],
  isRunning: true,
  contextUsage: { usedTokens: 1200, contextWindow: 200000 },
}

const processInfo: AgentProcessInfo = {
  id: 'process-1',
  pid: 1234,
  command: 'npm run dev',
  repoPath: '/repo/cranberri',
  kind: 'dev-server',
  source: 'terminal',
  status: 'running',
  startedAt: 1,
  terminalWindowId: 'terminal-window-1',
}

describe('workspace brief chat context', () => {
  it('formats repo, active state, windows, changes, and processes', () => {
    const context = workspaceBriefChatContext({
      repo,
      activeWindowId: 'browser-1',
      activeThread,
      githubSummary,
      status: [
        { path: 'src/renderer/App.tsx', status: 'modified' },
        { path: 'src/main/browser.ts', status: 'added' },
      ],
      selectedRightRailFile: { path: 'src/renderer/App.tsx', status: 'modified' },
      processes: [processInfo],
      windows: [
        { id: 'chat-1', type: 'chat', title: 'Chat' },
        {
          id: 'browser-1',
          type: 'browser',
          title: 'Preview',
          browser: {
            url: 'http://localhost:5173',
            profileId: 'repo-1',
            viewportMode: 'desktop',
            devServerProcessId: 'process-1',
          },
        },
      ],
    })

    expect(context).toContain('Workspace brief:')
    expect(context).toContain('Name: Cranberri')
    expect(context).toContain('GitHub: fraction12/Cranberri - branch main - tracking origin/main - ahead 2, behind 1')
    expect(context).toContain('Active window: Preview (browser)')
    expect(context).toContain('Active chat: Build browser context')
    expect(context).toContain('Context: 1200/200000 tokens')
    expect(context).toContain('Selected right rail file: src/renderer/App.tsx (modified)')
    expect(context).toContain('- modified: src/renderer/App.tsx')
    expect(context).toContain('- npm run dev')
    expect(context).toContain('terminal: terminal-window-1')
  })

  it('limits changed files and reports remaining count', () => {
    const status = Array.from({ length: 42 }, (_, index) => ({
      path: `file-${index}.ts`,
      status: 'modified' as const,
    }))

    const context = workspaceBriefChatContext({
      repo,
      activeWindowId: null,
      status,
      processes: [],
      windows: [],
    })

    expect(context).toContain('- modified: file-39.ts')
    expect(context).toContain('- ... 2 more changed files')
    expect(context).not.toContain('file-41.ts')
  })

  it('keeps beginning and newest tail when the brief is too large', () => {
    const context = workspaceBriefChatContext({
      repo,
      activeWindowId: null,
      status: [],
      processes: [
        {
          ...processInfo,
          command: `${'x'.repeat(15000)} latest-process-detail`,
        },
      ],
      windows: [],
    })

    expect(context).toContain('Workspace brief:')
    expect(context).toContain('Workspace brief truncated')
    expect(context).toContain('latest-process-detail')
  })
})
