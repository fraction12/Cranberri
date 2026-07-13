import { describe, expect, it, vi } from 'vitest'
import {
  parseShellProbe,
  resolveCodexRuntimeUncached,
  type CodexRuntimeDependencies,
} from './env'

function shellOutput(executable: string): string {
  return [
    'welcome from interactive shell startup',
    '__CRANBERRI_CODEX_PATH__',
    executable,
    '__CRANBERRI_CODEX_ENV__',
    'PATH=/Users/example/.local/bin:/opt/homebrew/bin\0HOME=/Users/example\0',
  ].join('\n')
}

function dependencies(shellExecutable = '/Users/example/.local/bin/codex') {
  const execute = vi.fn<CodexRuntimeDependencies['execute']>(async (command, args) => {
    if (command === '/bin/zsh') return { stdout: shellOutput(shellExecutable), stderr: '' }
    if (args[0] === '--version') return { stdout: 'codex-cli 0.144.1\n', stderr: '' }
    throw new Error(`Unexpected command: ${command} ${args.join(' ')}`)
  })
  const accessExecutable = vi.fn<CodexRuntimeDependencies['accessExecutable']>(async () => undefined)
  return {
    dependencies: {
      execute,
      accessExecutable,
      loginShell: () => '/bin/zsh',
      processEnv: { PATH: '/usr/bin', HOME: '/Users/example' },
    },
    execute,
    accessExecutable,
  }
}

describe('Codex login-shell runtime', () => {
  it('extracts framed path and environment despite shell startup output', () => {
    const result = parseShellProbe(shellOutput('/Users/example/.local/bin/codex'))

    expect(result.executable).toBe('/Users/example/.local/bin/codex')
    expect(result.env.PATH).toBe('/Users/example/.local/bin:/opt/homebrew/bin')
    expect(result.env.HOME).toBe('/Users/example')
  })

  it('rejects unframed shell output', () => {
    expect(() => parseShellProbe('/opt/homebrew/bin/codex')).toThrow('malformed')
  })

  it('uses the executable selected by the interactive shell when multiple installs exist', async () => {
    const { dependencies: deps, execute, accessExecutable } = dependencies()

    const runtime = await resolveCodexRuntimeUncached({ runtimeMode: 'automatic' }, deps)

    expect(runtime).toMatchObject({
      executable: '/Users/example/.local/bin/codex',
      version: 'codex-cli 0.144.1',
      source: 'automatic',
    })
    expect(accessExecutable).toHaveBeenCalledWith('/Users/example/.local/bin/codex')
    expect(execute.mock.calls[0]?.[1]).toEqual(expect.arrayContaining(['-ilc']))
    expect(execute.mock.calls[0]?.[1].join(' ')).toContain('whence -p codex')
  })

  it('honors a selected executable while retaining the shell environment', async () => {
    const { dependencies: deps, accessExecutable } = dependencies('/opt/homebrew/bin/codex')

    const runtime = await resolveCodexRuntimeUncached({
      runtimeMode: 'custom',
      executablePath: '/Applications/Codex CLI/bin/codex',
    }, deps)

    expect(runtime).toMatchObject({
      executable: '/Applications/Codex CLI/bin/codex',
      source: 'custom',
      env: { PATH: '/Users/example/.local/bin:/opt/homebrew/bin' },
    })
    expect(accessExecutable).toHaveBeenCalledWith('/Applications/Codex CLI/bin/codex')
  })

  it('rejects an empty custom selection with an actionable error', async () => {
    const { dependencies: deps } = dependencies()

    await expect(resolveCodexRuntimeUncached({ runtimeMode: 'custom' }, deps))
      .rejects.toThrow('Choose another executable or use Automatic')
  })
})
