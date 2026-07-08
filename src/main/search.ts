import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { ipcMain } from 'electron'
import chokidar from 'chokidar'
import Fuse from 'fuse.js'
import { rgPath } from '@vscode/ripgrep'
import { getRegisteredRepoPaths } from './repos'
import { resolveRepoFilePath, validateRepoPath, validateRepoRelativePath } from './repoSecurity'
import { repoFileSearchOptionsSchema, repoSearchOptionsSchema, type FilePreviewResult, type RepoFileSearchMatch, type RepoFileSearchOptions, type RepoFileSearchResult, type RepoSearchMatch, type RepoSearchOptions, type RepoSearchResult, type RepoWatchEvent, type RepoWatchEventType } from '../shared/search'

const SEARCH_TIMEOUT_MS = 15000
const SEARCH_MAX_BUFFER = 4 * 1024 * 1024
const PREVIEW_MAX_BYTES = 256 * 1024
const WATCH_EVENT_LIMIT = 200
const WATCH_FLUSH_MS = 150
const WATCH_IGNORED = [
  '**/.git/**',
  '**/node_modules/**',
  '**/.cache/**',
  '**/.next/**',
  '**/.turbo/**',
  '**/.vite/**',
  '**/build/**',
  '**/coverage/**',
  '**/dist/**',
  '**/out/**',
  '**/target/**',
  '**/.DS_Store',
]

interface RipgrepMatchLine {
  type: string
  data?: {
    path?: { text?: string }
    lines?: { text?: string }
    line_number?: number
    submatches?: Array<{ start: number }>
  }
}

interface PendingWatchEvent {
  type: RepoWatchEventType
  path: string
}

interface RepoWatchSession {
  watcher: { close: () => Promise<void> | void }
  pending: PendingWatchEvent[]
  timer: NodeJS.Timeout | null
  truncated: boolean
}

const repoWatchers = new Map<string, RepoWatchSession>()

export function isRepoWatchPathIgnored(filePath: string): boolean {
  const normalizedPath = filePath.split(path.sep).join('/')
  const segments = normalizedPath.split('/').filter(Boolean)
  if (segments.some((segment) => segment === '.git' || segment === 'node_modules' || segment === '.cache' || segment === '.next' || segment === '.turbo' || segment === '.vite' || segment === 'build' || segment === 'coverage' || segment === 'dist' || segment === 'out' || segment === 'target')) return true
  return path.posix.basename(normalizedPath) === '.DS_Store'
}

function runRg(args: string[], cwd: string): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve) => {
    execFile(rgPath, args, { cwd, timeout: SEARCH_TIMEOUT_MS, maxBuffer: SEARCH_MAX_BUFFER }, (error, stdout, stderr) => {
      resolve({
        stdout: stdout?.toString() ?? '',
        stderr: stderr?.toString() ?? '',
        code: error && typeof (error as { code?: unknown }).code === 'number' ? (error as { code: number }).code : error ? 1 : 0,
      })
    })
  })
}

