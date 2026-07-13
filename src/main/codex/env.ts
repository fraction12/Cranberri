import { execFile } from 'node:child_process'
import { access } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { constants } from 'node:fs'
import { withGuiToolPath } from '../guiToolPath'

export interface CodexRuntime {
  executable: string
  version?: string
  env: NodeJS.ProcessEnv
}

const PATH_MARKER = '__CRANBERRI_CODEX_PATH__'
const ENV_MARKER = '__CRANBERRI_CODEX_ENV__'
let runtimePromise: Promise<CodexRuntime> | null = null

function execute(command: string, args: string[], env: NodeJS.ProcessEnv, timeout = 10_000): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { env, timeout, maxBuffer: 2 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error((stderr?.toString() || error.message).trim()))
        return
      }
      resolve({ stdout: stdout?.toString() ?? '', stderr: stderr?.toString() ?? '' })
    })
  })
}

export function parseShellProbe(output: string): { executable: string; env: NodeJS.ProcessEnv } {
  const pathStart = output.lastIndexOf(`${PATH_MARKER}\n`)
  const envStart = output.lastIndexOf(`${ENV_MARKER}\n`)
  if (pathStart < 0 || envStart < pathStart) throw new Error('Login shell returned malformed Codex resolution output.')
  const executable = output.slice(pathStart + PATH_MARKER.length + 1, envStart).trim()
  const env: NodeJS.ProcessEnv = {}
  for (const entry of output.slice(envStart + ENV_MARKER.length + 1).split('\0')) {
    const separator = entry.indexOf('=')
    if (separator > 0) env[entry.slice(0, separator)] = entry.slice(separator + 1)
  }
  return { executable, env }
}

export function resolveCodexRuntime(): Promise<CodexRuntime> {
  if (runtimePromise) return runtimePromise
  runtimePromise = (async () => {
    const shell = os.userInfo().shell
    if (!shell || !path.isAbsolute(shell)) throw new Error('The system account has no usable login shell for resolving Codex.')
    let probe: { stdout: string; stderr: string }
    try {
      probe = await execute(shell, ['-l', '-c', `printf '${PATH_MARKER}\\n'; command -v codex || true; printf '${ENV_MARKER}\\n'; env -0`], process.env)
    } catch (error) {
      throw new Error(`Could not resolve Codex through login shell ${shell}: ${error instanceof Error ? error.message : String(error)}`, { cause: error })
    }
    const resolved = parseShellProbe(probe.stdout)
    if (!resolved.executable) throw new Error(`Codex was not found in login shell ${shell}. Install or configure Codex in your shell, then restart Cranberri.`)
    if (!path.isAbsolute(resolved.executable)) throw new Error(`Login shell resolved Codex to a non-absolute path: ${resolved.executable}`)
    try {
      await access(resolved.executable, constants.X_OK)
    } catch {
      throw new Error(`Login shell resolved Codex to a missing or non-executable path: ${resolved.executable}`)
    }
    const env = { ...process.env, ...resolved.env }
    const versionResult = await execute(resolved.executable, ['--version'], env).catch(() => null)
    return { executable: resolved.executable, version: versionResult?.stdout.trim() || versionResult?.stderr.trim() || undefined, env }
  })()
  runtimePromise.catch(() => { runtimePromise = null })
  return runtimePromise
}

export async function findNodeBinary(): Promise<string | null> {
  const env = withGuiToolPath(process.env)
  const result = await execute('/usr/bin/which', ['node'], env).catch(() => null)
  return result?.stdout.trim().split('\n')[0] || null
}

export async function makeCodexEnv(extra: Record<string, string> = {}): Promise<NodeJS.ProcessEnv> {
  const runtime = await resolveCodexRuntime()
  return { ...runtime.env, ...extra }
}

export function resetCodexRuntimeForTests(): void {
  runtimePromise = null
}
