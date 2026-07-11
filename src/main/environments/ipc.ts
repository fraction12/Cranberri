import { ipcMain, type BrowserWindow } from 'electron'
import {
  environmentActionRequestSchema,
  environmentJobIdRequestSchema,
  environmentJobWriteRequestSchema,
  environmentSetupRequestSchema,
  environmentTestRequestSchema,
} from '../../shared/terminal'
import { EnvironmentRunner } from './runner'

export function initEnvironmentIpc(
  getMainWindow: () => BrowserWindow | null,
  runner = new EnvironmentRunner(),
): EnvironmentRunner {
  runner.setEvents({
    onData: (jobId, data) => getMainWindow()?.webContents.send('environments:job:data', { jobId, data }),
    onExit: (job) => getMainWindow()?.webContents.send('environments:job:exit', {
      jobId: job.id,
      status: job.status,
      exitCode: job.exitCode,
      signal: job.signal,
    }),
  })

  ipcMain.handle('environments:setup:start', (_, input: unknown) => runner.startSetup(environmentSetupRequestSchema.parse(input)))
  ipcMain.handle('environments:setup:retry', (_, input: unknown) => runner.retrySetup(environmentSetupRequestSchema.parse(input)))
  ipcMain.handle('environments:test:start', (_, input: unknown) => runner.testEnvironment(environmentTestRequestSchema.parse(input)))
  ipcMain.handle('environments:job:snapshot', (_, input: unknown) => runner.snapshot(environmentJobIdRequestSchema.parse(input).jobId))
  ipcMain.handle('environments:job:write', (_, input: unknown) => {
    const request = environmentJobWriteRequestSchema.parse(input)
    runner.write(request.jobId, request.data)
  })
  ipcMain.handle('environments:job:cancel', (_, input: unknown) => runner.cancel(environmentJobIdRequestSchema.parse(input).jobId))
  ipcMain.handle('environments:action:open', (_, input: unknown) => runner.openAction(environmentActionRequestSchema.parse(input)))
  return runner
}
