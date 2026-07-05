import { app, dialog, ipcMain } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { z } from 'zod'

const repoSchema = z.object({
  id: z.string(),
  name: z.string(),
  path: z.string(),
})

const reposFileSchema = z.object({
  repos: z.array(repoSchema),
  activeRepoId: z.string().nullable(),
})

type Repo = z.infer<typeof repoSchema>
type ReposFile = z.infer<typeof reposFileSchema>

function reposFilePath(): string {
  return path.join(app.getPath('userData'), 'repos.json')
}

function readRepos(): ReposFile {
  try {
    const raw = fs.readFileSync(reposFilePath(), 'utf8')
    const parsed = JSON.parse(raw)
    return reposFileSchema.parse(parsed)
  } catch {
    return { repos: [], activeRepoId: null }
  }
}

function writeRepos(state: ReposFile): void {
  fs.mkdirSync(path.dirname(reposFilePath()), { recursive: true })
  fs.writeFileSync(reposFilePath(), JSON.stringify(state, null, 2))
}

export function getRepoName(repoPath: string): string {
  return path.basename(repoPath)
}

export function initRepoIpc(): void {
  ipcMain.handle('repos:list', () => readRepos())

  ipcMain.handle('repos:add', async (_, repoPath: string) => {
    const normalized = path.resolve(repoPath)
    if (!fs.existsSync(path.join(normalized, '.git'))) {
      throw new Error('Selected directory is not a git repository')
    }

    const state = readRepos()
    if (state.repos.some((r) => r.path === normalized)) {
      return state
    }

    const repo: Repo = {
      id: crypto.randomUUID(),
      name: getRepoName(normalized),
      path: normalized,
    }

    const next: ReposFile = {
      repos: [...state.repos, repo],
      activeRepoId: state.activeRepoId ?? repo.id,
    }
    writeRepos(next)
    return next
  })

  ipcMain.handle('repos:remove', (_, id: string) => {
    const state = readRepos()
    const repos = state.repos.filter((r) => r.id !== id)
    const activeRepoId = state.activeRepoId === id ? repos[0]?.id ?? null : state.activeRepoId
    const next: ReposFile = { repos, activeRepoId }
    writeRepos(next)
    return next
  })

  ipcMain.handle('repos:set-active', (_, id: string) => {
    const state = readRepos()
    const repo = state.repos.find((r) => r.id === id)
    if (!repo) throw new Error('Repo not found')
    const next: ReposFile = { ...state, activeRepoId: id }
    writeRepos(next)
    return next
  })

  ipcMain.handle('repos:pick-directory', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: 'Select a git repository',
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })
}
