import { dialog, ipcMain } from 'electron'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { CodexClient } from './client'
import type { CodexEvent, CodexPluginInfo, CodexTurnSettings } from '../../shared/codex'
import { randomUUID } from 'node:crypto'

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

const CODEX_HOME = process.env.CODEX_HOME ?? path.join(os.homedir(), '.codex')

let client: CodexClient | null = null
let clientStarting = false

function titleizePluginName(name: string): string {
  return name
    .split(/[-_]/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

async function readJson<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8')) as T
  } catch {
    return null
  }
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

async function listConfiguredPlugins(): Promise<CodexPluginInfo[]> {
  const configPath = path.join(CODEX_HOME, 'config.toml')
  const config = await fs.readFile(configPath, 'utf8').catch(() => '')
  const enabled = [...config.matchAll(/^\[plugins\."([^"@]+)@([^"]+)"\]\n(?:[^[]*?enabled\s*=\s*true)?/gm)]
    .filter((match) => match[0].includes('enabled = true'))
    .map((match) => ({ name: match[1], marketplace: match[2] }))
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
      toolCount: toolCounts.get(displayName.toLowerCase()) ?? toolCounts.get(name.replace(/-/g, ' ').toLowerCase()) ?? 0,
    }
  }))

  return plugins.sort((a, b) => a.displayName.localeCompare(b.displayName))
}

async function getClient(): Promise<CodexClient> {
  if (client) {
    await client.start()
    return client
  }
  if (clientStarting) {
    while (clientStarting) {
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    if (!client) throw new Error('Codex client failed to start')
    return client
  }

  clientStarting = true
  try {
    const newClient = new CodexClient(process.cwd())
    await newClient.start()
    client = newClient
    return newClient
  } finally {
    clientStarting = false
  }
}

export function initCodexIpc(mainWindowGetter: () => Electron.BrowserWindow | null): void {
  const broadcast = (event: CodexEvent) => {
    const win = mainWindowGetter()
    if (win && !win.isDestroyed()) {
      win.webContents.send('codex:event', event)
    }
  }

  // forward all events from the single persistent client
  getClient().then((c) => {
    c.on('event', (event: CodexEvent) => broadcast(event))
  }).catch((err) => console.error('Failed to start persistent Codex client:', err))

  ipcMain.handle('codex:plugins', async () => ({ plugins: await listConfiguredPlugins() }))

  ipcMain.handle('codex:pick-files', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Attach files or folders to Codex',
      properties: ['openFile', 'openDirectory', 'multiSelections'],
    })
    return result.canceled ? { paths: [] } : { paths: result.filePaths }
  })

  ipcMain.handle('codex:start', async (_, cwd: string) => {
    const c = await getClient()
    c.setCwd(cwd)
    return { started: true }
  })

  ipcMain.handle('codex:create-thread', async (_, cwd: string) => {
    const c = await getClient()
    const thread = await c.createThread(cwd)
    return { threadId: thread.id }
  })

  ipcMain.handle('codex:threads:list', async (_, cwd: string, options?: { archived?: boolean; cursor?: string | null; limit?: number; searchTerm?: string | null }) => {
    const c = await getClient()
    return c.listThreads(cwd, options ?? {})
  })

  ipcMain.handle('codex:threads:read', async (_, cwd: string, threadId: string, archived?: boolean) => {
    const c = await getClient()
    c.setCwd(cwd)
    return { thread: await c.readThread(threadId, archived) }
  })

  ipcMain.handle('codex:threads:resume', async (_, cwd: string, threadId: string, settings?: CodexTurnSettings) => {
    const c = await getClient()
    return { thread: await c.resumeThread(threadId, cwd, settings) }
  })

  ipcMain.handle('codex:threads:archive', async (_, cwd: string, threadId: string) => {
    const c = await getClient()
    c.setCwd(cwd)
    await c.archiveThread(threadId)
    return { ok: true }
  })

  ipcMain.handle('codex:threads:unarchive', async (_, cwd: string, threadId: string) => {
    const c = await getClient()
    c.setCwd(cwd)
    return { thread: await c.unarchiveThread(threadId) }
  })

  ipcMain.handle('codex:threads:delete', async (_, cwd: string, threadId: string) => {
    const c = await getClient()
    c.setCwd(cwd)
    await c.deleteThread(threadId)
    return { ok: true }
  })

  ipcMain.handle('codex:threads:rename', async (_, cwd: string, threadId: string, name: string) => {
    const c = await getClient()
    c.setCwd(cwd)
    await c.setThreadName(threadId, name)
    return { ok: true }
  })

  ipcMain.handle('codex:send-message', async (_, cwd: string, threadId: string, content: string, settings?: CodexTurnSettings) => {
    const c = await getClient()
    c.setCwd(cwd)
    await c.sendMessage(threadId, content, settings)
    return { ok: true }
  })

  ipcMain.handle('codex:approve', async (_, cwd: string, threadId: string, approvalId: string) => {
    const c = await getClient()
    c.setCwd(cwd)
    await c.approve(approvalId, threadId)
    return { ok: true }
  })

  ipcMain.handle('codex:interrupt', async (_, cwd: string, threadId: string) => {
    const c = await getClient()
    c.setCwd(cwd)
    await c.abort(threadId)
    return { ok: true }
  })

  ipcMain.handle('codex:account:rateLimits', async () => {
    const c = await getClient()
    return c.getRateLimits()
  })

  ipcMain.handle('codex:account:consumeResetCredit', async () => {
    const c = await getClient()
    return c.consumeRateLimitResetCredit(randomUUID())
  })

  ipcMain.handle('codex:stop', async () => {
    client?.stop()
    client = null
    return { stopped: true }
  })
}

export function stopCodexClient(): void {
  client?.stop()
  client = null
}
