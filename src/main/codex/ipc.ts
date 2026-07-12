import { dialog, ipcMain } from 'electron'
import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { CodexClient } from './client'
import { makeCodexEnv } from './env'
import { FakeCodexClient } from './fakeClient'
import type { CodexConnectionStatus, CodexEvent, CodexPluginActionResult, CodexPluginInfo, CodexRuntimeContext, CodexSkillInfo, CodexTurnSettings, CodexUserInput } from '../../shared/codex'
import {
  toolCatalogListRequestSchema,
  toolCatalogTestRequestSchema,
  metadataOnlyToolEvent,
  type ToolCatalogSnapshot,
  type ToolCatalogRegistryEvidence,
  type ToolCatalogTaskKey,
  type ToolEventRecord,
  type ToolRegistryApp,
  type ToolRegistryMcpServer,
  type ToolRegistrySnapshot,
} from '../../shared/tools'
import { randomUUID } from 'node:crypto'
import { logTelemetry } from '../telemetry'
import {
  createApprovalCompletedEvent,
  normalizeToolRegistrySnapshot,
  recordToolEventRecords,
  toolEventsFromCodexEvent,
} from '../tools'
import { readSettings } from '../settings'
import {
  ToolCatalogService,
  isTrustedCatalogIpcSender,
  type ToolCatalogRequestContext,
} from '../tool-catalog-service'
import { shouldForwardCodexEventToRenderer, shouldPersistCodexEventTelemetry } from './eventPolicy'
import type { CodexWorkerControlAction } from '../../shared/codex-worker-control'
import {
  MINIMUM_GPT_56_CODEX_VERSION,
  codexCliNeedsUpdate,
  parseCodexCliVersion,
} from './version'
import {
  taskHistoryRequestSchema,
  taskIdRequestSchema,
  localTaskAdoptRequestSchema,
  localTaskDraftRequestSchema,
  taskListRequestSchema,
  taskReadRequestSchema,
  taskSendRequestSchema,
  taskContinueInWorktreeRequestSchema,
  taskDraftRequestSchema,
  taskHandoffRequestSchema,
  taskProvisionRequestSchema,
  firstTurnIdempotencyKey,
  firstTurnRecoveryAction,
  persistedFirstTurnState,
  taskFirstTurnIdempotencyKey,
  withoutFirstTurnIdempotencyKey,
  type Task,
} from '../../shared/tasks'
import { readProjectRegistry, writeProjectRegistry } from '../repos'
import { HandoffCoordinator } from '../handoff'
import { EnvironmentToolRouter, environmentDynamicTools } from '../environments/tools'
import { normalizeEnvironmentToml } from '../environments/parser'
import { environmentDefaultRequestSchema, environmentIdentityRequestSchema, environmentProjectRequestSchema, environmentRevisionRequestSchema, environmentSaveRequestSchema } from '../../shared/environments'
import { projectIdRequestSchema } from '../../shared/worktrees'
import { gitStatusPorcelain, listSelectableRefs, refreshGitRefs } from '../git-worktrees'
import { taskCoordinator, taskStore, environmentRunner, environmentStore, worktreeLifecycle } from '../worktree-runtime'
import { assertTaskRunnable } from '../tasks'
import { authorityChangedEventSchema } from '../../shared/state-events'

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
let taskAuthorityWindowGetter: (() => Electron.BrowserWindow | null) | null = null
let taskAuthoritySubscribed = false
let capabilityEpochCounter = 0
const MAX_CATALOG_TASK_CONTEXTS = 100
const MAX_PENDING_TOOL_APPROVALS = 100

const catalogProjectRoots = new Set<string>()
const capabilityEpochByThread = new Map<string, string>()
const registryFingerprintByThread = new Map<string, string>()
const registryAppsByContext = new Map<string, ToolRegistryApp[]>()
const registryMcpByContext = new Map<string, ToolRegistryMcpServer[]>()
const pendingApprovalToolEvents = new Map<string, ToolEventRecord>()
const firstTurnCreationByKey = new Map<string, Promise<Task>>()
const firstTurnSendByKey = new Map<string, Promise<unknown>>()
let idleRegistryGeneration = 0
let idleRegistryResult: ToolRegistryLoadResult | null = null
let idleRegistryLoad: Promise<ToolRegistryLoadResult> | null = null
const toolCatalogService = new ToolCatalogService({
  projectRoots: () => [...catalogProjectRoots],
})
let environmentToolClient: CodexClient | null = null

export function activeCodexTaskBlockers(tasks: ReadonlyArray<{ id: string; threadId: string | null }>): string[] {
  if (!client) return []
  return tasks.flatMap((task) => {
    if (!task.threadId) return []
    if (client?.isThreadRunning(task.threadId)) return [`Codex is still running in task ${task.id}`]
    if (client?.hasActiveWorkers(task.threadId)) return [`Codex workers are still active in task ${task.id}`]
    return []
  })
}

async function approveEnvironmentTool(
  mainWindowGetter: () => Electron.BrowserWindow | null,
  approval: import('../environments/tools').EnvironmentToolApproval,
): Promise<boolean> {
  const detail = approval.kind === 'trust-revision'
    ? `Run environment ${approval.environmentId} at revision ${approval.revision} for project ${approval.projectId}?`
    : `Delete environment ${approval.environmentId} from project ${approval.projectId}?`
  const options: Electron.MessageBoxOptions = {
    type: 'warning',
    title: approval.kind === 'trust-revision' ? 'Run environment test' : 'Delete environment',
    message: detail,
    buttons: ['Cancel', approval.kind === 'trust-revision' ? 'Approve and run' : 'Delete'],
    cancelId: 0,
    defaultId: 0,
    noLink: true,
  }
  const owner = mainWindowGetter()
  const result = owner
    ? await dialog.showMessageBox(owner, options)
    : await dialog.showMessageBox(options)
  return result.response === 1
}

