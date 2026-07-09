import { dialog, ipcMain } from 'electron'
import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { CodexClient } from './client'
import { makeCodexEnv } from './env'
import { FakeCodexClient } from './fakeClient'
import type { CodexConnectionStatus, CodexEvent, CodexPluginActionResult, CodexPluginInfo, CodexSkillInfo, CodexTurnSettings, CodexUserInput } from '../../shared/codex'
import { randomUUID } from 'node:crypto'
import { logTelemetry } from '../telemetry'
import { normalizeToolRegistrySnapshot, recordToolEventsForCodexEvent } from '../tools'
import { shouldForwardCodexEventToRenderer, shouldPersistCodexEventTelemetry } from './eventPolicy'
import {
  MINIMUM_GPT_56_CODEX_VERSION,
  codexCliNeedsUpdate,
  parseCodexCliVersion,
} from './version'

interface PluginManifest {
  name?: string
  description?: string
  interface?: {
    displayName?: string
    shortDescription?: string
    longDescription?: string
    defaultPrompt?: string[]
    composerIcon?: string
  }
}

interface CodexPluginListEntry {
  pluginId?: string
  name?: string
  marketplaceName?: string
  version?: string
  installed?: boolean
  enabled?: boolean
  installPolicy?: string
  authPolicy?: string
  source?: {
    source?: string
    path?: string
    url?: string
  }
  marketplaceSource?: {
    sourceType?: string
    source?: string
  }
}

interface CodexPluginListJson {
  installed?: CodexPluginListEntry[]
  available?: CodexPluginListEntry[]
}

const CODEX_HOME = process.env.CODEX_HOME ?? path.join(os.homedir(), '.codex')
const CODEX_SKILLS_DIR = path.join(CODEX_HOME, 'skills')

type CodexClientLike = CodexClient | FakeCodexClient

let client: CodexClientLike | null = null
let clientStarting = false
let clientEventHandlerAttached = false
let codexEventBroadcast: ((event: CodexEvent) => void) | null = null

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

function isThreadNotFoundError(error: unknown): boolean {
  return /thread not found/i.test(errorMessage(error, ''))
}

function registryErrorMessage(error: unknown, fallback: string): string {
  const message = errorMessage(error, fallback)
  return /thread not found/i.test(message) ? 'Active Codex thread is no longer available for registry lookup.' : message
}

async function findCodexBinary(): Promise<string | null> {
  return findExecutable('codex', ['/opt/homebrew/bin/codex', '/usr/local/bin/codex'])
}

async function findExecutable(name: string, candidates: string[]): Promise<string | null> {
  const fromPath = await run('which', [name], 5000)
  const found = fromPath.stdout.trim().split('\n')[0]
  if (fromPath.code === 0 && found) return found

  for (const candidate of candidates) {
    if (await pathExists(candidate)) return candidate
  }
  return null
}

async function installCodexCli(): Promise<void> {
  const npmPath = await findExecutable('npm', ['/opt/homebrew/bin/npm', '/usr/local/bin/npm'])
  if (!npmPath) throw new Error('Codex CLI was not found, and npm is not available to install it.')

  const install = await run(npmPath, ['install', '-g', '@openai/codex@latest'], 300000, await makeCodexEnv())
  if (install.code !== 0) {
    const detail = (install.stderr || install.stdout).trim() || 'Failed to install Codex CLI.'
    throw new Error(detail)
  }
}

async function getCodexConnectionStatus(): Promise<CodexConnectionStatus> {
  const cliPath = await findCodexBinary()
  if (!cliPath) {
    return {
      installed: false,
      authenticated: false,
      minimumVersion: MINIMUM_GPT_56_CODEX_VERSION,
      detail: 'Codex CLI was not found on this machine.',
    }
  }

  const env = await makeCodexEnv()
  const [versionStatus, status] = await Promise.all([
    run(cliPath, ['--version'], 15000, env),
    run(cliPath, ['login', 'status'], 15000, env),
  ])
  const versionOutput = (versionStatus.stdout || versionStatus.stderr).trim()
  const version = parseCodexCliVersion(versionOutput) ?? undefined
  const updateRequired = codexCliNeedsUpdate(versionOutput)
  const detail = (status.stdout || status.stderr).trim() || 'Codex login status returned no output.'
  return {
    installed: true,
    authenticated: status.code === 0 && /logged in/i.test(detail),
    cliPath,
    version,
    minimumVersion: MINIMUM_GPT_56_CODEX_VERSION,
    updateRequired,
    detail: updateRequired
      ? `Codex CLI ${version ?? 'unknown'} must be updated for GPT-5.6.`
      : detail,
  }
}

