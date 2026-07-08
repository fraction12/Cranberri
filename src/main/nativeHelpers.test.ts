import { describe, expect, it, vi } from 'vitest'
import { nativeHelperStatusToHealthCheck, openNativeHelperSettings, readNativeHelperStatuses } from './nativeHelpers'

describe('native helper diagnostics', () => {
  it('does not require macOS helpers on other platforms', async () => {
    const statuses = await readNativeHelperStatuses({ platform: 'linux' })

    expect(statuses).toHaveLength(4)
    expect(statuses.every((status) => status.availability === 'unavailable')).toBe(true)
    expect(statuses.map(nativeHelperStatusToHealthCheck).every((check) => check.level === 'ok')).toBe(true)
  })

  it('checks macOS Accessibility without prompting and verifies script bridges', async () => {
    const runCommand = vi.fn(async () => ({ stdout: 'ok\n', stderr: '', code: 0 }))
    const statuses = await readNativeHelperStatuses({
      platform: 'darwin',
      runCommand,
      isAccessibilityTrusted: () => true,
    })

    expect(statuses).toContainEqual({
      id: 'macos-accessibility',
      label: 'macOS Accessibility',
      availability: 'available',
      detail: 'Accessibility permission is granted',
      settingsTarget: 'macos-accessibility',
    })
    expect(statuses.find((status) => status.id === 'macos-apple-events')?.settingsTarget).toBe('macos-apple-events')
    expect(statuses.find((status) => status.id === 'apple-script')?.availability).toBe('available')
    expect(statuses.find((status) => status.id === 'jxa')?.availability).toBe('available')
    expect(runCommand).toHaveBeenCalledWith('osascript', ['-e', 'return "ok"'])
    expect(runCommand).toHaveBeenCalledWith('osascript', ['-l', 'JavaScript', '-e', '"ok"'])
  })

  it('marks disabled helper permissions as warning-level health checks', () => {
    expect(nativeHelperStatusToHealthCheck({
      id: 'macos-accessibility',
      label: 'macOS Accessibility',
      availability: 'disabled',
      detail: 'Not granted',
    })).toMatchObject({ level: 'warning' })
  })

  it('opens only known native helper settings on macOS', async () => {
    const openExternal = vi.fn(async () => undefined)

    await expect(openNativeHelperSettings('macos-accessibility', { platform: 'darwin', openExternal })).resolves.toEqual({ ok: true })

    expect(openExternal).toHaveBeenCalledWith('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility')
  })

  it('rejects native helper settings on non-macOS platforms', async () => {
    await expect(openNativeHelperSettings('macos-accessibility', { platform: 'linux', openExternal: vi.fn() })).rejects.toThrow('only available on macOS')
  })
})