function ensureEnvironmentToolRouter(
  candidate: CodexClientLike,
  mainWindowGetter: () => Electron.BrowserWindow | null,
): void {
  if (!(candidate instanceof CodexClient) || environmentToolClient === candidate) return
  const router = new EnvironmentToolRouter({
    taskStore,
    store: environmentStore,
    runner: environmentRunner,
    approve: (approval) => approveEnvironmentTool(mainWindowGetter, approval),
  })
  candidate.registerRequestHandler('item/tool/call', async (params) => {
    const threadId = typeof params.threadId === 'string' ? params.threadId : ''
    const task = taskCoordinator.findByThread(threadId)
    if (!task) throw new Error('Dynamic tool call is not bound to a Cranberri task')
    return router.handle(params, task)
  })
  environmentToolClient = candidate
}

interface ToolRegistryLoadResult {
  snapshot: ToolRegistrySnapshot
  scope: ToolCatalogRegistryEvidence['scope']
  runtimeConnected: boolean
}

function registryContextKey(threadId: string | null): string {
  return threadId ?? '__global__'
}

function retainLastRegistryEvidence(
  threadId: string | null,
  snapshot: ToolRegistrySnapshot,
  scope: ToolCatalogRegistryEvidence['scope'],
  runtimeConnected = true,
): ToolRegistryLoadResult {
  const key = registryContextKey(threadId)
  let usedCachedEvidence = false
  let apps = snapshot.apps
  let mcpServers = snapshot.mcpServers

  if (snapshot.capabilities.appList) registryAppsByContext.set(key, snapshot.apps)
  else if (registryAppsByContext.has(key)) {
    apps = registryAppsByContext.get(key) ?? []
    usedCachedEvidence = true
  }
  if (snapshot.capabilities.mcpServerStatus) registryMcpByContext.set(key, snapshot.mcpServers)
  else if (registryMcpByContext.has(key)) {
    mcpServers = registryMcpByContext.get(key) ?? []
    usedCachedEvidence = true
  }

  return {
    snapshot: { ...snapshot, apps, mcpServers },
    scope: usedCachedEvidence && scope !== 'stale-thread-fallback'
      ? 'stale-thread-fallback'
      : scope,
    runtimeConnected,
  }
}

function forgetCatalogThread(threadId: string): void {
  capabilityEpochByThread.delete(threadId)
  registryFingerprintByThread.delete(threadId)
  registryAppsByContext.delete(registryContextKey(threadId))
  registryMcpByContext.delete(registryContextKey(threadId))
  for (const [key, event] of pendingApprovalToolEvents) {
    if (event.threadId === threadId) pendingApprovalToolEvents.delete(key)
  }
}

function trimCatalogTaskState(): void {
  const orderedThreadIds = new Set([
    ...capabilityEpochByThread.keys(),
    ...registryFingerprintByThread.keys(),
  ])
  while (orderedThreadIds.size > MAX_CATALOG_TASK_CONTEXTS) {
    const oldestThreadId = orderedThreadIds.values().next().value
    if (typeof oldestThreadId !== 'string') return
    orderedThreadIds.delete(oldestThreadId)
    forgetCatalogThread(oldestThreadId)
  }
}

function clearCatalogTaskState(): void {
  idleRegistryGeneration += 1
  idleRegistryResult = null
  idleRegistryLoad = null
  capabilityEpochByThread.clear()
  registryFingerprintByThread.clear()
  registryAppsByContext.clear()
  registryMcpByContext.clear()
  pendingApprovalToolEvents.clear()
}

function approvalEventKey(threadId: string, reviewId: string): string {
  return `${threadId}:${reviewId}`
}

function correlatedToolEvents(event: CodexEvent): ToolEventRecord[] {
  if (event.type === 'approval_completed') {
    const key = approvalEventKey(event.threadId, event.reviewId)
    const pending = pendingApprovalToolEvents.get(key)
    pendingApprovalToolEvents.delete(key)
    const completed = createApprovalCompletedEvent(event.threadId, event.reviewId, event.action, pending)
    return completed ? [metadataOnlyToolEvent(completed)] : []
  }

  const records = toolEventsFromCodexEvent(event).map(metadataOnlyToolEvent)
  if (event.type === 'approval_request') {
    const pending = records.find((record) => record.catalogId && record.reviewId)
    if (pending?.reviewId) {
      while (pendingApprovalToolEvents.size >= MAX_PENDING_TOOL_APPROVALS) {
        const oldestKey = pendingApprovalToolEvents.keys().next().value
        if (typeof oldestKey !== 'string') break
        pendingApprovalToolEvents.delete(oldestKey)
      }
      pendingApprovalToolEvents.set(approvalEventKey(event.threadId, pending.reviewId), pending)
    }
  }
  return records
}

function rememberCatalogProjectRoot(cwd: string): void {
  if (!path.isAbsolute(cwd)) return
  const resolved = path.resolve(cwd)
  if (path.dirname(resolved) !== resolved) catalogProjectRoots.add(resolved)
}

function advanceCapabilityEpoch(threadId: string): ToolCatalogTaskKey {
  capabilityEpochCounter += 1
  const capabilityEpoch = `local-${capabilityEpochCounter}`
  capabilityEpochByThread.delete(threadId)
  capabilityEpochByThread.set(threadId, capabilityEpoch)
  trimCatalogTaskState()
  return { threadId, capabilityEpoch }
}

function catalogTaskKey(threadId: string | null): ToolCatalogTaskKey | null {
  if (!threadId) return null
  const capabilityEpoch = capabilityEpochByThread.get(threadId)
  return capabilityEpoch
    ? { threadId, capabilityEpoch }
    : advanceCapabilityEpoch(threadId)
}

function advanceKnownCapabilityEpochs(): void {
  for (const threadId of [...capabilityEpochByThread.keys()]) advanceCapabilityEpoch(threadId)
}

function catalogRegistryFingerprint(snapshot: ToolRegistrySnapshot): string {
  return JSON.stringify({
    apps: snapshot.apps.map((app) => app.id).sort(),
    mcpServers: snapshot.mcpServers
      .map((server) => ({
        name: server.name,
        authStatus: server.authStatus,
        tools: server.tools.map((tool) => tool.name).sort(),
      }))
      .sort((left, right) => left.name.localeCompare(right.name)),
  })
}

function expectedRendererEntryUrl(): string {
  return process.env.ELECTRON_VITE_DEV_SERVER_URL ?? 'cranberri://renderer/index.html'
}