function run(command: string, args: string[], timeout = 15000, env?: NodeJS.ProcessEnv): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve) => {
    execFile(command, args, { timeout, maxBuffer: 1024 * 1024, env: env ?? process.env }, (error, stdout, stderr) => {
      resolve({
        stdout: stdout?.toString() ?? '',
        stderr: stderr?.toString() ?? '',
        code: error ? 1 : 0,
      })
    })
  })
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

function titleizePluginName(name: string): string {
  return name
    .split(/[-_]/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function titleizeSkillName(name: string): string {
  if (name.startsWith('/')) return name
  return name
    .split(/[-_]/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

async function readJson<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8')) as T
  } catch {
    return null
  }
}

function parseSkillMarkdown(content: string, fallbackName: string): { name: string; description: string } {
  const frontmatter = content.match(/^---\n([\s\S]*?)\n---/)
  const meta = frontmatter?.[1] ?? ''
  const name = meta.match(/^name:\s*['"]?(.+?)['"]?\s*$/m)?.[1]?.trim() || fallbackName
  const description = meta.match(/^description:\s*['"]?(.+?)['"]?\s*$/m)?.[1]?.trim() || ''
  return { name, description }
}

async function collectSkillFiles(dir: string, out: string[] = []): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'tests') continue
      await collectSkillFiles(fullPath, out)
    } else if (entry.isFile() && entry.name === 'SKILL.md') {
      out.push(fullPath)
    }
  }
  return out
}

function enabledPluginRefs(config: string): Array<{ name: string; marketplace: string }> {
  return [...config.matchAll(/^\[plugins\."([^"@]+)@([^"]+)"\]\n(?:[^[]*?enabled\s*=\s*true)?/gm)]
    .filter((match) => match[0].includes('enabled = true'))
    .map((match) => ({ name: match[1], marketplace: match[2] }))
}

async function skillFromFile(filePath: string, baseDir: string, source: CodexSkillInfo['source'], pluginName?: string): Promise<CodexSkillInfo | null> {
  const content = await fs.readFile(filePath, 'utf8').catch(() => '')
  if (!content) return null
  const skillDir = path.dirname(filePath)
  const fallbackName = path.basename(skillDir)
  const { name, description } = parseSkillMarkdown(content, fallbackName)
  const isSystem = source === 'system' || skillDir.split(path.sep).includes('.system')
  return {
    id: `${source}:${path.relative(baseDir, skillDir)}`,
    name,
    displayName: titleizeSkillName(name),
    description,
    path: skillDir,
    source: isSystem ? 'system' : source,
    pluginName,
  }
}

async function listCodexSkills(): Promise<CodexSkillInfo[]> {
  const personalFiles = await collectSkillFiles(CODEX_SKILLS_DIR)
  const personalSkills = await Promise.all(personalFiles.map(async (filePath) => {
    const skillDir = path.dirname(filePath)
    const isSystem = skillDir.split(path.sep).includes('.system')
    return skillFromFile(filePath, CODEX_SKILLS_DIR, isSystem ? 'system' : 'personal')
  }))

  const configPath = path.join(CODEX_HOME, 'config.toml')
  const config = await fs.readFile(configPath, 'utf8').catch(() => '')
  const enabled = enabledPluginRefs(config)
  const pluginSkillGroups = await Promise.all(enabled.map(async ({ name, marketplace }) => {
    const found = await findManifest(name, marketplace)
    if (!found) return []
    const files = await collectSkillFiles(path.join(found.root, 'skills'))
    return Promise.all(files.map((filePath) => skillFromFile(filePath, path.join(found.root, 'skills'), 'plugin', titleizePluginName(name))))
  }))

  const seen = new Set<string>()
  return [...personalSkills, ...pluginSkillGroups.flat()]
    .filter((skill): skill is CodexSkillInfo => Boolean(skill))
    .filter((skill) => {
      const key = `${skill.source}:${skill.pluginName ?? ''}:${skill.name}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .sort((a, b) => a.displayName.localeCompare(b.displayName))
}

async function findManifest(pluginName: string, marketplace: string): Promise<{ manifest: PluginManifest; root: string } | null> {
  const marketplaceDir = path.join(CODEX_HOME, 'plugins', 'cache', marketplace)
  if (!(await pathExists(marketplaceDir))) return null

  const candidates = [path.join(marketplaceDir, pluginName)]
  if (marketplace === 'openai-curated') candidates.unshift(path.join(CODEX_HOME, 'plugins', 'cache', 'openai-curated-remote', pluginName))

  for (const pluginRoot of candidates) {
    if (!(await pathExists(pluginRoot))) continue
    const versions = await fs.readdir(pluginRoot, { withFileTypes: true })
    for (const version of versions.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort().reverse()) {
      const root = path.join(pluginRoot, version)
      const manifestPath = path.join(root, '.codex-plugin', 'plugin.json')
      const manifest = await readJson<PluginManifest>(manifestPath)
      if (manifest) return { manifest, root }
    }
  }

  return null
}

async function readToolCounts(): Promise<Map<string, number>> {
  const counts = new Map<string, number>()
  const toolsDir = path.join(CODEX_HOME, 'cache', 'codex_apps_tools')
  if (!(await pathExists(toolsDir))) return counts

  const files = await fs.readdir(toolsDir)
  for (const file of files.filter((entry) => entry.endsWith('.json'))) {
    const data = await readJson<{ tools?: Array<{ connector_name?: string; tool?: { _meta?: { connector_name?: string } } }> }>(path.join(toolsDir, file))
    for (const entry of data?.tools ?? []) {
      const name = entry.connector_name ?? entry.tool?._meta?.connector_name
      if (name) counts.set(name.toLowerCase(), (counts.get(name.toLowerCase()) ?? 0) + 1)
    }
  }
  return counts
}

function parseJsonOutput<T>(stdout: string): T | null {
  try {
    return JSON.parse(stdout) as T
  } catch {
    return null
  }
}

function safePluginSelector(selector: string): string {
  const trimmed = selector.trim()
  if (!/^[a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+$/.test(trimmed)) {
    throw new Error('Plugin selector must be in the form plugin@marketplace.')
  }
  return trimmed
}

function pluginSourceLabel(entry: CodexPluginListEntry): string {
  if (entry.source?.path) return entry.source.path
  if (entry.source?.url) return entry.source.url
  if (entry.marketplaceSource?.source) return entry.marketplaceSource.source
  return entry.marketplaceName ?? 'configured marketplace'
}

async function manifestForPluginEntry(entry: CodexPluginListEntry): Promise<PluginManifest | null> {
  if (entry.source?.path) {
    return readJson<PluginManifest>(path.join(entry.source.path, '.codex-plugin', 'plugin.json'))
  }
  if (entry.name && entry.marketplaceName) {
    const found = await findManifest(entry.name, entry.marketplaceName)
    return found?.manifest ?? null
  }
  return null
}

async function pluginEntryToInfo(entry: CodexPluginListEntry, toolCounts: Map<string, number>): Promise<CodexPluginInfo | null> {
  const name = entry.name?.trim()
  const marketplaceName = entry.marketplaceName?.trim()
  const id = entry.pluginId?.trim() || (name && marketplaceName ? `${name}@${marketplaceName}` : '')
  if (!name || !id) return null

  const manifest = await manifestForPluginEntry(entry)
  const displayName = manifest?.interface?.displayName ?? titleizePluginName(name)
  const description = manifest?.interface?.shortDescription ?? manifest?.description ?? manifest?.interface?.longDescription ?? ''
  const prompt = manifest?.interface?.defaultPrompt?.[0] ?? `Use the ${displayName} plugin for this task.`
  return {
    id,
    name,
    displayName,
    description,
    prompt,
    icon: manifest?.interface?.composerIcon && entry.source?.path ? path.join(entry.source.path, manifest.interface.composerIcon) : undefined,
    enabled: Boolean(entry.enabled),
    installed: Boolean(entry.installed),
    marketplaceName,
    version: entry.version,
    installPolicy: entry.installPolicy,
    authPolicy: entry.authPolicy,
    sourceLabel: pluginSourceLabel(entry),
    toolCount: toolCounts.get(displayName.toLowerCase()) ?? toolCounts.get(name.replace(/-/g, ' ').toLowerCase()) ?? 0,
  }
}

async function listPluginsFromCli(): Promise<CodexPluginInfo[]> {
  const cliPath = await findCodexBinary()
  if (!cliPath) throw new Error('Codex CLI was not found on this machine.')

  const result = await run(cliPath, ['plugin', 'list', '--available', '--json'], 30000, await makeCodexEnv())
  if (result.code !== 0) {
    const detail = (result.stderr || result.stdout).trim() || 'Failed to list Codex plugins.'
    throw new Error(detail)
  }

  const data = parseJsonOutput<CodexPluginListJson>(result.stdout)
  if (!data) throw new Error('Codex plugin list returned invalid JSON.')

  const toolCounts = await readToolCounts()
  const rows = await Promise.all([...(data.installed ?? []), ...(data.available ?? [])].map((entry) => pluginEntryToInfo(entry, toolCounts)))
  const seen = new Set<string>()
  return rows
    .filter((plugin): plugin is CodexPluginInfo => Boolean(plugin))
    .filter((plugin) => {
      if (seen.has(plugin.id)) return false
      seen.add(plugin.id)
      return true
    })
    .sort((a, b) => Number(b.installed) - Number(a.installed) || a.displayName.localeCompare(b.displayName))
}

async function listConfiguredPluginsFromConfig(): Promise<CodexPluginInfo[]> {
  const configPath = path.join(CODEX_HOME, 'config.toml')
  const config = await fs.readFile(configPath, 'utf8').catch(() => '')
  const enabled = enabledPluginRefs(config)
  const toolCounts = await readToolCounts()

  const plugins = await Promise.all(enabled.map(async ({ name, marketplace }): Promise<CodexPluginInfo> => {
    const found = await findManifest(name, marketplace)
    const manifest = found?.manifest
    const displayName = manifest?.interface?.displayName ?? titleizePluginName(name)
    const description = manifest?.interface?.shortDescription ?? manifest?.description ?? manifest?.interface?.longDescription ?? ''
    const prompt = manifest?.interface?.defaultPrompt?.[0] ?? `Use the ${displayName} plugin for this task.`
    return {
      id: `${name}@${marketplace}`,
      name,
      displayName,
      description,
      prompt,
      icon: manifest?.interface?.composerIcon && found ? path.join(found.root, manifest.interface.composerIcon) : undefined,
      enabled: true,
      installed: true,
      marketplaceName: marketplace,
      toolCount: toolCounts.get(displayName.toLowerCase()) ?? toolCounts.get(name.replace(/-/g, ' ').toLowerCase()) ?? 0,
    }
  }))

  return plugins.sort((a, b) => a.displayName.localeCompare(b.displayName))
}

async function listConfiguredPlugins(): Promise<CodexPluginInfo[]> {
  return listPluginsFromCli().catch(() => listConfiguredPluginsFromConfig())
}

async function installCodexPlugin(selector: string): Promise<CodexPluginActionResult> {
  const pluginId = safePluginSelector(selector)
  const cliPath = await findCodexBinary()
  if (!cliPath) throw new Error('Codex CLI was not found on this machine.')

  const result = await run(cliPath, ['plugin', 'add', pluginId, '--json'], 120000, await makeCodexEnv())
  const output = parseJsonOutput<unknown>(result.stdout) ?? (result.stdout || result.stderr).trim()
  if (result.code !== 0) {
    const detail = (result.stderr || result.stdout).trim() || `Failed to install ${pluginId}.`
    throw new Error(detail)
  }
  return { ok: true, pluginId, output, message: `Installed ${pluginId}.` }
}

async function upgradeCodexPluginMarketplaces(): Promise<CodexPluginActionResult> {
  const cliPath = await findCodexBinary()
  if (!cliPath) throw new Error('Codex CLI was not found on this machine.')

  const result = await run(cliPath, ['plugin', 'marketplace', 'upgrade', '--json'], 180000, await makeCodexEnv())
  const output = parseJsonOutput<unknown>(result.stdout) ?? (result.stdout || result.stderr).trim()
  if (result.code !== 0) {
    const detail = (result.stderr || result.stdout).trim() || 'Failed to refresh Codex plugin marketplaces.'
    throw new Error(detail)
  }
  return { ok: true, output, message: 'Refreshed configured Codex plugin marketplaces.' }
}

function shouldUseFakeCodexClient(): boolean {
  return process.env.CRANBERRI_FAKE_CODEX === '1'
}

function attachCodexClientEventHandler(c: CodexClientLike): void {
  if (clientEventHandlerAttached) return
  c.on('event', (event: CodexEvent) => codexEventBroadcast?.(event))
  clientEventHandlerAttached = true
}

export async function getCodexClient(): Promise<CodexClientLike> {
  if (client) {
    await client.start()
    attachCodexClientEventHandler(client)
    return client
  }
  if (clientStarting) {
    while (clientStarting) {
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    if (!client) throw new Error('Codex client failed to start')
    attachCodexClientEventHandler(client)
    return client
  }

  clientStarting = true
  try {
    const newClient = shouldUseFakeCodexClient()
      ? new FakeCodexClient(process.cwd())
      : new CodexClient(process.cwd())
    await newClient.start()
    client = newClient
    attachCodexClientEventHandler(newClient)
    return newClient
  } finally {
    clientStarting = false
  }
}

export function initCodexIpc(mainWindowGetter: () => Electron.BrowserWindow | null): void {
  codexEventBroadcast = (event: CodexEvent) => {
    if (shouldPersistCodexEventTelemetry(event)) {
      void logTelemetry('main', 'codex:event', event).catch(() => undefined)
    }
    void recordToolEventsForCodexEvent(event).catch(() => undefined)
    if (!shouldForwardCodexEventToRenderer(event)) return
    const win = mainWindowGetter()
    if (win && !win.isDestroyed()) {
      win.webContents.send('codex:event', event)
    }
  }
  if (client) attachCodexClientEventHandler(client)

  ipcMain.handle('codex:plugins', async () => ({ plugins: await listConfiguredPlugins() }))
  ipcMain.handle('codex:skills', async () => ({ skills: await listCodexSkills() }))
  ipcMain.handle('codex:plugins:install', async (_, pluginId: string) => installCodexPlugin(pluginId))
  ipcMain.handle('codex:plugins:marketplaces:upgrade', async () => upgradeCodexPluginMarketplaces())

  ipcMain.handle('codex:connection:status', async () => {
    return getCodexConnectionStatus()
  })

  ipcMain.handle('codex:connection:connect', async () => {
    let status = await getCodexConnectionStatus()
    if (!status.installed || status.updateRequired) {
      await installCodexCli()
      status = await getCodexConnectionStatus()
    }
    const cliPath = status.cliPath ?? await findCodexBinary()
    if (!cliPath) throw new Error('Codex CLI installed, but Cranberri could not find it on this machine.')

    if (!status.authenticated) {
      const login = await run(cliPath, ['login', '--device-auth'], 120000, await makeCodexEnv())
      if (login.code !== 0) {
        const detail = (login.stderr || login.stdout).trim() || 'Codex login failed.'
        throw new Error(detail)
      }
    }

    client?.stop()
    client = null
    clientEventHandlerAttached = false
    return getCodexConnectionStatus()
  })

  ipcMain.handle('codex:pick-files', async () => {
    if (process.env.CRANBERRI_FAKE_PICK_FILES) {
      return { paths: process.env.CRANBERRI_FAKE_PICK_FILES.split(path.delimiter).filter(Boolean) }
    }
    const result = await dialog.showOpenDialog({
      title: 'Attach files or folders to Codex',
      properties: ['openFile', 'openDirectory', 'multiSelections'],
    })
    return result.canceled ? { paths: [] } : { paths: result.filePaths }
  })

  ipcMain.handle('codex:start', async (_, cwd: string) => {
    const c = await getCodexClient()
    c.setCwd(cwd)
    return { started: true }
  })

  ipcMain.handle('codex:create-thread', async (_, cwd: string, settings?: CodexTurnSettings) => {
    const c = await getCodexClient()
    const thread = await c.createThread(cwd, settings)
    return { threadId: thread.id, title: thread.name ?? null }
  })

  ipcMain.handle('codex:threads:list', async (_, cwd: string, options?: { archived?: boolean; cursor?: string | null; limit?: number; searchTerm?: string | null }) => {
    const c = await getCodexClient()
    return c.listThreads(cwd, options ?? {})
  })

  ipcMain.handle('codex:threads:read', async (_, cwd: string, threadId: string, archived?: boolean) => {
    const c = await getCodexClient()
    c.setCwd(cwd)
    return { thread: await c.readThread(threadId, archived) }
  })

  ipcMain.handle('codex:threads:resume', async (_, cwd: string, threadId: string, settings?: CodexTurnSettings) => {
    const c = await getCodexClient()
    return { thread: await c.resumeThread(threadId, cwd, settings) }
  })

  ipcMain.handle('codex:threads:archive', async (_, cwd: string, threadId: string) => {
    const c = await getCodexClient()
    c.setCwd(cwd)
    await c.archiveThread(threadId)
    return { ok: true }
  })

  ipcMain.handle('codex:threads:unarchive', async (_, cwd: string, threadId: string) => {
    const c = await getCodexClient()
    c.setCwd(cwd)
    return { thread: await c.unarchiveThread(threadId) }
  })

  ipcMain.handle('codex:threads:delete', async (_, cwd: string, threadId: string) => {
    const c = await getCodexClient()
    c.setCwd(cwd)
    await c.deleteThread(threadId)
    return { ok: true }
  })

  ipcMain.handle('codex:threads:rename', async (_, cwd: string, threadId: string, name: string) => {
    const c = await getCodexClient()
    c.setCwd(cwd)
    await c.setThreadName(threadId, name)
    return { ok: true }
  })

  ipcMain.handle('codex:send-message', async (_, cwd: string, threadId: string, input: CodexUserInput[], settings?: CodexTurnSettings) => {
    const c = await getCodexClient()
    c.setCwd(cwd)
    await c.sendMessage(threadId, input, settings)
    return { ok: true }
  })

  ipcMain.handle('codex:compact-thread', async (_, cwd: string, threadId: string) => {
    const c = await getCodexClient()
    c.setCwd(cwd)
    await c.compactThread(threadId)
    return { ok: true }
  })

  ipcMain.handle('codex:approve', async (_, cwd: string, threadId: string, event: unknown) => {
    const c = await getCodexClient()
    c.setCwd(cwd)
    await c.approve(event, threadId)
    return { ok: true }
  })

  ipcMain.handle('codex:interrupt', async (_, cwd: string, threadId: string) => {
    const c = await getCodexClient()
    c.setCwd(cwd)
    await c.interrupt(threadId)
    return { ok: true }
  })

  ipcMain.handle('codex:account:rateLimits', async () => {
    const c = await getCodexClient()
    return c.getRateLimits()
  })

  ipcMain.handle('codex:account:usage', async () => {
    const c = await getCodexClient()
    return c.getAccountUsage()
  })

  ipcMain.handle('codex:account:consumeResetCredit', async () => {
    const c = await getCodexClient()
    return c.consumeRateLimitResetCredit(randomUUID())
  })

  ipcMain.handle('tools:registry', async (_, threadId?: string | null, forceRefetch?: boolean) => {
    const c = await getCodexClient()
    const errors: string[] = []
    let appsResult: unknown
    let mcpResult: unknown
    let appListAvailable = false
    let mcpServerStatusAvailable = false

    try {
      appsResult = await c.listApps({ threadId: threadId ?? null, forceRefetch })
      appListAvailable = true
    } catch (error) {
      if (threadId && isThreadNotFoundError(error)) {
        try {
          appsResult = await c.listApps({ threadId: null, forceRefetch })
          appListAvailable = true
        } catch (fallbackError) {
          errors.push(registryErrorMessage(fallbackError, 'App list unavailable'))
        }
      } else {
        errors.push(registryErrorMessage(error, 'App list unavailable'))
      }
    }

    try {
      mcpResult = await c.listMcpServerStatus({ threadId: threadId ?? null })
      mcpServerStatusAvailable = true
    } catch (error) {
      if (threadId && isThreadNotFoundError(error)) {
        try {
          mcpResult = await c.listMcpServerStatus({ threadId: null })
          mcpServerStatusAvailable = true
        } catch (fallbackError) {
          errors.push(registryErrorMessage(fallbackError, 'MCP server status unavailable'))
        }
      } else {
        errors.push(registryErrorMessage(error, 'MCP server status unavailable'))
      }
    }

    return normalizeToolRegistrySnapshot({
      appsResult,
      mcpResult,
      appListAvailable,
      mcpServerStatusAvailable,
      errors,
    })
  })

  ipcMain.handle('codex:stop', async () => {
    client?.stop()
    client = null
    clientEventHandlerAttached = false
    return { stopped: true }
  })
}

export function stopCodexClient(): void {
  client?.stop()
  client = null
  clientEventHandlerAttached = false
}
