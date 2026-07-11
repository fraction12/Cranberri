import { Check, Minus, Monitor, Moon, Plus, Sun } from 'lucide-react'
import { toast } from 'sonner'
import { useAppearance } from '../../state/appearance-context'
import { useSettings } from '../../state/settings'
import { cn, iconButton, segmentedControl, segmentedItem, segmentedItemActive } from '../../lib/ui'
import { typeStyle } from '../../lib/typography'
import { SettingsList, SettingsPage, SettingsSection } from './settings-page'
import {
  APP_CODE_FONT_SIZE_RANGE,
  APP_TERMINAL_FONT_SIZE_RANGE,
  type AppSettings,
  type AppAccent,
  type AppReducedMotion,
  type AppTheme,
  type AppTypePreset,
} from '@/shared/settings'

const THEMES: Array<{ value: AppTheme; label: string; icon: React.ElementType }> = [
  { value: 'system', label: 'System', icon: Monitor },
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
]

const ACCENTS: Array<{ value: AppAccent; label: string; dark: string; light: string; darkContrast: string }> = [
  { value: 'green', label: 'Green', dark: '#22c55e', light: '#15803d', darkContrast: '#08180f' },
  { value: 'blue', label: 'Blue', dark: '#3b82f6', light: '#2563eb', darkContrast: '#07111e' },
  { value: 'orange', label: 'Orange', dark: '#f97316', light: '#c2410c', darkContrast: '#200e04' },
  { value: 'rose', label: 'Rose', dark: '#f43f5e', light: '#e11d48', darkContrast: '#20070d' },
  { value: 'violet', label: 'Violet', dark: '#8b5cf6', light: '#7c3aed', darkContrast: '#0e081c' },
]

const MOTION: Array<{ value: AppReducedMotion; label: string }> = [
  { value: 'system', label: 'System' },
  { value: 'on', label: 'Reduced' },
  { value: 'off', label: 'Full' },
]

const TYPE_PRESETS: Array<{ value: AppTypePreset; label: string }> = [
  { value: 'compact', label: 'Compact' },
  { value: 'standard', label: 'Standard' },
  { value: 'large', label: 'Large' },
]

export function AppearanceSettings() {
  const { settings, updateSection } = useSettings()
  const { theme } = useAppearance()

  async function saveSetting<Section extends keyof AppSettings>(section: Section, values: Partial<AppSettings[Section]>) {
    try {
      await updateSection(section, values)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save appearance settings')
    }
  }

  return (
    <SettingsPage title="Appearance" description="Adjust Cranberri's look and reading comfort.">
      <SettingsSection title="Theme">
        <div className={cn(segmentedControl, 'grid-cols-3')} role="group" aria-label="Theme">
          {THEMES.map(({ value, label, icon: Icon }) => {
            const selected = settings.appearance.theme === value
            return (
              <button
                key={value}
                type="button"
                aria-pressed={selected}
                onClick={() => void saveSetting('appearance', { theme: value })}
                className={cn(
                  segmentedItem,
                  'flex h-9 items-center justify-center gap-2',
                  selected && segmentedItemActive,
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </button>
            )
          })}
        </div>
      </SettingsSection>

      <SettingsSection title="Accent color">
        <div className="flex items-center gap-2.5" role="group" aria-label="Accent color">
          {ACCENTS.map((accent) => {
            const selected = settings.appearance.accent === accent.value
            return (
              <button
                key={accent.value}
                type="button"
                aria-label={accent.label}
                aria-pressed={selected}
                title={accent.label}
                onClick={() => void saveSetting('appearance', { accent: accent.value })}
                className={cn(
                  'flex h-8 w-8 items-center justify-center rounded-full transition-transform duration-fast ease-standard hover:scale-105',
                  selected && 'ring-2 ring-app-elevated ring-offset-1 ring-offset-app-surface',
                )}
                style={{ backgroundColor: accent[theme] }}
              >
                {selected && <Check className="h-4 w-4" style={{ color: theme === 'light' ? '#ffffff' : accent.darkContrast }} />}
              </button>
            )
          })}
        </div>
      </SettingsSection>

      <SettingsSection title="Text size">
        <div className={cn(segmentedControl, 'grid-cols-3')} role="group" aria-label="Interface text size">
          {TYPE_PRESETS.map(({ value, label }) => {
            const selected = settings.appearance.typePreset === value
            return (
              <button
                key={value}
                type="button"
                aria-pressed={selected}
                onClick={() => void saveSetting('appearance', { typePreset: value })}
                className={cn(segmentedItem, 'h-9', selected && segmentedItemActive)}
              >
                {label}
              </button>
            )
          })}
        </div>
        <SettingsList>
          <SizeRow
            label="Code"
            value={settings.editor.fontSize}
            min={APP_CODE_FONT_SIZE_RANGE.min}
            max={APP_CODE_FONT_SIZE_RANGE.max}
            onChange={(fontSize) => void saveSetting('editor', { fontSize })}
          />
          <SizeRow
            label="Terminal"
            value={settings.terminal.fontSize}
            min={APP_TERMINAL_FONT_SIZE_RANGE.min}
            max={APP_TERMINAL_FONT_SIZE_RANGE.max}
            onChange={(fontSize) => void saveSetting('terminal', { fontSize })}
          />
        </SettingsList>
      </SettingsSection>

      <SettingsSection title="Motion">
        <div className={cn(segmentedControl, 'grid-cols-3')} role="group" aria-label="Motion">
          {MOTION.map(({ value, label }) => {
            const selected = settings.appearance.reducedMotion === value
            return (
              <button
                key={value}
                type="button"
                aria-pressed={selected}
                onClick={() => void saveSetting('appearance', { reducedMotion: value })}
                className={cn(segmentedItem, 'h-9', selected && segmentedItemActive)}
              >
                {label}
              </button>
            )
          })}
        </div>
      </SettingsSection>
    </SettingsPage>
  )
}

function SizeRow({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  onChange: (value: number) => void
}) {
  return (
    <div className="flex min-h-12 items-center justify-between gap-4 py-1.5">
      <span className={typeStyle({ role: 'body' })}>{label}</span>
      <div className="flex items-center gap-1" role="group" aria-label={label}>
        <button
          type="button"
          aria-label={`Decrease ${label} font size`}
          disabled={value <= min}
          onClick={() => onChange(Math.max(min, value - 1))}
          className={iconButton()}
        >
          <Minus className="h-3.5 w-3.5" />
        </button>
        <output className={cn('w-12 text-center', typeStyle({ role: 'code' }))} aria-live="polite">{value}px</output>
        <button
          type="button"
          aria-label={`Increase ${label} font size`}
          disabled={value >= max}
          onClick={() => onChange(Math.min(max, value + 1))}
          className={iconButton()}
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )
}