function authorizeCatalogIpc(
  event: Electron.IpcMainInvokeEvent,
  mainWindowGetter: () => Electron.BrowserWindow | null,
): void {
  if (!isTrustedCatalogIpcSender(event, mainWindowGetter(), expectedRendererEntryUrl())) {
    throw new Error('Unauthorized tool catalog IPC sender')
  }
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

function existingTaskForFirstTurn(projectId: string, input: readonly Record<string, unknown>[]): Task | null {
  const idempotencyKey = firstTurnIdempotencyKey(input)
  if (!idempotencyKey) return null
  return taskCoordinator.list(projectId).find((task) => (
    task.state !== 'removed' && taskFirstTurnIdempotencyKey(task) === idempotencyKey
  )) ?? null
}

async function createTaskIdempotently(
  projectId: string,
  input: readonly Record<string, unknown>[],
  create: () => Promise<Task>,
): Promise<Task> {
  const existing = existingTaskForFirstTurn(projectId, input)
  if (existing) return existing
  const idempotencyKey = firstTurnIdempotencyKey(input)
  if (!idempotencyKey) return create()
  const creationKey = `${projectId}:${idempotencyKey}`
  const inFlight = firstTurnCreationByKey.get(creationKey)
  if (inFlight) return inFlight
  const creation = (async () => existingTaskForFirstTurn(projectId, input) ?? await create())()
  firstTurnCreationByKey.set(creationKey, creation)
  try {
    return await creation
  } finally {
    if (firstTurnCreationByKey.get(creationKey) === creation) firstTurnCreationByKey.delete(creationKey)
  }
}

async function runFirstTurnSendIdempotently<T>(
  idempotencyKey: string | null,
  send: () => Promise<T>,
): Promise<T> {
  if (!idempotencyKey) return send()
  const inFlight = firstTurnSendByKey.get(idempotencyKey) as Promise<T> | undefined
  if (inFlight) return inFlight
  const sending = send()
  firstTurnSendByKey.set(idempotencyKey, sending)
  try {
    return await sending
  } finally {
    if (firstTurnSendByKey.get(idempotencyKey) === sending) firstTurnSendByKey.delete(idempotencyKey)
  }
}

async function acknowledgeFirstTurn(taskId: string, idempotencyKey: string): Promise<Task> {
  const state = await taskStore.update((current) => ({
    ...current,
    tasks: current.tasks.map((task) => task.id === taskId
      ? {
          ...task,
          pendingFirstTurn: null,
          firstTurnIdempotencyKey: idempotencyKey,
          updatedAt: Date.now(),
        }
      : task),
  }))
  const task = state.tasks.find((candidate) => candidate.id === taskId)
  if (!task) throw new Error(`Task not found: ${taskId}`)
  return task
}

async function readPersistedFirstTurn(
  candidate: CodexClientLike,
  threadId: string | null,
  expectedInput: readonly Record<string, unknown>[],
): Promise<ReturnType<typeof persistedFirstTurnState> | 'missing'> {
  if (!threadId) return 'empty'
  try {
    return persistedFirstTurnState((await candidate.readThread(threadId)).turns, expectedInput)
  } catch (error) {
    if (isThreadNotFoundError(error)) return 'missing'
    throw error
  }
}

function pendingFirstTurnThreadName(idempotencyKey: string): string {
  return `Cranberri pending ${idempotencyKey}`
}

async function createOrRecoverFirstTurnThread(
  candidate: CodexClientLike,
  task: Task,
  runtime: CodexRuntimeContext,
): Promise<{ id: string }> {
  const idempotencyKey = taskFirstTurnIdempotencyKey(task)
  if (!idempotencyKey) return candidate.createThread(runtime)
  const marker = pendingFirstTurnThreadName(idempotencyKey)
  const history = await candidate.listThreads(runtime.cwd, { limit: 100, searchTerm: marker })
  const recovered = history.sessions.find((session) => session.title === marker && session.turnCount === 0)
  if (recovered) return { id: recovered.id }

  const thread = await candidate.createThread(runtime)
  try {
    await candidate.setThreadName(thread.id, marker)
  } catch (error) {
    await candidate.deleteThread(thread.id).catch(() => undefined)
    throw error
  }
  return thread
}

async function finalizeFirstTurnThreadName(
  candidate: CodexClientLike,
  threadId: string,
  input: readonly Record<string, unknown>[],
): Promise<void> {
  const textItem = [...input].reverse().find((item) => item.type === 'text' && typeof item.text === 'string')
  if (!textItem || typeof textItem.text !== 'string') return
  const title = textItem.text
  await candidate.setThreadName(threadId, title.trim().split('\n')[0]?.slice(0, 160) || 'New session')
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

async function loadToolRegistry(
  threadId: string | null,
  forceRefetch = false,
): Promise<ToolRegistryLoadResult> {
  let c: CodexClientLike
  try {
    c = await getCodexClient()
  } catch (error) {
    const snapshot = normalizeToolRegistrySnapshot({
      appListAvailable: false,
      mcpServerStatusAvailable: false,
      errors: [registryErrorMessage(error, 'Codex registry unavailable')],
    })
    return retainLastRegistryEvidence(
      threadId,
      snapshot,
      threadId ? 'stale-thread-fallback' : 'global',
      false,
    )
  }
  const [apps, mcp] = await Promise.all([
    (async () => {
      try {
        return {
          result: await c.listApps({ threadId, forceRefetch }),
          available: true,
          usedStaleThreadFallback: false,
          errors: [] as string[],
        }
      } catch (error) {
        if (threadId && isThreadNotFoundError(error)) {
          try {
            return {
              result: await c.listApps({ threadId: null, forceRefetch }),
              available: true,
              usedStaleThreadFallback: true,
              errors: [] as string[],
            }
          } catch (fallbackError) {
            return {
              result: undefined,
              available: false,
              usedStaleThreadFallback: true,
              errors: [registryErrorMessage(fallbackError, 'App list unavailable')],
            }
          }
        }
        return {
          result: undefined,
          available: false,
          usedStaleThreadFallback: false,
          errors: [registryErrorMessage(error, 'App list unavailable')],
        }
      }
    })(),
    (async () => {
      try {
        return {
          result: await c.listMcpServerStatus({ threadId }),
          available: true,
          usedStaleThreadFallback: false,
          errors: [] as string[],
        }
      } catch (error) {
        if (threadId && isThreadNotFoundError(error)) {
          try {
            return {
              result: await c.listMcpServerStatus({ threadId: null }),
              available: true,
              usedStaleThreadFallback: true,
              errors: [] as string[],
            }
          } catch (fallbackError) {
            return {
              result: undefined,
              available: false,
              usedStaleThreadFallback: true,
              errors: [registryErrorMessage(fallbackError, 'MCP server status unavailable')],
            }
          }
        }
        return {
          result: undefined,
          available: false,
          usedStaleThreadFallback: false,
          errors: [registryErrorMessage(error, 'MCP server status unavailable')],
        }
      }
    })(),
  ])

  const errors = [...apps.errors, ...mcp.errors]
  const usedStaleThreadFallback = apps.usedStaleThreadFallback || mcp.usedStaleThreadFallback

  const snapshot = normalizeToolRegistrySnapshot({
    appsResult: apps.result,
    mcpResult: mcp.result,
    appListAvailable: apps.available,
    mcpServerStatusAvailable: mcp.available,
    errors,
  })
  return retainLastRegistryEvidence(
    threadId,
    snapshot,
    threadId
      ? usedStaleThreadFallback ? 'stale-thread-fallback' : 'active-task'
      : 'global',
  )
}

function loadIdleToolRegistry(forceRefetch = false): Promise<ToolRegistryLoadResult> {
  if (!forceRefetch && idleRegistryResult) return Promise.resolve(idleRegistryResult)
  if (!forceRefetch && idleRegistryLoad) return idleRegistryLoad

  const generation = ++idleRegistryGeneration
  const request = loadToolRegistry(null, forceRefetch)
    .then((result) => {
      if (generation === idleRegistryGeneration) idleRegistryResult = result
      return result
    })
    .finally(() => {
      if (idleRegistryLoad === request) idleRegistryLoad = null
    })
  idleRegistryLoad = request
  return request
}

async function loadToolCatalogContext(
  activeThreadId: string | null,
  forceRefetch: boolean,
): Promise<ToolCatalogRequestContext> {
  let registry: ToolRegistryLoadResult

  if (!activeThreadId && !forceRefetch) {
    let runtimeConnected = false
    try {
      await getCodexClient()
      runtimeConnected = true
    } catch {
      // The local CLI catalog still remains useful when Codex cannot start.
    }
    if (runtimeConnected && idleRegistryResult) {
      registry = idleRegistryResult
    } else if (runtimeConnected && idleRegistryLoad) {
      registry = await idleRegistryLoad
    } else {
      if (runtimeConnected) void loadIdleToolRegistry().catch(() => undefined)
      const observedAt = new Date().toISOString()
      return {
        taskKey: null,
        runtimeConnected,
        preferences: readSettings().tools,
        registryEvidence: [],
        registryFailure: runtimeConnected
          ? null
          : { code: 'runtime-unavailable', observedAt },
      }
    }
  } else if (!activeThreadId) {
    registry = await loadIdleToolRegistry(forceRefetch)
  } else {
    registry = await loadToolRegistry(activeThreadId, forceRefetch)
  }
  let taskKey = catalogTaskKey(activeThreadId)

  if (
    activeThreadId
    && registry.scope === 'active-task'
    && registry.snapshot.capabilities.appList
    && registry.snapshot.capabilities.mcpServerStatus
  ) {
    const fingerprint = catalogRegistryFingerprint(registry.snapshot)
    const previousFingerprint = registryFingerprintByThread.get(activeThreadId)
    if (previousFingerprint && previousFingerprint !== fingerprint) {
      taskKey = advanceCapabilityEpoch(activeThreadId)
    }
    registryFingerprintByThread.delete(activeThreadId)
    registryFingerprintByThread.set(activeThreadId, fingerprint)
    trimCatalogTaskState()
  }

  const observedAt = new Date().toISOString()
  const registryEvidence: ToolCatalogRegistryEvidence[] = registry.scope === 'active-task'
    ? taskKey
      ? [{ scope: 'active-task', taskKey, observedAt, snapshot: registry.snapshot }]
      : []
    : [{ scope: registry.scope, taskKey: null, observedAt, snapshot: registry.snapshot }]

  return {
    taskKey,
    runtimeConnected: registry.runtimeConnected,
    preferences: readSettings().tools,
    registryEvidence,
    registryFailure: registry.snapshot.capabilities.errors.length
      ? { code: 'registry-unavailable', observedAt }
      : null,
  }
}

export function initCodexIpc(mainWindowGetter: () => Electron.BrowserWindow | null): void {
  taskAuthorityWindowGetter = mainWindowGetter
  if (!taskAuthoritySubscribed) {
    taskAuthoritySubscribed = true
    taskStore.subscribe((change) => {
      const win = taskAuthorityWindowGetter?.()
      if (!win || win.isDestroyed()) return
      const event = authorityChangedEventSchema.parse({ authority: 'tasks', ...change })
      win.webContents.send('state:authority-changed', event)
    })
  }
  codexEventBroadcast = (event: CodexEvent) => {
    if (event.type === 'run_end' && event.threadId) {
      const task = taskCoordinator.findByThread(event.threadId)
      if (task?.location === 'local') {
        void taskCoordinator.releaseLocalLease(task.projectId, task.id).catch(() => undefined)
      }
    }
    const toolRecords = correlatedToolEvents(event)
    if (shouldPersistCodexEventTelemetry(event)) {
      void logTelemetry('main', 'codex:event', event).catch(() => undefined)
    }
    void recordToolEventRecords(toolRecords).catch(() => undefined)
    if (!shouldForwardCodexEventToRenderer(event)) return
    const win = mainWindowGetter()
    if (win && !win.isDestroyed()) {
      const toolEvents = toolRecords.map((record): CodexEvent => ({
        type: 'tool_event',
        threadId: record.threadId,
        event: record,
      }))
      const outboundEvents = event.type === 'tool_event' ? toolEvents : [...toolEvents, event]
      for (const outboundEvent of outboundEvents) win.webContents.send('codex:event', outboundEvent)
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
    advanceKnownCapabilityEpochs()
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

  const localCheckout = (projectId: string) => {
    const registry = readProjectRegistry()
    const project = registry.projects.find((candidate) => candidate.id === projectId)
    if (!project) throw new Error('Project not found')
    const checkout = registry.checkouts.find((candidate) => candidate.id === project.localCheckoutId)
    if (!checkout?.available) throw new Error('Local checkout unavailable')
    return { registry, project, checkout }
  }

  const taskSnapshot = async () => {
    const registry = readProjectRegistry()
    const store = taskStore.read()
    const managedCheckouts = store.managedWorktrees
      .filter((worktree) => worktree.lifecycle !== 'removed')
      .map((worktree) => ({
        id: worktree.checkoutId,
        projectId: worktree.projectId,
        kind: 'managed' as const,
        canonicalPath: worktree.path,
        gitCommonDir: worktree.gitCommonDir,
        ownership: 'cranberri' as const,
        available: worktree.lifecycle !== 'failed' && worktree.lifecycle !== 'needsAttention',
      }))
    return {
      revision: store.revision,
      projects: registry.projects,
      checkouts: [...registry.checkouts, ...managedCheckouts],
      tasks: store.tasks,
      managedWorktrees: store.managedWorktrees,
    }
  }

  ipcMain.handle('worktrees:refs:list', async (_, raw: unknown) => {
    const { projectId } = projectIdRequestSchema.parse(raw)
    const { checkout } = localCheckout(projectId)
    return { refs: await listSelectableRefs(checkout.canonicalPath) }
  })

  ipcMain.handle('worktrees:refs:refresh', async (_, raw: unknown) => {
    const { projectId } = projectIdRequestSchema.parse(raw)
    const { checkout } = localCheckout(projectId)
    const refresh = await refreshGitRefs(checkout.canonicalPath)
    return { refresh, refs: await listSelectableRefs(checkout.canonicalPath) }
  })

  ipcMain.handle('environments:list', (_, raw: unknown) => {
    const { projectId } = environmentProjectRequestSchema.parse(raw)
    return {
      environments: environmentStore.list(projectId).map((manifest) => ({
        manifest,
        profile: environmentStore.readRevision(projectId, manifest.environmentId, manifest.currentRevision),
      })),
    }
  })

  ipcMain.handle('environments:read', (_, raw: unknown) => {
    const { projectId, environmentId } = environmentIdentityRequestSchema.parse(raw)
    const manifest = environmentStore.readManifest(projectId, environmentId)
    return { manifest, profile: environmentStore.readRevision(projectId, environmentId, manifest.currentRevision) }
  })

  ipcMain.handle('environments:save', (_, raw: unknown) => {
    const request = environmentSaveRequestSchema.parse(raw)
    const manifest = environmentStore.save(
      request.projectId,
      request.environmentId,
      normalizeEnvironmentToml(request.profile),
    )
    return { manifest, profile: environmentStore.readRevision(request.projectId, request.environmentId, manifest.currentRevision) }
  })

  ipcMain.handle('environments:trust', (_, raw: unknown) => {
    const request = environmentRevisionRequestSchema.parse(raw)
    return { manifest: environmentStore.trust(request.projectId, request.environmentId, request.revision) }
  })

  ipcMain.handle('environments:delete', (_, raw: unknown) => {
    const request = environmentIdentityRequestSchema.parse(raw)
    const state = taskStore.read()
    environmentStore.delete(request.projectId, request.environmentId, {
      references: state.tasks.flatMap((task) => task.environmentId === request.environmentId && task.environmentRevision
        ? [{ projectId: task.projectId, environmentId: task.environmentId, revision: task.environmentRevision }]
        : []),
    })
    const registry = readProjectRegistry()
    const project = registry.projects.find((candidate) => candidate.id === request.projectId)
    if (project?.defaultEnvironmentId === request.environmentId) {
      writeProjectRegistry({
        ...registry,
        projects: registry.projects.map((candidate) => candidate.id === project.id
          ? { ...candidate, defaultEnvironmentId: null }
          : candidate),
      })
    }
    return { ok: true }
  })

  ipcMain.handle('environments:set-default', (_, raw: unknown) => {
    const request = environmentDefaultRequestSchema.parse(raw)
    const registry = readProjectRegistry()
    if (request.environmentId) environmentStore.readManifest(request.projectId, request.environmentId)
    if (!registry.projects.some((candidate) => candidate.id === request.projectId)) throw new Error('Project not found')
    const updated = writeProjectRegistry({
      ...registry,
      projects: registry.projects.map((project) => project.id === request.projectId
        ? { ...project, defaultEnvironmentId: request.environmentId }
        : project),
    })
    return { project: updated.projects.find((project) => project.id === request.projectId)! }
  })

  ipcMain.handle('tasks:snapshot', () => taskSnapshot())

  ipcMain.handle('tasks:create-worktree-draft', async (_, raw: unknown) => {
    const request = taskDraftRequestSchema.parse(raw)
    const task = await createTaskIdempotently(
      request.projectId,
      request.input,
      () => taskCoordinator.createWorktreeDraft(request),
    )
    return { task }
  })

  ipcMain.handle('tasks:create-local-draft', async (_, raw: unknown) => {
    const request = localTaskDraftRequestSchema.parse(raw)
    const task = await createTaskIdempotently(request.projectId, request.input, async () => {
      const { project, checkout } = localCheckout(request.projectId)
      return taskCoordinator.createLocalTask({
        projectId: request.projectId,
        title: request.title,
        localCheckoutId: checkout.id,
        baseRef: project.pinnedLocalBranch ? `refs/heads/${project.pinnedLocalBranch}` : null,
        input: request.input,
      })
    })
    return {
      task,
    }
  })

  ipcMain.handle('tasks:adopt-local-thread', async (_, raw: unknown) => {
    const request = localTaskAdoptRequestSchema.parse(raw)
    const { project, checkout } = localCheckout(request.projectId)
    return {
      task: await taskCoordinator.createLocalTask({
        projectId: request.projectId,
        title: 'Local session',
        localCheckoutId: checkout.id,
        baseRef: project.pinnedLocalBranch ? `refs/heads/${project.pinnedLocalBranch}` : null,
        input: [],
        threadId: request.threadId,
        archived: request.archived,
      }),
    }
  })

  ipcMain.handle('tasks:provision', async (_, raw: unknown) => {
    const request = taskProvisionRequestSchema.parse(raw)
    const task = taskCoordinator.get(request.taskId)
    const { project, checkout } = localCheckout(task.projectId)
    const settings = readSettings().worktrees
    return {
      task: await taskCoordinator.provisionWorktreeDraft(task.id, {
        projectName: project.name,
        localCheckoutId: checkout.id,
        localCheckoutPath: checkout.canonicalPath,
        managedRoot: settings.root,
        cap: settings.cap,
      }, request.includeLocalChanges),
    }
  })

  ipcMain.handle('tasks:continue-in-worktree', async (_, raw: unknown) => {
    const { taskId } = taskContinueInWorktreeRequestSchema.parse(raw)
    const current = taskCoordinator.get(taskId)
    if (!current.threadId) throw new Error('Local session has no Codex thread')
    const c = await getCodexClient()
    if (c.isThreadRunning(current.threadId) || c.hasActiveWorkers(current.threadId)) {
      throw new Error('Wait for Codex and its workers to finish before continuing in a worktree')
    }
    const { project, checkout } = localCheckout(current.projectId)
    const includeLocalChanges = Boolean(await gitStatusPorcelain(checkout.canonicalPath))
    const settings = readSettings().worktrees
    const manifest = project.defaultEnvironmentId
      ? environmentStore.list(project.id).find((candidate) => candidate.environmentId === project.defaultEnvironmentId)
      : null
    const trustedRevision = manifest && manifest.trustedRevision === manifest.currentRevision ? manifest.currentRevision : null
    let task = await taskCoordinator.continueInWorktree(taskId, {
      projectName: project.name,
      localCheckoutId: checkout.id,
      localCheckoutPath: checkout.canonicalPath,
      managedRoot: settings.root,
      cap: settings.cap,
      baseRef: project.pinnedLocalBranch ? `refs/heads/${project.pinnedLocalBranch}` : 'HEAD',
      environmentId: trustedRevision ? manifest!.environmentId : null,
      environmentRevision: trustedRevision,
      includeLocalChanges,
    })
    let setupError: Error | null = null
    if (task.environmentRevision) {
      try {
        const job = await environmentRunner.startSetup({ taskId })
        const result = await environmentRunner.wait(job.id)
        if (result.status !== 'succeeded') setupError = new Error(`Environment setup ${result.status}`)
      } catch (error) {
        setupError = error instanceof Error ? error : new Error('Environment setup failed')
      }
    }
    task = await taskCoordinator.markWorktreeTransitionResuming(taskId)
    const runtime = taskCoordinator.resolveRuntime(taskId, readProjectRegistry())
    try {
      await c.resumeThread(current.threadId, runtime)
    } catch (error) {
      if (task.environmentRevision) await taskCoordinator.failWorktreeTransition(taskId, error)
      else await taskCoordinator.rollbackWorktreeTransition(taskId)
      throw error
    }
    task = await taskCoordinator.completeWorktreeTransition(taskId, setupError ? 'failed' : 'active')
    return { task, warning: setupError?.message ?? null, includedLocalChanges: includeLocalChanges }
  })

  ipcMain.handle('tasks:status', (_, raw: unknown) => {
    const { taskId } = taskIdRequestSchema.parse(raw)
    const task = taskCoordinator.get(taskId)
    const worktree = task.worktreeId
      ? taskStore.read().managedWorktrees.find((candidate) => candidate.id === task.worktreeId) ?? null
      : null
    return { task, worktree, setupJob: environmentRunner.latestForTask(taskId) }
  })

  ipcMain.handle('tasks:handoff-local', async (_, raw: unknown) => {
    const request = taskHandoffRequestSchema.parse(raw)
    const c = await getCodexClient()
    const handoff = new HandoffCoordinator(taskStore, readProjectRegistry(), {
      isThreadRunning: (threadId) => c instanceof CodexClient ? c.isThreadRunning(threadId) : false,
      hasActiveWorkers: (threadId) => c instanceof CodexClient ? c.hasActiveWorkers(threadId) : false,
      resumeThread: (threadId, runtime) => c.resumeThread(threadId, runtime),
    }, path.join(os.homedir(), '.cranberri', 'handoff-bundles'))
    return { task: await handoff.toLocal(request) }
  })

  ipcMain.handle('tasks:handoff-worktree', async (_, raw: unknown) => {
    const request = taskHandoffRequestSchema.parse(raw)
    const c = await getCodexClient()
    const handoff = new HandoffCoordinator(taskStore, readProjectRegistry(), {
      isThreadRunning: (threadId) => c instanceof CodexClient ? c.isThreadRunning(threadId) : false,
      hasActiveWorkers: (threadId) => c instanceof CodexClient ? c.hasActiveWorkers(threadId) : false,
      resumeThread: (threadId, runtime) => c.resumeThread(threadId, runtime),
    }, path.join(os.homedir(), '.cranberri', 'handoff-bundles'))
    return { task: await handoff.toWorktree(request) }
  })

  ipcMain.handle('tasks:unarchive', async (_, raw: unknown) => {
    const { taskId } = taskIdRequestSchema.parse(raw)
    const task = taskCoordinator.get(taskId)
    const { checkout } = localCheckout(task.projectId)
    const restored = await taskCoordinator.unarchive(taskId, checkout.canonicalPath, async (worktree, revision) => {
      const job = await environmentRunner.startSetup({ taskId: worktree.taskId ?? taskId })
      const result = await environmentRunner.wait(job.id)
      if (result.status !== 'succeeded') throw new Error(`Environment setup ${result.status} for revision ${revision}`)
    })
    if (restored.threadId) await (await getCodexClient()).unarchiveThread(restored.threadId)
    return { task: restored }
  })

  ipcMain.handle('tasks:list', (_, raw: unknown) => {
    const request = taskListRequestSchema.parse(raw ?? {})
    return { tasks: taskCoordinator.list(request.projectId) }
  })

  ipcMain.handle('tasks:history', async (_, raw: unknown) => {
    const request = taskHistoryRequestSchema.parse(raw)
    const registry = readProjectRegistry()
    const roots = taskCoordinator.projectRoots(request.projectId, registry)
    const c = await getCodexClient()
    return c.listThreads(roots, request)
  })

  ipcMain.handle('tasks:read', async (_, raw: unknown) => {
    const request = taskReadRequestSchema.parse(raw)
    const task = taskCoordinator.get(request.taskId)
    if (!task.threadId) throw new Error('Task has no Codex thread')
    const c = await getCodexClient()
    return { task, thread: await c.readThread(task.threadId, request.archived) }
  })

  ipcMain.handle('tasks:resume', async (_, raw: unknown) => {
    const { taskId } = taskIdRequestSchema.parse(raw)
    const registry = readProjectRegistry()
    let task = taskCoordinator.get(taskId)
    assertTaskRunnable(task)
    const c = await getCodexClient()
    ensureEnvironmentToolRouter(c, mainWindowGetter)
    const runtime = taskCoordinator.resolveRuntime(task.id, registry)
    const threadRuntime = task.location === 'local' && c.supportsTransportCapability('dynamicTools')
      ? { ...runtime, dynamicTools: environmentDynamicTools }
      : runtime
    if (!task.threadId) {
      const thread = await createOrRecoverFirstTurnThread(c, task, threadRuntime)
      task = await taskCoordinator.bindThread(task.id, thread.id)
      advanceCapabilityEpoch(thread.id)
      return { task, threadId: thread.id }
    }
    return { task, thread: await c.resumeThread(task.threadId, threadRuntime) }
  })

  ipcMain.handle('tasks:send', async (_, raw: unknown) => {
    const request = taskSendRequestSchema.parse(raw)
    return runFirstTurnSendIdempotently(firstTurnIdempotencyKey(request.input), async () => {
    const registry = readProjectRegistry()
    let task = taskCoordinator.get(request.taskId)
    assertTaskRunnable(task)
    const c = await getCodexClient()
    ensureEnvironmentToolRouter(c, mainWindowGetter)
    const runtime = taskCoordinator.resolveRuntime(task.id, registry)
    const threadRuntime = task.location === 'local' && c.supportsTransportCapability('dynamicTools')
      ? { ...runtime, dynamicTools: environmentDynamicTools }
      : runtime
    const explicitTurnCwd = c.supportsTransportCapability('explicitTurnCwd')
    let leaseAcquired = false
    let pending: CodexUserInput[] | null = null
    try {
      const requestInput = request.input as CodexUserInput[]
      const requestIdempotencyKey = firstTurnIdempotencyKey(request.input)
      const pendingIdempotencyKey = task.pendingFirstTurn
        ? firstTurnIdempotencyKey(task.pendingFirstTurn.payload.input)
        : null
      if (
        requestIdempotencyKey
        && pendingIdempotencyKey
        && requestIdempotencyKey !== pendingIdempotencyKey
      ) {
        const persisted = task.pendingFirstTurn?.delivery === 'sending'
          ? await readPersistedFirstTurn(c, task.threadId, task.pendingFirstTurn.payload.input)
          : 'empty'
        if (persisted === 'matching') {
          if (task.threadId && task.pendingFirstTurn) {
            await finalizeFirstTurnThreadName(c, task.threadId, task.pendingFirstTurn.payload.input).catch(() => undefined)
          }
          task = await acknowledgeFirstTurn(task.id, pendingIdempotencyKey)
        } else if (persisted === 'conflicting') {
          throw new Error('The prepared thread contains a different first turn and needs attention')
        } else {
          if (persisted === 'missing') task = await taskCoordinator.resetMissingPendingThread(task.id)
          task = await taskCoordinator.replacePendingTurn(task.id, request.input)
        }
      }
      let persisted = task.pendingFirstTurn?.delivery === 'sending'
        ? await readPersistedFirstTurn(c, task.threadId, task.pendingFirstTurn.payload.input)
        : 'empty' as const
      if (persisted === 'missing') {
        task = await taskCoordinator.resetMissingPendingThread(task.id)
        persisted = 'empty'
      }
      const recoveryAction = firstTurnRecoveryAction(
        task,
        request.input,
        persisted,
      )
      if (recoveryAction === 'needsAttention') {
        throw new Error('The prepared thread contains a different first turn and needs attention')
      }
      if (recoveryAction === 'alreadyAcknowledged') return { ok: true, task }
      if (recoveryAction === 'acknowledge') {
        const idempotencyKey = firstTurnIdempotencyKey(request.input)
        if (!idempotencyKey) throw new Error('Interrupted first turn lost its idempotency key')
        if (task.threadId && task.pendingFirstTurn) {
          await finalizeFirstTurnThreadName(c, task.threadId, task.pendingFirstTurn.payload.input).catch(() => undefined)
        }
        task = await acknowledgeFirstTurn(task.id, idempotencyKey)
        return { ok: true, task }
      }
      if (task.location === 'local') {
        await taskCoordinator.acquireLocalLease(task.projectId, task.id)
        leaseAcquired = true
      }
      if (!task.threadId) {
        const thread = await createOrRecoverFirstTurnThread(c, task, threadRuntime)
        task = await taskCoordinator.bindThread(task.id, thread.id)
        advanceCapabilityEpoch(thread.id)
      }
      pending = taskCoordinator.pendingInput(task.id) as CodexUserInput[] | null
      if (task.threadId && !explicitTurnCwd && !pending) {
        await c.resumeThread(task.threadId, threadRuntime)
      }
      const input = pending ?? requestInput
      if (pending) await taskCoordinator.markPendingTurnSending(task.id)
      if (!task.threadId) throw new Error('Task thread creation did not persist')
      await c.sendMessage(
        task.threadId,
        withoutFirstTurnIdempotencyKey(input) as CodexUserInput[],
        request.settings as CodexTurnSettings | undefined,
        explicitTurnCwd ? runtime : undefined,
      )
      if (pending) {
        const idempotencyKey = firstTurnIdempotencyKey(input)
        if (idempotencyKey) {
          await finalizeFirstTurnThreadName(c, task.threadId, input).catch((error) => {
            console.warn('Failed to finalize first-turn thread name:', error)
          })
          task = await acknowledgeFirstTurn(task.id, idempotencyKey)
        }
        else task = await taskCoordinator.acknowledgePendingTurn(task.id)
      }
    } catch (error) {
      const idempotencyKey = pending ? firstTurnIdempotencyKey(pending) : null
      if (pending && idempotencyKey && task.threadId) {
        try {
          if (await readPersistedFirstTurn(c, task.threadId, pending) === 'matching') {
            await finalizeFirstTurnThreadName(c, task.threadId, pending).catch(() => undefined)
            task = await acknowledgeFirstTurn(task.id, idempotencyKey)
            return { ok: true, task }
          }
        } catch {
          // Leave the journal in `sending`; the next attempt reconciles it against the thread.
        }
      }
      if (pending && !idempotencyKey) await taskCoordinator.restorePendingTurn(task.id)
      if (leaseAcquired) await taskCoordinator.releaseLocalLease(task.projectId, task.id)
      throw error
    }
    return { ok: true, task: taskCoordinator.get(task.id) }
    })
  })

  ipcMain.handle('tasks:archive', async (_, raw: unknown) => {
    const { taskId } = taskIdRequestSchema.parse(raw)
    const task = taskCoordinator.get(taskId)
    const environmentJob = environmentRunner.latestForTask(taskId)
    if (environmentJob?.status === 'running') {
      throw new Error('Wait for environment setup to finish before archiving this session')
    }
    if (task.threadId) {
      const c = await getCodexClient()
      await c.archiveThread(task.threadId)
      forgetCatalogThread(task.threadId)
    }
    const archived = await taskCoordinator.archive(taskId)
    await worktreeLifecycle.sweepRetention({ retentionDays: readSettings().worktrees.retentionDays })
    return { task: archived }
  })

  ipcMain.handle('tasks:delete', async (_, raw: unknown) => {
    const { taskId } = taskIdRequestSchema.parse(raw)
    const task = taskCoordinator.get(taskId)
    const environmentJob = environmentRunner.latestForTask(taskId)
    if (environmentJob?.status === 'running') {
      throw new Error('Wait for environment setup to finish before deleting this session')
    }
    const c = await getCodexClient()
    if (task.threadId && (c.isThreadRunning(task.threadId) || c.hasActiveWorkers(task.threadId))) {
      throw new Error('Wait for Codex and its workers to finish before deleting this session')
    }
    await taskCoordinator.delete(taskId, (threadId) => c.deleteThread(threadId))
    if (task.threadId) forgetCatalogThread(task.threadId)
    return { ok: true }
  })

  ipcMain.handle('codex:start', async (_, cwd: string) => {
    rememberCatalogProjectRoot(cwd)
    const c = await getCodexClient()
    c.setCwd(cwd)
    return { started: true }
  })

  ipcMain.handle('codex:create-thread', async (_, cwd: string, settings?: CodexTurnSettings) => {
    rememberCatalogProjectRoot(cwd)
    const c = await getCodexClient()
    const thread = await c.createThread(cwd, settings)
    advanceCapabilityEpoch(thread.id)
    return { threadId: thread.id, title: thread.name ?? null }
  })

  ipcMain.handle('codex:threads:list', async (_, cwd: string, options?: { archived?: boolean; cursor?: string | null; limit?: number; searchTerm?: string | null }) => {
    rememberCatalogProjectRoot(cwd)
    const c = await getCodexClient()
    return c.listThreads(cwd, options ?? {})
  })

  ipcMain.handle('codex:threads:read', async (_, cwd: string, threadId: string, archived?: boolean) => {
    rememberCatalogProjectRoot(cwd)
    const c = await getCodexClient()
    c.setCwd(cwd)
    return { thread: await c.readThread(threadId, archived) }
  })

  ipcMain.handle('codex:threads:resume', async (_, cwd: string, threadId: string, settings?: CodexTurnSettings) => {
    rememberCatalogProjectRoot(cwd)
    const c = await getCodexClient()
    const thread = await c.resumeThread(threadId, cwd, settings)
    advanceCapabilityEpoch(threadId)
    return { thread }
  })

  ipcMain.handle('codex:threads:archive', async (_, cwd: string, threadId: string) => {
    const c = await getCodexClient()
    c.setCwd(cwd)
    await c.archiveThread(threadId)
    forgetCatalogThread(threadId)
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
    forgetCatalogThread(threadId)
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

  ipcMain.handle('codex:steer-thread', async (_, cwd: string, threadId: string, input: CodexUserInput[]) => {
    const c = await getCodexClient()
    c.setCwd(cwd)
    await c.steerThread(threadId, input)
    return { ok: true }
  })

  ipcMain.handle('codex:control-worker', async (
    _,
    cwd: string,
    parentThreadId: string,
    workerThreadId: string,
    action: CodexWorkerControlAction,
    input: CodexUserInput[],
  ) => {
    const c = await getCodexClient()
    c.setCwd(cwd)
    await c.controlWorker(parentThreadId, workerThreadId, action, input)
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
    return (await loadToolRegistry(threadId ?? null, forceRefetch)).snapshot
  })

  ipcMain.handle('tools:catalog:list', async (event, input: unknown): Promise<ToolCatalogSnapshot> => {
    authorizeCatalogIpc(event, mainWindowGetter)
    const request = toolCatalogListRequestSchema.parse(input)
    return toolCatalogService.list(loadToolCatalogContext(request.activeThreadId, false))
  })

  ipcMain.handle('tools:catalog:refresh', async (event, input: unknown): Promise<ToolCatalogSnapshot> => {
    authorizeCatalogIpc(event, mainWindowGetter)
    const request = toolCatalogListRequestSchema.parse(input)
    return toolCatalogService.refresh(loadToolCatalogContext(request.activeThreadId, true))
  })

  ipcMain.handle('tools:catalog:test', async (event, input: unknown): Promise<ToolCatalogSnapshot> => {
    authorizeCatalogIpc(event, mainWindowGetter)
    const request = toolCatalogTestRequestSchema.parse(input)
    const context = await loadToolCatalogContext(request.activeThreadId, false)
    return toolCatalogService.test(request.catalogId, context)
  })

  ipcMain.handle('codex:stop', async () => {
    client?.stop()
    client = null
    clientEventHandlerAttached = false
    clearCatalogTaskState()
    return { stopped: true }
  })
}

export function stopCodexClient(): void {
  toolCatalogService.dispose()
  client?.stop()
  client = null
  clientEventHandlerAttached = false
  clearCatalogTaskState()
}
