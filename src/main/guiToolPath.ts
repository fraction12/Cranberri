const GUI_TOOL_PATH_DIRS = [
  '/opt/homebrew/bin',
  '/usr/local/bin',
  '/usr/bin',
  '/bin',
  '/usr/sbin',
  '/sbin',
]

export function withGuiToolPath(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const separator = process.platform === 'win32' ? ';' : ':'
  const existingPath = env.PATH?.split(separator).filter(Boolean) ?? []
  const pathEntries = [...GUI_TOOL_PATH_DIRS, ...existingPath]
  const dedupedPathEntries = pathEntries.filter((entry, index) => pathEntries.indexOf(entry) === index)

  return {
    ...env,
    PATH: dedupedPathEntries.join(separator),
  }
}
