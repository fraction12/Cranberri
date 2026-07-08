import { z } from 'zod'

export const repoSearchOptionsSchema = z.object({
  query: z.string().max(500),
  maxResults: z.number().int().min(1).max(1000).default(200),
  includeHidden: z.boolean().default(false),
  globs: z.array(z.string().min(1).max(200)).max(20).default([]),
})

export type RepoSearchOptions = z.input<typeof repoSearchOptionsSchema>

export const repoFileSearchOptionsSchema = z.object({
  query: z.string().max(500),
  maxResults: z.number().int().min(1).max(200).default(50),
  includeHidden: z.boolean().default(false),
  globs: z.array(z.string().min(1).max(200)).max(20).default([]),
})

export type RepoFileSearchOptions = z.input<typeof repoFileSearchOptionsSchema>

export interface RepoSearchMatch {
  path: string
  line: number
  column: number
  text: string
}

export interface RepoSearchResult {
  query: string
  matches: RepoSearchMatch[]
  truncated: boolean
}

export interface RepoFileSearchMatch {
  path: string
  basename: string
  directory: string
  score: number
}

export interface RepoFileSearchResult {
  query: string
  matches: RepoFileSearchMatch[]
  truncated: boolean
}

export interface FilePreviewResult {
  path: string
  text: string
  isBinary: boolean
  truncated: boolean
  size: number
}

export const repoWatchEventTypeSchema = z.enum(['add', 'change', 'unlink'])
export type RepoWatchEventType = z.infer<typeof repoWatchEventTypeSchema>

export const repoWatchEventSchema = z.object({
  repoPath: z.string(),
  events: z.array(z.object({
    type: repoWatchEventTypeSchema,
    path: z.string(),
  })).max(200),
  truncated: z.boolean(),
  changedAt: z.number(),
})

export type RepoWatchEvent = z.infer<typeof repoWatchEventSchema>