function parseRipgrepJson(stdout: string, maxResults: number): { matches: RepoSearchMatch[]; truncated: boolean } {
  const matches: RepoSearchMatch[] = []
  let sawExtraMatch = false

  for (const line of stdout.split('\n')) {
    if (!line.trim()) continue
    let parsed: RipgrepMatchLine
    try {
      parsed = JSON.parse(line) as RipgrepMatchLine
    } catch {
      continue
    }
    if (parsed.type !== 'match') continue
    if (matches.length >= maxResults) {
      sawExtraMatch = true
      continue
    }

    const filePath = parsed.data?.path?.text
    const text = parsed.data?.lines?.text
    const lineNumber = parsed.data?.line_number
    if (!filePath || !text || !lineNumber) continue
    matches.push({
      path: filePath.replace(/^\.\//, ''),
      line: lineNumber,
      column: (parsed.data?.submatches?.[0]?.start ?? 0) + 1,
      text: text.replace(/\r?\n$/, ''),
    })
  }

  return { matches, truncated: sawExtraMatch }
}

function parseRipgrepFiles(stdout: string): string[] {
  return stdout
    .split('\n')
    .map((item) => item.trim().replace(/^\.\//, ''))
    .filter(Boolean)
}

function toFileSearchMatch(filePath: string, score: number): RepoFileSearchMatch {
  const basename = path.posix.basename(filePath)
  const directory = path.posix.dirname(filePath)
  return {
    path: filePath,
    basename,
    directory: directory === '.' ? '' : directory,
    score,
  }
}

function directFileRank(filePath: string, normalizedQuery: string): number | null {
  const normalizedPath = filePath.toLowerCase()
  const normalizedBasename = path.posix.basename(filePath).toLowerCase()
  if (normalizedBasename === normalizedQuery) return 0
  if (normalizedBasename.startsWith(normalizedQuery)) return 0.02
  if (normalizedPath.includes(normalizedQuery)) return 0.08
  return null
}

function rankFilePaths(filePaths: string[], query: string, maxResults: number): { matches: RepoFileSearchMatch[]; truncated: boolean } {
  const normalizedQuery = query.toLowerCase()
  const directMatches = new Map<string, number>()
  for (const filePath of filePaths) {
    const rank = directFileRank(filePath, normalizedQuery)
    if (rank !== null) directMatches.set(filePath, rank)
  }

  const fuse = new Fuse(filePaths.map((filePath) => ({
    path: filePath,
    basename: path.posix.basename(filePath),
    directory: path.posix.dirname(filePath) === '.' ? '' : path.posix.dirname(filePath),
  })), {
    includeScore: true,
    ignoreLocation: true,
    threshold: 0.45,
    keys: [
      { name: 'basename', weight: 0.7 },
      { name: 'path', weight: 0.3 },
    ],
  })

  const ranked = new Map<string, number>(directMatches)
  for (const item of fuse.search(query)) {
    const current = ranked.get(item.item.path)
    const score = item.score ?? 0.5
    ranked.set(item.item.path, current === undefined ? score : Math.min(current, score))
  }

  const sorted = [...ranked.entries()]
    .sort(([leftPath, leftScore], [rightPath, rightScore]) => leftScore - rightScore || leftPath.localeCompare(rightPath))

  return {
    matches: sorted.slice(0, maxResults).map(([filePath, score]) => toFileSearchMatch(filePath, score)),
    truncated: sorted.length > maxResults,
  }
}

function looksLikeText(buffer: Buffer): boolean {
  if (buffer.includes(0)) return false
  const decoded = buffer.toString('utf8')
  const replacementCount = [...decoded].filter((char) => char === '\uFFFD').length
  return replacementCount <= Math.max(1, decoded.length * 0.01)
}

function normalizeWatchPath(repoPath: string, eventPath: string): string | null {
  const relativePath = path.relative(repoPath, path.resolve(repoPath, eventPath))
  if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) return null
  return relativePath.split(path.sep).join('/')
}

export function buildRepoWatchEvent(repoPath: string, pending: PendingWatchEvent[], truncated: boolean, changedAt = Date.now()): RepoWatchEvent {
  const seen = new Set<string>()
  const events: PendingWatchEvent[] = []
  let hitLimit = false
  for (const event of pending) {
    const key = `${event.type}:${event.path}`
    if (seen.has(key)) continue
    seen.add(key)
    if (events.length >= WATCH_EVENT_LIMIT) {
      hitLimit = true
      break
    }
    events.push(event)
  }
  return {
    repoPath,
    events,
    truncated: truncated || hitLimit,
    changedAt,
  }
}

function queueRepoWatchEvent(repoPath: string, type: RepoWatchEventType, eventPath: string, emit: (event: RepoWatchEvent) => void): void {
  const session = repoWatchers.get(repoPath)
  if (!session) return
  const relativePath = normalizeWatchPath(repoPath, eventPath)
  if (!relativePath) return
  if (isRepoWatchPathIgnored(relativePath)) return
  if (session.pending.length >= WATCH_EVENT_LIMIT) {
    session.truncated = true
  } else {
    session.pending.push({ type, path: relativePath })
  }
  if (session.timer) return
  session.timer = setTimeout(() => {
    session.timer = null
    const payload = buildRepoWatchEvent(repoPath, session.pending, session.truncated)
    session.pending = []
    session.truncated = false
    if (payload.events.length > 0 || payload.truncated) emit(payload)
  }, WATCH_FLUSH_MS)
}

export function closeRepoWatchSession(repoPath: string, session: RepoWatchSession, warn: (message: string, error: unknown) => void = console.warn): void {
  if (session.timer) {
    clearTimeout(session.timer)
    session.timer = null
  }
  session.pending = []
  session.truncated = false
  void Promise.resolve(session.watcher.close()).catch((error) => {
    warn(`[search] failed to close repo watcher for ${repoPath}:`, error)
  })
}

function stopRepoWatch(repoPath: string): void {
  const session = repoWatchers.get(repoPath)
  if (!session) return
  repoWatchers.delete(repoPath)
  closeRepoWatchSession(repoPath, session)
}

async function startRepoWatch(repoPath: string, registeredRepoPaths: string[], emit: (event: RepoWatchEvent) => void): Promise<{ watching: boolean; repoPath: string }> {
  const safeRepoPath = validateRepoPath(repoPath, registeredRepoPaths)
  if (repoWatchers.has(safeRepoPath)) return { watching: true, repoPath: safeRepoPath }

  const watcher = process.platform === 'darwin'
    ? fs.watch(safeRepoPath, { persistent: true, recursive: true }, (eventType, filename) => {
      if (!filename) return
      const eventPath = path.join(safeRepoPath, filename.toString())
      const type: RepoWatchEventType = eventType === 'rename' && !fs.existsSync(eventPath) ? 'unlink' : 'change'
      queueRepoWatchEvent(safeRepoPath, type, eventPath, emit)
    })
    : chokidar.watch(safeRepoPath, {
      ignored: WATCH_IGNORED,
      ignoreInitial: true,
      persistent: true,
      awaitWriteFinish: {
        stabilityThreshold: 100,
        pollInterval: 50,
      },
    })
  const session: RepoWatchSession = { watcher, pending: [], timer: null, truncated: false }
  repoWatchers.set(safeRepoPath, session)
  if (process.platform !== 'darwin') {
    watcher.on('add', (filePath) => queueRepoWatchEvent(safeRepoPath, 'add', filePath, emit))
    watcher.on('change', (filePath) => queueRepoWatchEvent(safeRepoPath, 'change', filePath, emit))
    watcher.on('unlink', (filePath) => queueRepoWatchEvent(safeRepoPath, 'unlink', filePath, emit))
  }
  watcher.on('error', (error: unknown) => {
    emit({ repoPath: safeRepoPath, events: [], truncated: false, changedAt: Date.now() })
    console.warn('[search] repo watcher error:', error)
  })

  return { watching: true, repoPath: safeRepoPath }
}

export async function searchRepo(repoPath: string, options: RepoSearchOptions, registeredRepoPaths: string[]): Promise<RepoSearchResult> {
  const safeRepoPath = validateRepoPath(repoPath, registeredRepoPaths)
  const parsedOptions = repoSearchOptionsSchema.parse(options)
  const query = parsedOptions.query.trim()
  if (!query) return { query, matches: [], truncated: false }

  const args = [
    '--json',
    '--color',
    'never',
    '--line-number',
    '--column',
    '--smart-case',
    '--fixed-strings',
  ]
  if (parsedOptions.includeHidden) args.push('--hidden')
  for (const glob of parsedOptions.globs) args.push('--glob', glob)
  args.push(query, '.')

  const result = await runRg(args, safeRepoPath)
  if (result.code !== 0 && result.code !== 1) {
    throw new Error((result.stderr || 'Search failed').trim())
  }

  return {
    query,
    ...parseRipgrepJson(result.stdout, parsedOptions.maxResults),
  }
}

export async function searchRepoFiles(repoPath: string, options: RepoFileSearchOptions, registeredRepoPaths: string[]): Promise<RepoFileSearchResult> {
  const safeRepoPath = validateRepoPath(repoPath, registeredRepoPaths)
  const parsedOptions = repoFileSearchOptionsSchema.parse(options)
  const query = parsedOptions.query.trim()
  if (!query) return { query, matches: [], truncated: false }

  const args = ['--files', '--color', 'never']
  if (parsedOptions.includeHidden) args.push('--hidden')
  for (const glob of parsedOptions.globs) args.push('--glob', glob)

  const result = await runRg(args, safeRepoPath)
  if (result.code !== 0 && result.code !== 1) {
    throw new Error((result.stderr || 'File search failed').trim())
  }

  return {
    query,
    ...rankFilePaths(parseRipgrepFiles(result.stdout), query, parsedOptions.maxResults),
  }
}

export async function previewRepoFile(repoPath: string, filePath: string, registeredRepoPaths: string[], maxBytes = PREVIEW_MAX_BYTES): Promise<FilePreviewResult> {
  const safeRepoPath = validateRepoPath(repoPath, registeredRepoPaths)
  const safeFilePath = validateRepoRelativePath(safeRepoPath, filePath)
  const absolutePath = resolveRepoFilePath(safeRepoPath, safeFilePath)
  const stat = await fs.promises.stat(absolutePath)
  if (!stat.isFile()) throw new Error('Path is not a file')

  const boundedMaxBytes = Math.min(Math.max(Math.floor(maxBytes), 1), PREVIEW_MAX_BYTES)
  const handle = await fs.promises.open(absolutePath, 'r')
  try {
    const buffer = Buffer.alloc(Math.min(stat.size, boundedMaxBytes))
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
    const sample = buffer.subarray(0, bytesRead)
    if (!looksLikeText(sample)) {
      return { path: safeFilePath, text: '', isBinary: true, truncated: false, size: stat.size }
    }
    return {
      path: safeFilePath,
      text: sample.toString('utf8'),
      isBinary: false,
      truncated: stat.size > bytesRead,
      size: stat.size,
    }
  } finally {
    await handle.close()
  }
}

export function initSearchIpc(): void {
  ipcMain.handle('search:repo', async (_, repoPath: string, options: RepoSearchOptions) => searchRepo(repoPath, options, getRegisteredRepoPaths()))
  ipcMain.handle('search:repo-files', async (_, repoPath: string, options: RepoFileSearchOptions) => searchRepoFiles(repoPath, options, getRegisteredRepoPaths()))
  ipcMain.handle('search:preview-file', async (_, repoPath: string, filePath: string, maxBytes?: number) => previewRepoFile(repoPath, filePath, getRegisteredRepoPaths(), maxBytes))
  ipcMain.handle('search:watch:start', async (event, repoPath: string) => startRepoWatch(repoPath, getRegisteredRepoPaths(), (payload) => {
    if (!event.sender.isDestroyed()) event.sender.send('search:repo-changed', payload)
  }))
  ipcMain.handle('search:watch:stop', async (_, repoPath: string) => {
    const safeRepoPath = validateRepoPath(repoPath, getRegisteredRepoPaths())
    stopRepoWatch(safeRepoPath)
    return { watching: false, repoPath: safeRepoPath }
  })
}
