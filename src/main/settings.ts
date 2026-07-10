import { app, ipcMain, nativeTheme } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import {
  CODEX_REASONING_EFFORT_VALUES,
  normalizeCodexReasoningEffort,
  normalizeCodexSpeed,
} from '../shared/codex'
import {
  APP_ACCENT_VALUES,
  APP_CODE_FONT_SIZE_RANGE,
  APP_REDUCED_MOTION_VALUES,
  APP_SETTINGS_VERSION,
  APP_TERMINAL_FONT_SIZE_RANGE,
  APP_THEME_VALUES,
  APP_UI_FONT_SIZE_RANGE,
  DEFAULT_APP_SETTINGS,
  type AppSettings,
} from '../shared/settings'
import { toolCatalogIdSchema, toolCatalogPreferencesSchema, type ToolCatalogId } from '../shared/tools'

const codexReasoningEffortSchema = z.enum(CODEX_REASONING_EFFORT_VALUES)
const codexApprovalModeSchema = z.enum(['ask', 'approve', 'full', 'custom'])
const themeSchema = z.enum(APP_THEME_VALUES)
const accentSchema = z.enum(APP_ACCENT_VALUES)
const reducedMotionSchema = z.enum(APP_REDUCED_MOTION_VALUES)
const updaterChannelSchema = z.enum(['stable', 'beta'])
const toolCurationSettingsSchema = z.object({
  pinnedToolIds: toolCatalogPreferencesSchema.shape.pinnedToolIds.default([]),
  dismissedDefaultToolIds: toolCatalogPreferencesSchema.shape.dismissedDefaultToolIds.default([]),
})

const codexSpeedSchema = z.enum(['standard', 'fast'])

const settingsSchema = z.object({
  version: z.number(),
  data: z.object({
    codex: z.object({
      defaultModel: z.string(),
      defaultEffort: codexReasoningEffortSchema,
      defaultSpeed: codexSpeedSchema.optional(),
      defaultApprovalMode: codexApprovalModeSchema,
      streamTokens: z.boolean(),
    }),
    editor: z.object({
      fontSize: z.number().int().min(APP_CODE_FONT_SIZE_RANGE.min).max(APP_CODE_FONT_SIZE_RANGE.max),
      lineWrap: z.boolean(),
    }),
    terminal: z.object({
      fontSize: z.number().int().min(APP_TERMINAL_FONT_SIZE_RANGE.min).max(APP_TERMINAL_FONT_SIZE_RANGE.max),
      defaultShell: z.string().optional(),
    }),
    appearance: z.object({
      theme: themeSchema,
      accent: accentSchema,
      uiFontSize: z.number().int().min(APP_UI_FONT_SIZE_RANGE.min).max(APP_UI_FONT_SIZE_RANGE.max),
      reducedMotion: reducedMotionSchema,
    }),
    tools: toolCurationSettingsSchema.default(DEFAULT_APP_SETTINGS.tools),
    updater: z.object({
      channel: updaterChannelSchema,
      sourceRepoPath: z.string().optional(),
    }),
  }),
})

type SettingsFile = z.infer<typeof settingsSchema>

function boundedInteger(value: unknown, range: { min: number; max: number }, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(range.max, Math.max(range.min, Math.round(value)))
}

function normalizeSettings(settings: AppSettings): AppSettings {
  const defaultEffort = normalizeCodexReasoningEffort(
    settings.codex.defaultModel,
    settings.codex.defaultEffort,
  )
  const defaultSpeed = normalizeCodexSpeed(
    settings.codex.defaultModel,
    settings.codex.defaultSpeed,
  )
  if (
    defaultEffort === settings.codex.defaultEffort
    && defaultSpeed === settings.codex.defaultSpeed
  ) return settings

  return {
    ...settings,
    codex: { ...settings.codex, defaultEffort, defaultSpeed },
  }
}

function settingsFilePath(): string {
  return path.join(app.getPath('userData'), 'settings.json')
}

function getSection(raw: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = raw[key]
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
}

function validToolIds(value: unknown): ToolCatalogId[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((candidate) => {
    const result = toolCatalogIdSchema.safeParse(candidate)
    return result.success ? [result.data] : []
  })
}

