import type { CodexApprovalMode, CodexReasoningEffort, CodexSpeed } from './codex'
import type { ToolCatalogPreferences } from './tools'

export const APP_THEME_VALUES = ['system', 'light', 'dark'] as const
export type AppTheme = (typeof APP_THEME_VALUES)[number]

export const APP_ACCENT_VALUES = ['green', 'blue', 'orange', 'rose', 'violet'] as const
export type AppAccent = (typeof APP_ACCENT_VALUES)[number]

export const APP_REDUCED_MOTION_VALUES = ['system', 'on', 'off'] as const
export type AppReducedMotion = (typeof APP_REDUCED_MOTION_VALUES)[number]

export const APP_UI_FONT_SIZE_RANGE = { min: 11, max: 16 } as const
export const APP_CODE_FONT_SIZE_RANGE = { min: 8, max: 24 } as const
export const APP_TERMINAL_FONT_SIZE_RANGE = { min: 8, max: 24 } as const

export type ToolCurationSettings = ToolCatalogPreferences

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
    theme: AppTheme
    accent: AppAccent
    uiFontSize: number
    reducedMotion: AppReducedMotion
  }
  tools: ToolCurationSettings
  updater: {
    channel: 'stable' | 'beta'
    sourceRepoPath?: string
  }
}

export const APP_SETTINGS_VERSION = 3

export const DEFAULT_APP_SETTINGS: AppSettings = {
  codex: {
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
    uiFontSize: 14,
    reducedMotion: 'system',
  },
  tools: {
    pinnedToolIds: [],
    dismissedDefaultToolIds: [],
  },
  updater: {
    channel: 'stable',
  },
}
