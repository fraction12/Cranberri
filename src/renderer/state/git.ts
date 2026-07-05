import { useQuery } from '@tanstack/react-query'
import { useRepos } from './repos'
import type { GitFileStatus, DiffResult } from '@/shared/git'

export function useGitStatus() {
  const { activeRepo } = useRepos()
  return useQuery<GitFileStatus[]>({
    queryKey: ['git-status', activeRepo?.id],
    queryFn: async () => {
      if (!activeRepo) return []
      return window.cranberri.git.status(activeRepo.path)
    },
    enabled: !!activeRepo,
    refetchInterval: 2000,
  })
}

export function useGitFiles() {
  const { activeRepo } = useRepos()
  return useQuery<import('@/shared/git').FileTreeNode[]>({
    queryKey: ['git-files', activeRepo?.id],
    queryFn: async () => {
      if (!activeRepo) return []
      return window.cranberri.git.files(activeRepo.path)
    },
    enabled: !!activeRepo,
    refetchInterval: 5000,
  })
}

export function useGitDiff() {
  const { activeRepo } = useRepos()
  return useQuery<DiffResult>({
    queryKey: ['git-diff', activeRepo?.id],
    queryFn: async () => {
      if (!activeRepo) return { files: [] }
      return window.cranberri.git.diff(activeRepo.path)
    },
    enabled: !!activeRepo,
    refetchInterval: 2000,
  })
}

export function useGitDiffForFile(path: string | null) {
  const { activeRepo } = useRepos()
  return useQuery<DiffResult>({
    queryKey: ['git-diff-file', activeRepo?.id, path],
    queryFn: async () => {
      if (!activeRepo || !path) return { files: [] }
      return window.cranberri.git.diffFile(activeRepo.path, path)
    },
    enabled: !!activeRepo && !!path,
  })
}
