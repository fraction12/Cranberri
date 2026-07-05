import simpleGit from 'simple-git'
import { ipcMain } from 'electron'
import { z } from 'zod'

const fileStatusSchema = z.object({
  path: z.string(),
  status: z.enum(['added', 'modified', 'deleted', 'renamed', 'untracked', 'conflict']),
})

const diffSchema = z.object({
  files: z.array(z.object({
    from: z.string().optional(),
    to: z.string(),
    additions: z.number(),
    deletions: z.number(),
    chunks: z.array(z.object({
      oldStart: z.number(),
      oldLines: z.number(),
      newStart: z.number(),
      newLines: z.number(),
      changes: z.array(z.object({
        type: z.enum(['add', 'del', 'normal']),
        addLine: z.number().optional(),
        delLine: z.number().optional(),
        line: z.string(),
        ln1: z.number().optional(),
        ln2: z.number().optional(),
      })),
    })),
  })),
})

export type GitStatus = z.infer<typeof fileStatusSchema>
export type Diff = z.infer<typeof diffSchema>
export type GitFileStatus = GitStatus
export type DiffResult = Diff

export function initGitIpc(): void {
  ipcMain.handle('git:status', async (_, repoPath: string) => {
    const git = simpleGit(repoPath)
    const status = await git.status()

    const files: GitFileStatus[] = []
    for (const path of status.created) files.push({ path, status: 'untracked' })
    for (const path of status.modified) files.push({ path, status: 'modified' })
    for (const path of status.deleted) files.push({ path, status: 'deleted' })
    for (const path of status.renamed.map((r) => r.to)) files.push({ path, status: 'renamed' })
    for (const path of status.not_added) {
      if (!files.some((f) => f.path === path)) files.push({ path, status: 'untracked' })
    }
    for (const path of status.conflicted) files.push({ path, status: 'conflict' })

    return fileStatusSchema.array().parse(files)
  })

  ipcMain.handle('git:diff', async (_, repoPath: string) => {
    const git = simpleGit(repoPath)
    const raw = await git.diff()
    if (!raw) return { files: [] }

    // parse-diff is CJS; dynamic import works in electron main
    const { default: parseDiff } = await import('parse-diff')
    const files = parseDiff(raw)

    return diffSchema.parse({
      files: files.map((f) => ({
        from: f.from,
        to: f.to,
        additions: f.additions,
        deletions: f.deletions,
        chunks: f.chunks.map((c) => ({
          oldStart: c.oldStart,
          oldLines: c.oldLines,
          newStart: c.newStart,
          newLines: c.newLines,
          changes: c.changes.map((change) => {
            if (change.type === 'add') {
              return { type: 'add', addLine: change.ln, line: change.content, ln2: change.ln }
            }
            if (change.type === 'del') {
              return { type: 'del', delLine: change.ln, line: change.content, ln1: change.ln }
            }
            return { type: 'normal', line: change.content, ln1: change.ln1, ln2: change.ln2 }
          }),
        })),
      })),
    })
  })
}
