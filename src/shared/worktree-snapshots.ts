import crypto from 'node:crypto'
import path from 'node:path'
import { z } from 'zod'

export const WORKTREE_SNAPSHOT_VERSION = 1 as const
export const MAX_WORKTREE_SNAPSHOT_BYTES = 64 * 1024 * 1024
export const WORKTREE_SNAPSHOT_LIMIT_BYTES = MAX_WORKTREE_SNAPSHOT_BYTES

const shaSchema = z.string().regex(/^[a-f0-9]{40,64}$/)
const digestSchema = z.string().regex(/^[a-f0-9]{64}$/)
const artifactIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/)
const encodedBlobSchema = z.object({
  size: z.number().int().nonnegative().safe(),
  digest: digestSchema,
  base64: z.string(),
}).strict()

const encodedChangesSchema = z.object({
  baseSha: shaSchema,
  stagedPatch: encodedBlobSchema,
  unstagedPatch: encodedBlobSchema,
  untrackedFiles: z.array(z.object({
    relativePath: z.string().min(1),
    mode: z.number().int().min(0).max(0o777),
    contents: encodedBlobSchema,
  }).strict()),
}).strict()

const snapshotBodySchema = z.object({
  version: z.literal(WORKTREE_SNAPSHOT_VERSION),
  artifactId: artifactIdSchema,
  taskId: z.string().min(1),
  worktreeId: z.string().min(1),
  capturedAt: z.number().int().nonnegative().safe(),
  source: z.object({
    gitCommonDir: z.string().min(1),
    headSha: shaSchema,
    branch: z.string().min(1).nullable(),
    privateRef: z.string().regex(/^refs\/cranberri\/tasks\/[A-Za-z0-9._-]+$/),
    environmentRevision: z.string().min(1).nullable(),
  }).strict(),
  changes: encodedChangesSchema,
  headArchive: z.object({
    format: z.literal('git-bundle-v1'),
    ref: z.string().regex(/^refs\/cranberri\/tasks\/[A-Za-z0-9._-]+$/),
    contents: encodedBlobSchema,
  }).strict().nullable(),
}).strict()

const artifactSchema = z.object({
  body: snapshotBodySchema,
  digest: digestSchema,
}).strict()

export const worktreeSnapshotDescriptorSchema = z.object({
  version: z.literal(WORKTREE_SNAPSHOT_VERSION),
  artifactId: artifactIdSchema,
  taskId: z.string().min(1),
  worktreeId: z.string().min(1),
  artifactPath: z.string().min(1),
  artifactBytes: z.number().int().nonnegative().max(MAX_WORKTREE_SNAPSHOT_BYTES),
  artifactDigestSha256: digestSchema,
  headSha: shaSchema,
  bundleIncluded: z.boolean(),
}).strict()

export interface SnapshotLocalChanges {
  baseSha: string
  stagedPatch: Buffer
  unstagedPatch: Buffer
  untrackedFiles: Array<{ relativePath: string; contents: Buffer; mode: number }>
}

export interface WorktreeSnapshot {
  artifactId: string
  taskId: string
  worktreeId: string
  capturedAt: number
  source: {
    gitCommonDir: string
    headSha: string
    branch: string | null
    privateRef: string
    environmentRevision: string | null
  }
  changes: SnapshotLocalChanges
  headArchive: {
    format: 'git-bundle-v1'
    ref: string
    contents: Buffer
  } | null
}

export type WorktreeSnapshotDescriptor = z.infer<typeof worktreeSnapshotDescriptorSchema>

type EncodedBlob = z.infer<typeof encodedBlobSchema>

export function snapshotDigest(contents: string | Buffer): string {
  return crypto.createHash('sha256').update(contents).digest('hex')
}

