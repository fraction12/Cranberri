import { useQuery } from '@tanstack/react-query'
import { useRepos } from './repos'
import { useWorkspace } from './workspace'
import type { GitFileStatus, DiffResult } from '@/shared/git'

function useGitExecutionRoute() {
  const { activeWindowId, activeExecutionContext, activeExecutionResolution } = useWorkspace()
  return {
    taskId: activeExecutionContext?.taskId ?? null,
    repoPath: activeExecutionContext?.checkoutPath ?? null,
    pending: Boolean(activeWindowId) && activeExecutionResolution === null,
    unavailableReason: activeExecutionResolution?.status === 'unavailable' ? activeExecutionResolution.reason : null,
  }
}

function executionQueryKey(execution: ReturnType<typeof useGitExecutionRoute>) {
  return [execution.taskId, execution.repoPath, execution.pending, execution.unavailableReason] as const
}

function assertExecutionAvailable(unavailableReason: string | null): void {
  if (unavailableReason) throw new Error(`Workspace checkout is unavailable (${unavailableReason})`)
}

export function useGitStatus(enabled = true) {
  const { activeRepo } = useRepos()
  const execution = useGitExecutionRoute()
  return useQuery<GitFileStatus[]>({
    queryKey: ['git-status', activeRepo?.id, ...executionQueryKey(execution)],
    queryFn: async () => {
      if (!activeRepo) return []
      assertExecutionAvailable(execution.unavailableReason)
      return execution.taskId
        ? window.cranberri.git.taskStatus(execution.taskId)
        : window.cranberri.git.status(execution.repoPath ?? activeRepo.path)
    },
    enabled: enabled && !!activeRepo && !execution.pending,
    refetchInterval: enabled ? 3_000 : false,
  })
}

export function useGitFiles(enabled = true) {
  const { activeRepo } = useRepos()
  const execution = useGitExecutionRoute()
  return useQuery<import('@/shared/git').FileTreeNode[]>({
    queryKey: ['git-files', activeRepo?.id, ...executionQueryKey(execution)],
    queryFn: async () => {
      if (!activeRepo) return []
      assertExecutionAvailable(execution.unavailableReason)
      return execution.taskId
        ? window.cranberri.git.taskFiles(execution.taskId)
        : window.cranberri.git.files(execution.repoPath ?? activeRepo.path)
    },
    enabled: enabled && !!activeRepo && !execution.pending,
  })
}

export function useGitDiff() {
  const { activeRepo } = useRepos()
  const execution = useGitExecutionRoute()
  return useQuery<DiffResult>({
    queryKey: ['git-diff', activeRepo?.id, ...executionQueryKey(execution)],
    queryFn: async () => {
      if (!activeRepo) return { files: [] }
      assertExecutionAvailable(execution.unavailableReason)
      return execution.taskId
        ? window.cranberri.git.taskDiff(execution.taskId)
        : window.cranberri.git.diff(execution.repoPath ?? activeRepo.path)
    },
    enabled: !!activeRepo && !execution.pending,
    refetchInterval: 2000,
  })
}

export function useGitDiffForFile(path: string | null) {
  const { activeRepo } = useRepos()
  const execution = useGitExecutionRoute()
  return useQuery<DiffResult>({
    queryKey: ['git-diff-file', activeRepo?.id, ...executionQueryKey(execution), path],
    queryFn: async () => {
      if (!activeRepo || !path) return { files: [] }
      assertExecutionAvailable(execution.unavailableReason)
      return execution.taskId
        ? window.cranberri.git.taskDiffFile(execution.taskId, path)
        : window.cranberri.git.diffFile(execution.repoPath ?? activeRepo.path, path)
    },
    enabled: !!activeRepo && !!path && !execution.pending,
  })
}

export function useGitRawContent(path: string | null, ref: 'HEAD' | 'WORKING') {
  const { activeRepo } = useRepos()
  const execution = useGitExecutionRoute()
  return useQuery<string>({
    queryKey: ['git-raw-content', activeRepo?.id, ...executionQueryKey(execution), path, ref],
    queryFn: async () => {
      if (!activeRepo || !path) return ''
      assertExecutionAvailable(execution.unavailableReason)
      return execution.taskId
        ? window.cranberri.git.taskRawContent(execution.taskId, path, ref)
        : window.cranberri.git.rawContent(execution.repoPath ?? activeRepo.path, path, ref)
    },
    enabled: !!activeRepo && !!path && !execution.pending,
  })
}
