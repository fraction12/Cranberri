import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { CODE_LINE_HEIGHT, TERMINAL_LINE_HEIGHT, typeStyle } from './typography'

const css = fs.readFileSync(fileURLToPath(new URL('../index.css', import.meta.url)), 'utf8')

function cssBlock(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))
  if (!match) throw new Error(`Missing CSS block: ${selector}`)
  return match[1]
}

function cssValue(block: string, variable: string): string {
  const match = block.match(new RegExp(`${variable}:\\s*([^;]+);`))
  if (!match) throw new Error(`Missing CSS variable: ${variable}`)
  return match[1].trim()
}

function rgb(block: string, variable: string): [number, number, number] {
  const channels = cssValue(block, variable).split(/\s+/).map(Number)
  if (channels.length !== 3 || channels.some((channel) => !Number.isFinite(channel))) {
    throw new Error(`Invalid RGB variable: ${variable}`)
  }
  return channels as [number, number, number]
}

function luminance([red, green, blue]: [number, number, number]): number {
  const linear = [red, green, blue].map((channel) => {
    const value = channel / 255
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  })
  return (0.2126 * linear[0]) + (0.7152 * linear[1]) + (0.0722 * linear[2])
}

function contrast(foreground: [number, number, number], background: [number, number, number]): number {
  const foregroundLuminance = luminance(foreground)
  const backgroundLuminance = luminance(background)
  return (Math.max(foregroundLuminance, backgroundLuminance) + 0.05)
    / (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
}

describe('semantic typography roles', () => {
  it('returns deterministic role and tone classes', () => {
    expect(typeStyle({ role: 'pageTitle' })).toContain('type-page-title')
    expect(typeStyle({ role: 'prose' })).toContain('type-prose')
    expect(typeStyle({ role: 'proseHeading3' })).toContain('type-prose-heading-3')
    expect(typeStyle({ role: 'body', tone: 'secondary' })).toContain('text-app-text-secondary')
    expect(typeStyle({ role: 'status', tone: 'danger' })).toContain('text-app-status-danger')
    expect(typeStyle({ role: 'code' })).toContain('font-mono')
    expect(typeStyle({ role: 'metadata', family: 'mono' })).toContain('font-mono')
    expect(typeStyle({ role: 'metadata', family: 'mono' })).not.toContain('font-sans')
  })

  it('defines deliberate metrics for all three presets', () => {
    const compact = cssBlock(":root[data-type-preset='compact']")
    const standard = cssBlock(':root')
    const large = cssBlock(":root[data-type-preset='large']")

    expect(cssValue(compact, '--app-type-body-size')).toBe('12px')
    expect(cssValue(compact, '--app-type-body-line')).toBe('18px')
    expect(cssValue(compact, '--app-type-prose-size')).toBe('14px')
    expect(cssValue(compact, '--app-type-prose-line')).toBe('22px')

    expect(cssValue(standard, '--app-type-body-size')).toBe('13px')
    expect(cssValue(standard, '--app-type-body-line')).toBe('20px')
    expect(cssValue(standard, '--app-type-prose-size')).toBe('15px')
    expect(cssValue(standard, '--app-type-prose-line')).toBe('24px')

    expect(cssValue(large, '--app-type-body-size')).toBe('14px')
    expect(cssValue(large, '--app-type-body-line')).toBe('22px')
    expect(cssValue(large, '--app-type-prose-size')).toBe('16px')
    expect(cssValue(large, '--app-type-prose-line')).toBe('26px')
    expect(Number(cssValue(standard, '--app-code-line-height'))).toBe(CODE_LINE_HEIGHT)
    expect(Number(cssValue(standard, '--app-terminal-line-height'))).toBe(TERMINAL_LINE_HEIGHT)
  })

  it('keeps every enabled semantic text tone above 4.5:1 on app surfaces', () => {
    const themes = [cssBlock(':root'), cssBlock(":root[data-theme='light']")]
    const foregrounds = [
      '--app-text-rgb',
      '--app-text-secondary-rgb',
      '--app-text-tertiary-rgb',
      '--app-status-success-rgb',
      '--app-status-warning-rgb',
      '--app-status-info-rgb',
      '--app-status-danger-rgb',
      '--app-mention-rgb',
    ]
    const backgrounds = [
      '--app-bg-rgb',
      '--app-surface-rgb',
      '--app-surface-2-rgb',
      '--app-elevated-rgb',
    ]

    for (const theme of themes) {
      for (const foreground of foregrounds) {
        for (const background of backgrounds) {
          expect(contrast(rgb(theme, foreground), rgb(theme, background)), `${foreground} on ${background}`).toBeGreaterThanOrEqual(4.5)
        }
      }
    }
  })
})
