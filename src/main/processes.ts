import { ipcMain } from 'electron'
import { listProcessesForRepo } from './processRegistry'

export function initProcessesIpc(): void {
  ipcMain.handle('processes:list', async (_, repoPath: string) => {
    return { processes: listProcessesForRepo(repoPath) }
  })
}
