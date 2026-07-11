import path from 'node:path'
import fs from 'node:fs'

function assertContained(root: string, candidate: string): void {
  const relative = path.relative(root, candidate)
  if (!relative || relative === '.') return
  if (relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) {
    throw new Error('Path is outside managed root')
  }
}

export function authorizeExistingPath(rootPath: string, candidatePath: string): string {
  const root = fs.realpathSync(rootPath)
  const candidate = fs.realpathSync(candidatePath)
  assertContained(root, candidate)
  return candidate
}

export function authorizeManagedPath(rootPath: string, candidatePath: string): string {
  const lexicalRoot = path.resolve(rootPath)
  const absolute = path.resolve(candidatePath)
  assertContained(lexicalRoot, absolute)

  let existing = absolute
  while (!fs.existsSync(existing)) {
    const parent = path.dirname(existing)
    if (parent === existing) throw new Error('Managed path has no existing ancestor')
    existing = parent
  }
  const root = fs.realpathSync(rootPath)
  const canonicalAncestor = fs.realpathSync(existing)
  assertContained(root, canonicalAncestor)
  return path.join(canonicalAncestor, path.relative(existing, absolute))
}

export function validateRepoPath(repoPath: string, registeredRepoPaths: string[]): string {
  const normalized = path.resolve(repoPath)
  const registered = new Set(registeredRepoPaths.map((item) => path.resolve(item)))
  if (!registered.has(normalized)) {
    throw new Error('Repo is not registered')
  }
  return normalized
}

export function resolveRepoFilePath(repoPath: string, filePath: string): string {
  if (path.isAbsolute(filePath)) {
    throw new Error('File path must be relative')
  }

  const repoRoot = path.resolve(repoPath)
  const resolved = path.resolve(repoRoot, filePath)
  const relative = path.relative(repoRoot, resolved)
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('File path escapes repo')
  }
  return resolved
}

export function validateRepoRelativePath(repoPath: string, filePath: string): string {
  const resolved = resolveRepoFilePath(repoPath, filePath)
  return path.relative(path.resolve(repoPath), resolved)
}
