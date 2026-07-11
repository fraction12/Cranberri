import { useQuery } from '@tanstack/react-query'
import { useRepos } from './repos'
import { useWorkspace } from './workspace'
import type { GitFileStatus, DiffResult } from '@/shared/git'

function useActiveTaskId(): string | null {
  const { windows, activeWindowId } = useWorkspace()
  return windows.find((window) => window.id === activeWindowId)?.taskId ?? null
}

export function useGitStatus(enabled = true) {
  const { activeRepo } = useRepos()
  const taskId = useActiveTaskId()
  return useQuery<GitFileStatus[]>({
    queryKey: ['git-status', activeRepo?.id, taskId],
    queryFn: async () => {
      if (!activeRepo) return []
      return taskId
        ? window.cranberri.git.taskStatus(taskId)
        : window.cranberri.git.status(activeRepo.path)
    },
    enabled: enabled && !!activeRepo,
    refetchInterval: enabled ? 3_000 : false,
  })
}

export function useGitFiles(enabled = true) {
  const { activeRepo } = useRepos()
  const taskId = useActiveTaskId()
  return useQuery<import('@/shared/git').FileTreeNode[]>({
    queryKey: ['git-files', activeRepo?.id, taskId],
    queryFn: async () => {
      if (!activeRepo) return []
      return taskId
        ? window.cranberri.git.taskFiles(taskId)
        : window.cranberri.git.files(activeRepo.path)
    },
    enabled: enabled && !!activeRepo,
  })
}

export function useGitDiff() {
  const { activeRepo } = useRepos()
  const taskId = useActiveTaskId()
  return useQuery<DiffResult>({
    queryKey: ['git-diff', activeRepo?.id, taskId],
    queryFn: async () => {
      if (!activeRepo) return { files: [] }
      return taskId
        ? window.cranberri.git.taskDiff(taskId)
        : window.cranberri.git.diff(activeRepo.path)
    },
    enabled: !!activeRepo,
    refetchInterval: 2000,
  })
}

export function useGitDiffForFile(path: string | null) {
  const { activeRepo } = useRepos()
  const taskId = useActiveTaskId()
  return useQuery<DiffResult>({
    queryKey: ['git-diff-file', activeRepo?.id, taskId, path],
    queryFn: async () => {
      if (!activeRepo || !path) return { files: [] }
      return taskId
        ? window.cranberri.git.taskDiffFile(taskId, path)
        : window.cranberri.git.diffFile(activeRepo.path, path)
    },
    enabled: !!activeRepo && !!path,
  })
}

export function useGitRawContent(path: string | null, ref: 'HEAD' | 'WORKING') {
  const { activeRepo } = useRepos()
  const taskId = useActiveTaskId()
  return useQuery<string>({
    queryKey: ['git-raw-content', activeRepo?.id, taskId, path, ref],
    queryFn: async () => {
      if (!activeRepo || !path) return ''
      return taskId
        ? window.cranberri.git.taskRawContent(taskId, path, ref)
        : window.cranberri.git.rawContent(activeRepo.path, path, ref)
    },
    enabled: !!activeRepo && !!path,
  })
}
