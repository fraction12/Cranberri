import { ipcMain } from 'electron'
import { listProcessesForRepo, terminateProcess } from './processRegistry'
import { getRegisteredRepoPaths } from './repos'
import { validateRepoPath } from './repoSecurity'

export function initProcessesIpc(): void {
  ipcMain.handle('processes:list', async (_, repoPath: string) => {
    const safeRepoPath = validateRepoPath(repoPath, getRegisteredRepoPaths())
    return { processes: await listProcessesForRepo(safeRepoPath) }
  })

  ipcMain.handle('processes:terminate', async (_, repoPath: string, processId: string) => {
    const safeRepoPath = validateRepoPath(repoPath, getRegisteredRepoPaths())
    return { process: terminateProcess(processId, safeRepoPath) }
  })
}
