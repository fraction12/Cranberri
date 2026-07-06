import path from 'node:path'

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