function migrateSettings(raw: Record<string, unknown>): AppSettings {
  const version = typeof raw.version === 'number' ? raw.version : 0
  const incoming = (raw.data as Record<string, unknown> | undefined) ?? raw
  const codex = getSection(incoming, 'codex')
  const editor = getSection(incoming, 'editor')
  const terminal = getSection(incoming, 'terminal')
  const appearance = getSection(incoming, 'appearance')
  const tools = getSection(incoming, 'tools')
  const updater = getSection(incoming, 'updater')

  const data: AppSettings = {
    codex: {
      defaultModel: typeof codex.defaultModel === 'string' ? codex.defaultModel : DEFAULT_APP_SETTINGS.codex.defaultModel,
      defaultEffort: codexReasoningEffortSchema.safeParse(codex.defaultEffort).success ? (codex.defaultEffort as AppSettings['codex']['defaultEffort']) : DEFAULT_APP_SETTINGS.codex.defaultEffort,
      defaultSpeed: codexSpeedSchema.safeParse(codex.defaultSpeed).success ? (codex.defaultSpeed as AppSettings['codex']['defaultSpeed']) : DEFAULT_APP_SETTINGS.codex.defaultSpeed,
      defaultApprovalMode: codexApprovalModeSchema.safeParse(codex.defaultApprovalMode).success ? (codex.defaultApprovalMode as AppSettings['codex']['defaultApprovalMode']) : DEFAULT_APP_SETTINGS.codex.defaultApprovalMode,
      streamTokens: typeof codex.streamTokens === 'boolean' ? codex.streamTokens : DEFAULT_APP_SETTINGS.codex.streamTokens,
    },
    editor: {
      fontSize: boundedInteger(editor.fontSize, APP_CODE_FONT_SIZE_RANGE, DEFAULT_APP_SETTINGS.editor.fontSize),
      lineWrap: typeof editor.lineWrap === 'boolean' ? editor.lineWrap : DEFAULT_APP_SETTINGS.editor.lineWrap,
    },
    terminal: {
      fontSize: boundedInteger(terminal.fontSize, APP_TERMINAL_FONT_SIZE_RANGE, DEFAULT_APP_SETTINGS.terminal.fontSize),
      defaultShell: typeof terminal.defaultShell === 'string' && terminal.defaultShell ? terminal.defaultShell : DEFAULT_APP_SETTINGS.terminal.defaultShell,
    },
    appearance: {
      theme: themeSchema.safeParse(appearance.theme).success ? (appearance.theme as AppSettings['appearance']['theme']) : DEFAULT_APP_SETTINGS.appearance.theme,
      accent: accentSchema.safeParse(appearance.accent).success ? (appearance.accent as AppSettings['appearance']['accent']) : DEFAULT_APP_SETTINGS.appearance.accent,
      uiFontSize: boundedInteger(appearance.uiFontSize, APP_UI_FONT_SIZE_RANGE, DEFAULT_APP_SETTINGS.appearance.uiFontSize),
      reducedMotion: reducedMotionSchema.safeParse(appearance.reducedMotion).success
        ? (appearance.reducedMotion as AppSettings['appearance']['reducedMotion'])
        : DEFAULT_APP_SETTINGS.appearance.reducedMotion,
    },
    tools: {
      pinnedToolIds: validToolIds(tools.pinnedToolIds),
      dismissedDefaultToolIds: validToolIds(tools.dismissedDefaultToolIds),
    },
    updater: {
      channel: updaterChannelSchema.safeParse(updater.channel).success ? (updater.channel as AppSettings['updater']['channel']) : DEFAULT_APP_SETTINGS.updater.channel,
      sourceRepoPath: typeof updater.sourceRepoPath === 'string' && updater.sourceRepoPath ? updater.sourceRepoPath : DEFAULT_APP_SETTINGS.updater.sourceRepoPath,
    },
  }

  void version
  return normalizeSettings(data)
}

export function readSettings(): AppSettings {
  try {
    const raw = JSON.parse(fs.readFileSync(settingsFilePath(), 'utf8')) as Record<string, unknown>
    const parsed = settingsSchema.safeParse(raw)
    if (parsed.success) return normalizeSettings(parsed.data.data)
    return migrateSettings(raw)
  } catch {
    return DEFAULT_APP_SETTINGS
  }
}

export function writeSettings(settings: AppSettings): void {
  const payload: SettingsFile = { version: APP_SETTINGS_VERSION, data: normalizeSettings(settings) }
  const targetPath = settingsFilePath()
  const temporaryPath = `${targetPath}.tmp`
  fs.mkdirSync(path.dirname(targetPath), { recursive: true })
  try {
    fs.writeFileSync(temporaryPath, JSON.stringify(payload, null, 2))
    fs.renameSync(temporaryPath, targetPath)
  } catch (error) {
    fs.rmSync(temporaryPath, { force: true })
    throw error
  }
}

export function initSettingsIpc(): void {
  nativeTheme.themeSource = readSettings().appearance.theme

  ipcMain.handle('settings:get', () => {
    return { settings: readSettings() }
  })

  ipcMain.handle('settings:set', (_, settings: AppSettings) => {
    const parsed = settingsSchema.shape.data.safeParse(settings)
    if (!parsed.success) {
      throw new Error(`Invalid settings: ${parsed.error.message}`)
    }
    const normalized = normalizeSettings(parsed.data)
    writeSettings(normalized)
    nativeTheme.themeSource = normalized.appearance.theme
    return { settings: normalized }
  })
}
