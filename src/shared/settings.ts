import type { CodexApprovalMode, CodexReasoningEffort, CodexSpeed } from './codex'

export interface AppSettings {
  codex: {
    defaultModel: string
    defaultEffort: CodexReasoningEffort
    defaultSpeed?: CodexSpeed
    defaultApprovalMode: CodexApprovalMode
    streamTokens: boolean
  }
  editor: {
    fontSize: number
    lineWrap: boolean
  }
  terminal: {
    fontSize: number
    defaultShell?: string
  }
  appearance: {
    theme: 'dark' | 'light'
  }
  updater?: {
    sourceRepoPath?: string
  }
}

export const APP_SETTINGS_VERSION = 1

export const DEFAULT_APP_SETTINGS: AppSettings = {
  codex: {
    defaultModel: 'gpt-5.5',
    defaultEffort: 'high',
    defaultApprovalMode: 'custom',
    streamTokens: true,
  },
  editor: {
    fontSize: 13,
    lineWrap: true,
  },
  terminal: {
    fontSize: 13,
  },
  appearance: {
    theme: 'dark',
  },
}