export const worktreeSnapshotDigest = snapshotDigest

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(',')}}`
}

function encodeBlob(contents: Buffer): EncodedBlob {
  return { size: contents.length, digest: snapshotDigest(contents), base64: contents.toString('base64') }
}

function decodeBlob(blob: EncodedBlob): Buffer {
  const contents = Buffer.from(blob.base64, 'base64')
  if (contents.toString('base64') !== blob.base64) throw new Error('Snapshot contains invalid base64 data')
  if (contents.length !== blob.size) throw new Error('Snapshot payload size mismatch')
  if (snapshotDigest(contents) !== blob.digest) throw new Error('Snapshot payload digest mismatch')
  return contents
}

export function assertSnapshotRelativePath(relativePath: string): string {
  if (relativePath.includes('\0') || relativePath.includes('\\') || path.posix.isAbsolute(relativePath)) {
    throw new Error('Snapshot contains an unsafe path')
  }
  const parts = relativePath.split('/')
  if (parts.some((part) => !part || part === '.' || part === '..')) {
    throw new Error('Snapshot contains an unsafe path')
  }
  if (parts.some((part) => part.toLowerCase() === '.git')) {
    throw new Error('Snapshot path targets Git metadata')
  }
  if (path.posix.normalize(relativePath) !== relativePath) throw new Error('Snapshot contains an unsafe path')
  return relativePath
}

export const validateSnapshotRelativePath = assertSnapshotRelativePath

function assertValidSnapshot(snapshot: WorktreeSnapshot): void {
  if (snapshot.changes.baseSha !== snapshot.source.headSha) {
    throw new Error('Snapshot local changes do not match its HEAD')
  }
  if (snapshot.headArchive && (snapshot.headArchive.ref !== snapshot.source.privateRef)) {
    throw new Error('Snapshot Git archive does not match its private ref')
  }
  const paths = new Set<string>()
  for (const file of snapshot.changes.untrackedFiles) {
    assertSnapshotRelativePath(file.relativePath)
    if (paths.has(file.relativePath)) throw new Error('Snapshot contains duplicate untracked paths')
    paths.add(file.relativePath)
    if (!Number.isInteger(file.mode) || file.mode < 0 || file.mode > 0o777) {
      throw new Error('Snapshot contains an unsupported file mode')
    }
  }
}

export function assertWorktreeSnapshotSize(byteLength: number): void {
  if (!Number.isSafeInteger(byteLength) || byteLength < 0 || byteLength > MAX_WORKTREE_SNAPSHOT_BYTES) {
    throw new Error('Worktree snapshot exceeds the 64 MiB limit')
  }
}

export function encodeWorktreeSnapshot(snapshot: WorktreeSnapshot): Buffer {
  assertValidSnapshot(snapshot)
  const body = snapshotBodySchema.parse({
    version: WORKTREE_SNAPSHOT_VERSION,
    artifactId: snapshot.artifactId,
    taskId: snapshot.taskId,
    worktreeId: snapshot.worktreeId,
    capturedAt: snapshot.capturedAt,
    source: snapshot.source,
    changes: {
      baseSha: snapshot.changes.baseSha,
      stagedPatch: encodeBlob(snapshot.changes.stagedPatch),
      unstagedPatch: encodeBlob(snapshot.changes.unstagedPatch),
      untrackedFiles: snapshot.changes.untrackedFiles.map((file) => ({
        relativePath: file.relativePath,
        mode: file.mode,
        contents: encodeBlob(file.contents),
      })),
    },
    headArchive: snapshot.headArchive ? {
      format: snapshot.headArchive.format,
      ref: snapshot.headArchive.ref,
      contents: encodeBlob(snapshot.headArchive.contents),
    } : null,
  })
  const encoded = Buffer.from(stableJson({ body, digest: snapshotDigest(stableJson(body)) }))
  assertWorktreeSnapshotSize(encoded.length)
  return encoded
}

export function decodeWorktreeSnapshot(encoded: Buffer): WorktreeSnapshot {
  assertWorktreeSnapshotSize(encoded.length)
  let input: unknown
  try {
    input = JSON.parse(encoded.toString('utf8'))
  } catch (error) {
    throw new Error('Cannot parse worktree snapshot', { cause: error })
  }
  const artifact = artifactSchema.parse(input)
  if (snapshotDigest(stableJson(artifact.body)) !== artifact.digest) {
    throw new Error('Worktree snapshot digest mismatch')
  }
  const snapshot: WorktreeSnapshot = {
    artifactId: artifact.body.artifactId,
    taskId: artifact.body.taskId,
    worktreeId: artifact.body.worktreeId,
    capturedAt: artifact.body.capturedAt,
    source: artifact.body.source,
    changes: {
      baseSha: artifact.body.changes.baseSha,
      stagedPatch: decodeBlob(artifact.body.changes.stagedPatch),
      unstagedPatch: decodeBlob(artifact.body.changes.unstagedPatch),
      untrackedFiles: artifact.body.changes.untrackedFiles.map((file) => ({
        relativePath: file.relativePath,
        mode: file.mode,
        contents: decodeBlob(file.contents),
      })),
    },
    headArchive: artifact.body.headArchive ? {
      format: artifact.body.headArchive.format,
      ref: artifact.body.headArchive.ref,
      contents: decodeBlob(artifact.body.headArchive.contents),
    } : null,
  }
  assertValidSnapshot(snapshot)
  return snapshot
}
