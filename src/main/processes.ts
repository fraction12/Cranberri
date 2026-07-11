import { ipcMain } from 'electron'
import { listProcessesForExecution, listProcessesForRepo, terminateProcess, terminateProcessForExecution } from './processRegistry'
import { getRegisteredRepoPaths } from './repos'
import { validateRepoPath } from './repoSecurity'
import { executionRequestSchema } from '../shared/execution'
import { resolveExecutionContext } from './execution-context'

export function initProcessesIpc(): void {
  ipcMain.handle('processes:list', async (_, repoPath: string) => {
    const safeRepoPath = validateRepoPath(repoPath, getRegisteredRepoPaths())
    return { processes: await listProcessesForRepo(safeRepoPath) }
  })

  ipcMain.handle('processes:terminate', async (_, repoPath: string, processId: string) => {
    const safeRepoPath = validateRepoPath(repoPath, getRegisteredRepoPaths())
    return { process: terminateProcess(processId, safeRepoPath) }
  })
  ipcMain.handle('processes:task:list', async (_, request: unknown) => {
    const context = resolveExecutionContext(executionRequestSchema.parse(request).taskId)
    return { processes: await listProcessesForExecution(context, context.cwd) }
  })
  ipcMain.handle('processes:task:terminate', async (_, request: unknown, processId: string) => {
    const context = resolveExecutionContext(executionRequestSchema.parse(request).taskId)
    return { process: terminateProcessForExecution(processId, context, context.cwd) }
  })
}
