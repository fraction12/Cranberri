import type { CodexApprovalMode, CodexReasoningEffort, CodexSpeed } from './codex'
import type { ToolCatalogPreferences } from './tools'

export const APP_THEME_VALUES = ['system', 'light', 'dark'] as const
export type AppTheme = (typeof APP_THEME_VALUES)[number]

export const APP_ACCENT_VALUES = ['green', 'blue', 'orange', 'rose', 'violet'] as const
export type AppAccent = (typeof APP_ACCENT_VALUES)[number]

export const APP_REDUCED_MOTION_VALUES = ['system', 'on', 'off'] as const
export type AppReducedMotion = (typeof APP_REDUCED_MOTION_VALUES)[number]

export const APP_TYPE_PRESET_VALUES = ['compact', 'standard', 'large'] as const
export type AppTypePreset = (typeof APP_TYPE_PRESET_VALUES)[number]

export const APP_CODE_FONT_SIZE_RANGE = { min: 8, max: 24 } as const
export const APP_TERMINAL_FONT_SIZE_RANGE = { min: 8, max: 24 } as const
export const WORKTREE_RETENTION_DAYS_RANGE = { min: 1, max: 90 } as const
export const MANAGED_WORKTREE_CAP_RANGE = { min: 1, max: 15 } as const

export function defaultWorktreeRoot(): string {
  const home = process.env.CRANBERRI_HOME?.trim()
  return home ? `${home}/worktrees` : `${process.env.HOME ?? '~'}/.cranberri/worktrees`
}

export type ToolCurationSettings = ToolCatalogPreferences

export interface AppSettings {
  codex: {
    runtimeMode: 'automatic' | 'custom'
    executablePath?: string
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
    theme: AppTheme
    accent: AppAccent
    typePreset: AppTypePreset
    reducedMotion: AppReducedMotion
  }
  tools: ToolCurationSettings
  updater: {
    channel: 'stable' | 'beta'
    sourceRepoPath?: string
  }
  worktrees: { root: string; retentionDays: number; cap: number }
}

export const APP_SETTINGS_VERSION = 6

export const DEFAULT_APP_SETTINGS: AppSettings = {
  codex: {
    runtimeMode: 'automatic',
    defaultModel: 'gpt-5.5',
    defaultEffort: 'high',
    defaultApprovalMode: 'custom',
    streamTokens: true,
  },
  editor: {
    fontSize: 12,
    lineWrap: true,
  },
  terminal: {
    fontSize: 13,
  },
  appearance: {
    theme: 'system',
    accent: 'green',
    typePreset: 'standard',
    reducedMotion: 'system',
  },
  tools: {
    pinnedToolIds: [],
    dismissedDefaultToolIds: [],
  },
  updater: {
    channel: 'stable',
  },
  worktrees: { root: defaultWorktreeRoot(), retentionDays: 7, cap: 15 },
}
