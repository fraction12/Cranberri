import { execFile } from 'node:child_process'
import path from 'node:path'

async function findExecutable(name: string, candidates: string[]): Promise<string | null> {
  const fromPath = await new Promise<{ stdout: string; code: number | null }>((resolve) => {
    execFile('which', [name], { timeout: 5000 }, (error, stdout) => {
      resolve({ stdout: stdout?.toString() ?? '', code: error ? 1 : 0 })
    })
  })
  const found = fromPath.stdout.trim().split('\n')[0]
  if (fromPath.code === 0 && found) return found

  for (const candidate of candidates) {
    try {
      await import('node:fs/promises').then((fs) => fs.access(candidate))
      return candidate
    } catch {
      // continue
    }
  }
  return null
}

export async function findNodeBinary(): Promise<string | null> {
  return findExecutable('node', ['/opt/homebrew/bin/node', '/usr/local/bin/node'])
}

export async function makeCodexEnv(extra: Record<string, string> = {}): Promise<NodeJS.ProcessEnv> {
  const nodePath = await findNodeBinary()
  const binDir = nodePath ? path.dirname(nodePath) : '/opt/homebrew/bin'
  const basePath = process.env.PATH ?? ''
  const separator = process.platform === 'win32' ? ';' : ':'
  return { ...process.env, ...extra, PATH: `${binDir}${separator}${basePath}` }
}
