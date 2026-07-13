import { execFile } from 'node:child_process'
import { constants } from 'node:fs'
import { access } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { AppSettings } from '../../shared/settings'
import { readSettings } from '../settings'
import { withGuiToolPath } from '../guiToolPath'

export interface CodexRuntime {
  executable: string
  version?: string
  env: NodeJS.ProcessEnv
  source: 'automatic' | 'custom'
}

export type CodexRuntimePreference = Pick<AppSettings['codex'], 'runtimeMode' | 'executablePath'>

interface CommandResult {
  stdout: string
  stderr: string
}

export interface CodexRuntimeDependencies {
  execute: (command: string, args: string[], env: NodeJS.ProcessEnv, timeout?: number) => Promise<CommandResult>
  accessExecutable: (filePath: string) => Promise<void>
  loginShell: () => string | null
  processEnv: NodeJS.ProcessEnv
}

const PATH_MARKER = '__CRANBERRI_CODEX_PATH__'
const ENV_MARKER = '__CRANBERRI_CODEX_ENV__'
let runtimeCache: { key: string; promise: Promise<CodexRuntime> } | null = null

function execute(command: string, args: string[], env: NodeJS.ProcessEnv, timeout = 10_000): Promise<CommandResult> {
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

const defaultDependencies: CodexRuntimeDependencies = {
  execute,
  accessExecutable: (filePath) => access(filePath, constants.X_OK),
  loginShell: () => os.userInfo().shell,
  processEnv: process.env,
}

function shellProbeArgs(shell: string): string[] {
  const shellName = path.basename(shell)
  const findCodex = shellName === 'zsh'
    ? 'whence -p codex'
    : shellName === 'bash'
      ? 'type -P codex'
      : shellName === 'fish'
        ? 'type -p codex'
        : 'command -v codex'
  const command = `printf '${PATH_MARKER}\\n'; ${findCodex} || true; printf '${ENV_MARKER}\\n'; env -0`
  if (shellName === 'fish') return ['--login', '--interactive', '--command', command]
  if (shellName === 'bash') return ['--login', '-i', '-c', command]
  return ['-ilc', command]
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

export async function resolveCodexRuntimeUncached(
  preference: CodexRuntimePreference,
  dependencies: CodexRuntimeDependencies = defaultDependencies,
): Promise<CodexRuntime> {
  const shell = dependencies.loginShell()
  if (!shell || !path.isAbsolute(shell)) throw new Error('The system account has no usable login shell for resolving Codex.')

  let probe: CommandResult
  try {
    probe = await dependencies.execute(shell, shellProbeArgs(shell), dependencies.processEnv)
  } catch (error) {
    throw new Error(`Could not read the interactive login shell ${shell}: ${error instanceof Error ? error.message : String(error)}`, { cause: error })
  }

  const resolved = parseShellProbe(probe.stdout)
  const configuredPath = preference.executablePath?.trim()
  const executable = preference.runtimeMode === 'custom' ? configuredPath ?? '' : resolved.executable
  if (!executable) {
    if (preference.runtimeMode === 'custom') throw new Error('The selected Codex executable is missing. Choose another executable or use Automatic.')
    throw new Error(`Codex was not found in interactive login shell ${shell}. Install or configure Codex in your shell, then restart Cranberri.`)
  }
  if (!path.isAbsolute(executable)) throw new Error(`Codex resolved to a non-absolute path: ${executable}`)
  try {
    await dependencies.accessExecutable(executable)
  } catch {
    throw new Error(`Codex is missing or not executable: ${executable}`)
  }

  const env = { ...dependencies.processEnv, ...resolved.env }
  const versionResult = await dependencies.execute(executable, ['--version'], env).catch(() => null)
  return {
    executable,
    version: versionResult?.stdout.trim() || versionResult?.stderr.trim() || undefined,
    env,
    source: preference.runtimeMode,
  }
}

export function resolveCodexRuntime(): Promise<CodexRuntime> {
  const { runtimeMode, executablePath } = readSettings().codex
  const preference = { runtimeMode, executablePath }
  const key = JSON.stringify(preference)
  if (runtimeCache?.key === key) return runtimeCache.promise
  const promise = resolveCodexRuntimeUncached(preference)
  runtimeCache = { key, promise }
  promise.catch(() => {
    if (runtimeCache?.promise === promise) runtimeCache = null
  })
  return promise
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

export function resetCodexRuntime(): void {
  runtimeCache = null
}

export const resetCodexRuntimeForTests = resetCodexRuntime
