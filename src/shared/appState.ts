import { z } from 'zod'

export type WorkspaceWindowType = 'chat' | 'terminal' | 'browser'
export type SessionExecutionTarget = 'local' | 'worktree'

export interface BrowserWindowState {
  url: string
  title?: string
  profileId: string
  viewportMode?: 'responsive' | 'mobile' | 'tablet' | 'desktop'
  devServerProcessId?: string
}

export interface WorkspaceWindowState {
  id: string
  type: WorkspaceWindowType
  title: string
  threadId?: string
  bindingRevision?: number
  browser?: BrowserWindowState
  projectId?: string
  taskId?: string | null
  checkoutId?: string
  sessionTarget?: SessionExecutionTarget
}

export interface RepoWorkspaceState {
  windows: WorkspaceWindowState[]
  activeWindowId: string | null
}

export interface PinnedCodexSessionRecord {
  id: string
  title?: string
  archived?: boolean
  updatedAt?: number | null
}

export interface CranberriAppState {
  version: 3
  expandedProjectIds: Record<string, boolean>
  workspacesByProjectId: Record<string, RepoWorkspaceState>
  pinnedCodexSessionsByProjectId: Record<string, PinnedCodexSessionRecord[]>
}

export const DEFAULT_APP_STATE: CranberriAppState = {
  version: 3,
  expandedProjectIds: {},
  workspacesByProjectId: {},
  pinnedCodexSessionsByProjectId: {},
}

export const persistenceFlushReasonSchema = z.enum(['window-close', 'app-quit'])

export const persistenceFlushRequestSchema = z.object({
  requestId: z.string().min(1).max(512),
  reason: persistenceFlushReasonSchema,
}).strict()

export const persistenceFlushAcknowledgementSchema = z.object({
  requestId: z.string().min(1).max(512),
  errorMessage: z.string().max(10_000).nullable(),
}).strict()

export const persistenceFlushFailureSchema = z.object({
  reason: persistenceFlushReasonSchema,
  message: z.string().min(1).max(10_000),
}).strict()

export type PersistenceFlushRequest = z.infer<typeof persistenceFlushRequestSchema>
export type PersistenceFlushAcknowledgement = z.infer<typeof persistenceFlushAcknowledgementSchema>
export type PersistenceFlushFailure = z.infer<typeof persistenceFlushFailureSchema>
