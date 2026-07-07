import { app, ipcMain } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { APP_SETTINGS_VERSION, DEFAULT_APP_SETTINGS, type AppSettings } from '@/shared/settings'

const codexReasoningEffortSchema = z.enum(['low', 'medium', 'high', 'xhigh'])
const codexApprovalModeSchema = z.enum(['ask', 'approve', 'full', 'custom'])
const themeSchema = z.enum(['dark', 'light'])
const updaterChannelSchema = z.enum(['stable', 'beta'])

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
      fontSize: z.number(),
      lineWrap: z.boolean(),
    }),
    terminal: z.object({
      fontSize: z.number(),
      defaultShell: z.string().optional(),
    }),
    appearance: z.object({
      theme: themeSchema,
    }),
    updater: z.object({
      channel: updaterChannelSchema,
      sourceRepoPath: z.string().optional(),
    }),
  }),
})

type SettingsFile = z.infer<typeof settingsSchema>

function settingsFilePath(): string {
  return path.join(app.getPath('userData'), 'settings.json')
}

function getSection(raw: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = raw[key]
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
}

function migrateSettings(raw: Record<string, unknown>): AppSettings {
  const version = typeof raw.version === 'number' ? raw.version : 0
  const incoming = (raw.data as Record<string, unknown> | undefined) ?? raw
  const codex = getSection(incoming, 'codex')
  const editor = getSection(incoming, 'editor')
  const terminal = getSection(incoming, 'terminal')
  const appearance = getSection(incoming, 'appearance')
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
      fontSize: typeof editor.fontSize === 'number' ? editor.fontSize : DEFAULT_APP_SETTINGS.editor.fontSize,
      lineWrap: typeof editor.lineWrap === 'boolean' ? editor.lineWrap : DEFAULT_APP_SETTINGS.editor.lineWrap,
    },
    terminal: {
      fontSize: typeof terminal.fontSize === 'number' ? terminal.fontSize : DEFAULT_APP_SETTINGS.terminal.fontSize,
      defaultShell: typeof terminal.defaultShell === 'string' && terminal.defaultShell ? terminal.defaultShell : DEFAULT_APP_SETTINGS.terminal.defaultShell,
    },
    appearance: {
      theme: themeSchema.safeParse(appearance.theme).success ? (appearance.theme as AppSettings['appearance']['theme']) : DEFAULT_APP_SETTINGS.appearance.theme,
    },
    updater: {
      channel: updaterChannelSchema.safeParse(updater.channel).success ? (updater.channel as AppSettings['updater']['channel']) : DEFAULT_APP_SETTINGS.updater.channel,
      sourceRepoPath: typeof updater.sourceRepoPath === 'string' && updater.sourceRepoPath ? updater.sourceRepoPath : DEFAULT_APP_SETTINGS.updater.sourceRepoPath,
    },
  }

  void version
  return data
}

export function readSettings(): AppSettings {
  try {
    const raw = JSON.parse(fs.readFileSync(settingsFilePath(), 'utf8')) as Record<string, unknown>
    const parsed = settingsSchema.safeParse(raw)
    if (parsed.success) return parsed.data.data
    return migrateSettings(raw)
  } catch {
    return DEFAULT_APP_SETTINGS
  }
}

export function writeSettings(settings: AppSettings): void {
  const payload: SettingsFile = { version: APP_SETTINGS_VERSION, data: settings }
  fs.mkdirSync(path.dirname(settingsFilePath()), { recursive: true })
  fs.writeFileSync(settingsFilePath(), JSON.stringify(payload, null, 2))
}

export function initSettingsIpc(): void {
  ipcMain.handle('settings:get', () => {
    return { settings: readSettings() }
  })

  ipcMain.handle('settings:set', (_, settings: AppSettings) => {
    const parsed = settingsSchema.shape.data.safeParse(settings)
    if (!parsed.success) {
      throw new Error(`Invalid settings: ${parsed.error.message}`)
    }
    writeSettings(parsed.data)
    return { settings: parsed.data }
  })
}
