import type { DiffResult, GitFileStatus } from '@/shared/git'

export {}

declare global {
  interface Window {
    cranberri: {
      getVersion: () => Promise<string>
      repos: {
        list: () => Promise<{ repos: Array<{ id: string; name: string; path: string }>; activeRepoId: string | null }>
        add: (path: string) => Promise<{ repos: Array<{ id: string; name: string; path: string }>; activeRepoId: string | null }>
        remove: (id: string) => Promise<{ repos: Array<{ id: string; name: string; path: string }>; activeRepoId: string | null }>
        setActive: (id: string) => Promise<{ repos: Array<{ id: string; name: string; path: string }>; activeRepoId: string | null }>
        pickDirectory: () => Promise<string | null>
      }
      git: {
        status: (repoPath: string) => Promise<GitFileStatus[]>
        diff: (repoPath: string) => Promise<DiffResult>
      }
    }
  }
}
