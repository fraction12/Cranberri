export function repoAbsolutePath(repoPath: string, filePath: string): string {
  const cleanRepoPath = repoPath.replace(/\/+$/, '')
  const cleanFilePath = filePath.replace(/^\/+/, '')
  return `${cleanRepoPath}/${cleanFilePath}`
}
