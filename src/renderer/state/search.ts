import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { repoWatchEventSchema, type FilePreviewResult, type RepoSearchOptions, type RepoSearchResult } from '@/shared/search'
import { useRepos } from './repos'
import { useWorkspace } from './workspace'

export function repoWatcherStartErrorIsBenign(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /Task (?:worktree )?checkout not found|Task not found/i.test(message)
}

export function useRepoSearch(options: RepoSearchOptions, enabled = true) {
  const { activeRepo } = useRepos()
  return useQuery<RepoSearchResult>({
    queryKey: ['repo-search', activeRepo?.id, options],
    queryFn: async () => {
      if (!activeRepo) return { query: '', matches: [], truncated: false }
      return window.cranberri.search.repo(activeRepo.path, options)
    },
    enabled: enabled && !!activeRepo && !!options.query.trim(),
  })
}

export function useFilePreview(filePath: string | null, maxBytes?: number) {
  const { activeRepo } = useRepos()
  return useQuery<FilePreviewResult>({
    queryKey: ['file-preview', activeRepo?.id, filePath, maxBytes],
    queryFn: async () => {
      if (!activeRepo || !filePath) throw new Error('No file selected')
      return window.cranberri.search.previewFile(activeRepo.path, filePath, maxBytes)
    },
    enabled: !!activeRepo && !!filePath,
  })
}

export function useRepoWatchInvalidation(): void {
  const { activeRepo } = useRepos()
  const { activeWindowId, activeExecutionContext, activeExecutionResolution } = useWorkspace()
  const queryClient = useQueryClient()
  const activeRepoId = activeRepo?.id ?? null
  const activeTaskId = activeExecutionContext?.taskId ?? null
  const activeRepoPath = activeExecutionContext?.checkoutPath ?? null
  const executionPending = Boolean(activeWindowId) && activeExecutionResolution === null

  useEffect(() => {
    if (!activeRepoId || !activeRepoPath || executionPending) return undefined
    let mounted = true
    const unsubscribe = window.cranberri.search.onRepoChanged((event) => {
      const parsed = repoWatchEventSchema.safeParse(event)
      if (!parsed.success || parsed.data.repoPath !== activeRepoPath) return
      void queryClient.invalidateQueries({ queryKey: ['repo-search', activeRepoId] })
      void queryClient.invalidateQueries({ queryKey: ['file-preview', activeRepoId] })
      void queryClient.invalidateQueries({ queryKey: ['git-status', activeRepoId] })
      void queryClient.invalidateQueries({ queryKey: ['git-files', activeRepoId] })
      void queryClient.invalidateQueries({ queryKey: ['git-diff', activeRepoId] })
      void queryClient.invalidateQueries({ queryKey: ['git-diff-file', activeRepoId] })
      void queryClient.invalidateQueries({ queryKey: ['git-raw-content', activeRepoId] })
    })

    const start = activeTaskId
      ? window.cranberri.search.taskWatchStart(activeTaskId)
      : window.cranberri.search.watchStart(activeRepoPath)
    start.catch((error) => {
      if (mounted && !repoWatcherStartErrorIsBenign(error)) console.error('Failed to start repo watcher:', error)
    })

    return () => {
      mounted = false
      unsubscribe()
      const stop = activeTaskId
        ? window.cranberri.search.taskWatchStop(activeTaskId)
        : window.cranberri.search.watchStop(activeRepoPath)
      stop.catch(() => undefined)
    }
  }, [activeRepoId, activeRepoPath, activeTaskId, executionPending, queryClient])
}
