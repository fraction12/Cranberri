import { ipcMain } from 'electron'
import { listProcessesForRepo, terminateProcess } from './processRegistry'

export function initProcessesIpc(): void {
  ipcMain.handle('processes:list', async (_, repoPath: string) => {
    return { processes: await listProcessesForRepo(repoPath) }
  })

  ipcMain.handle('processes:terminate', async (_, repoPath: string, processId: string) => {
    return { process: terminateProcess(processId, repoPath) }
  })
}
