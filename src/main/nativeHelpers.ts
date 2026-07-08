import { execFile } from 'node:child_process'
import { shell, systemPreferences } from 'electron'
import type { CranberriHealthCheck } from '../shared/health'
import type { NativeHelperSettingsTarget, NativeHelperStatus } from '../shared/nativeHelpers'

type CommandRunner = (command: string, args: string[]) => Promise<{ stdout: string; stderr: string; code: number | null }>
type SettingsOpener = (url: string) => Promise<unknown>

interface NativeHelperDeps {
  platform?: NodeJS.Platform
  runCommand?: CommandRunner
  isAccessibilityTrusted?: () => boolean
}

interface NativeHelperSettingsDeps {
  platform?: NodeJS.Platform
  openExternal?: SettingsOpener
}

const NATIVE_HELPER_SETTINGS_URLS: Record<NativeHelperSettingsTarget, string> = {
  'macos-accessibility': 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
  'macos-apple-events': 'x-apple.systempreferences:com.apple.preference.security?Privacy_Automation',
}

function run(command: string, args: string[]): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve) => {
    execFile(command, args, { timeout: 3000, maxBuffer: 128 * 1024 }, (error, stdout, stderr) => {
      resolve({
        stdout: stdout?.toString() ?? '',
        stderr: stderr?.toString() ?? '',
        code: error ? 1 : 0,
      })
    })
  })
}

function commandStatus(id: NativeHelperStatus['id'], label: string, available: boolean, detail: string): NativeHelperStatus {
  return {
    id,
    label,
    availability: available ? 'available' : 'error',
    detail,
  }
}

async function scriptCapabilityStatus(id: NativeHelperStatus['id'], label: string, args: string[], runCommand: CommandRunner): Promise<NativeHelperStatus> {
  const result = await runCommand('osascript', args)
  const detail = (result.stdout || result.stderr).trim().split('\n')[0]
  return commandStatus(id, label, result.code === 0, detail || 'osascript did not respond')
}

export async function readNativeHelperStatuses(deps: NativeHelperDeps = {}): Promise<NativeHelperStatus[]> {
  const platform = deps.platform ?? process.platform
  if (platform !== 'darwin') {
    return [
      { id: 'macos-accessibility', label: 'macOS Accessibility', availability: 'unavailable', detail: 'Only required on macOS' },
      { id: 'macos-apple-events', label: 'Apple Events automation', availability: 'unavailable', detail: 'Only required on macOS' },
      { id: 'apple-script', label: 'AppleScript bridge', availability: 'unavailable', detail: 'osascript is macOS-only' },
      { id: 'jxa', label: 'JXA bridge', availability: 'unavailable', detail: 'osascript JavaScript is macOS-only' },
    ]
  }

  const runCommand = deps.runCommand ?? run
  const isAccessibilityTrusted = deps.isAccessibilityTrusted ?? (() => systemPreferences.isTrustedAccessibilityClient(false))
  const accessibilityTrusted = isAccessibilityTrusted()
  const scriptStatuses = await Promise.all([
    scriptCapabilityStatus('apple-script', 'AppleScript bridge', ['-e', 'return "ok"'], runCommand),
    scriptCapabilityStatus('jxa', 'JXA bridge', ['-l', 'JavaScript', '-e', '"ok"'], runCommand),
  ])

  return [
    {
      id: 'macos-accessibility',
      label: 'macOS Accessibility',
      availability: accessibilityTrusted ? 'available' : 'disabled',
      detail: accessibilityTrusted ? 'Accessibility permission is granted' : 'Accessibility permission has not been granted',
      settingsTarget: 'macos-accessibility',
    },
    {
      id: 'macos-apple-events',
      label: 'Apple Events automation',
      availability: 'disabled',
      detail: 'Per-app automation permission is requested only when a helper uses Apple Events',
      settingsTarget: 'macos-apple-events',
    },
    ...scriptStatuses,
  ]
}

export async function openNativeHelperSettings(
  target: NativeHelperSettingsTarget,
  deps: NativeHelperSettingsDeps = {},
): Promise<{ ok: true }> {
  const platform = deps.platform ?? process.platform
  if (platform !== 'darwin') {
    throw new Error('Native helper settings are only available on macOS')
  }
  const url = NATIVE_HELPER_SETTINGS_URLS[target]
  if (!url) throw new Error('Unknown native helper settings target')
  await (deps.openExternal ?? shell.openExternal)(url)
  return { ok: true }
}

export function nativeHelperStatusToHealthCheck(status: NativeHelperStatus): CranberriHealthCheck {
  const level = status.availability === 'error'
    ? 'error'
    : status.availability === 'disabled'
      ? 'warning'
      : 'ok'
  return {
    id: `native-helper-${status.id}`,
    label: status.label,
    level,
    detail: status.detail,
  }
}
