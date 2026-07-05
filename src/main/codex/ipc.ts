import { ipcMain } from 'electron'
import { CodexClient } from './client'
import type { CodexEvent } from '../../shared/codex'

interface Session {
  cwd: string
  client: CodexClient
}

const sessions = new Map<string, Session>()

function getOrCreateSession(cwd: string): Session {
  let session = sessions.get(cwd)
  if (!session) {
    const client = new CodexClient(cwd)
    session = { cwd, client }
    sessions.set(cwd, session)
  }
  return session
}

export function initCodexIpc(mainWindowGetter: () => Electron.BrowserWindow | null): void {
  const broadcast = (event: CodexEvent) => {
    const win = mainWindowGetter()
    if (win && !win.isDestroyed()) {
      win.webContents.send('codex:event', event)
    }
  }

  ipcMain.handle('codex:start', async (_, cwd: string) => {
    const session = getOrCreateSession(cwd)
    await session.client.start()

    // forward events from this session only
    session.client.removeAllListeners('event')
    session.client.on('event', (event: CodexEvent) => {
      if ((event as { threadId?: string }).threadId) {
        broadcast(event)
      }
    })

    return { started: true }
  })

  ipcMain.handle('codex:create-thread', async (_, cwd: string) => {
    const session = getOrCreateSession(cwd)
    const threadId = await session.client.createThread()
    return { threadId }
  })

  ipcMain.handle('codex:send-message', async (_, cwd: string, threadId: string, content: string) => {
    const session = getOrCreateSession(cwd)
    await session.client.sendMessage(threadId, content)
    return { ok: true }
  })

  ipcMain.handle('codex:approve', async (_, cwd: string, threadId: string, approvalId: string) => {
    const session = getOrCreateSession(cwd)
    await session.client.approve(approvalId, threadId)
    return { ok: true }
  })

  ipcMain.handle('codex:interrupt', async (_, cwd: string, threadId: string) => {
    const session = getOrCreateSession(cwd)
    await session.client.abort(threadId)
    return { ok: true }
  })

  ipcMain.handle('codex:stop', async (_, cwd: string) => {
    const session = sessions.get(cwd)
    if (session) {
      session.client.stop()
      sessions.delete(cwd)
    }
    return { stopped: true }
  })
}
