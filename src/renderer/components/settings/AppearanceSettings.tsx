import { Check, Minus, Monitor, Moon, Plus, Sun } from 'lucide-react'
import { useAppearance } from '../../state/appearance-context'
import { useSettings } from '../../state/settings'
import {
  APP_CODE_FONT_SIZE_RANGE,
  APP_TERMINAL_FONT_SIZE_RANGE,
  APP_UI_FONT_SIZE_RANGE,
  type AppAccent,
  type AppReducedMotion,
  type AppTheme,
} from '@/shared/settings'

const THEMES: Array<{ value: AppTheme; label: string; icon: React.ElementType }> = [
  { value: 'system', label: 'System', icon: Monitor },
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
]

const ACCENTS: Array<{ value: AppAccent; label: string; dark: string; light: string; darkContrast: string }> = [
  { value: 'green', label: 'Green', dark: '#22c55e', light: '#15803d', darkContrast: '#08180f' },
  { value: 'blue', label: 'Blue', dark: '#3b82f6', light: '#2563eb', darkContrast: '#ffffff' },
  { value: 'orange', label: 'Orange', dark: '#f97316', light: '#c2410c', darkContrast: '#200e04' },
  { value: 'rose', label: 'Rose', dark: '#f43f5e', light: '#e11d48', darkContrast: '#ffffff' },
  { value: 'violet', label: 'Violet', dark: '#8b5cf6', light: '#7c3aed', darkContrast: '#ffffff' },
]

const MOTION: Array<{ value: AppReducedMotion; label: string }> = [
  { value: 'system', label: 'System' },
  { value: 'on', label: 'Reduced' },
  { value: 'off', label: 'Full' },
]

export function AppearanceSettings() {
  const { settings, updateSection } = useSettings()
  const { theme } = useAppearance()

  return (
    <div className="space-y-7">
      <header>
        <h2 className="text-lg font-semibold text-app-text">Appearance</h2>
      </header>

      <ControlGroup label="Theme">
        <div className="grid grid-cols-3 gap-1 rounded-lg bg-app-surface-2 p-1" role="group" aria-label="Theme">
          {THEMES.map(({ value, label, icon: Icon }) => {
            const selected = settings.appearance.theme === value
            return (
              <button
                key={value}
                type="button"
                aria-pressed={selected}
                onClick={() => void updateSection('appearance', { theme: value })}
                className={`flex h-9 items-center justify-center gap-2 rounded-md text-sm transition-colors ${
                  selected ? 'bg-app-surface text-app-text shadow-sm' : 'text-app-text-muted hover:text-app-text'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </button>
            )
          })}
        </div>
      </ControlGroup>

      <ControlGroup label="Accent">
        <div className="flex items-center gap-3" role="group" aria-label="Accent color">
          {ACCENTS.map((accent) => {
            const selected = settings.appearance.accent === accent.value
            return (
              <button
                key={accent.value}
                type="button"
                aria-label={accent.label}
                aria-pressed={selected}
                title={accent.label}
                onClick={() => void updateSection('appearance', { accent: accent.value })}
                className="flex h-8 w-8 items-center justify-center rounded-full ring-offset-2 ring-offset-app-bg transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-text-muted"
                style={{ backgroundColor: accent[theme] }}
              >
                {selected && <Check className="h-4 w-4" style={{ color: theme === 'light' ? '#ffffff' : accent.darkContrast }} />}
              </button>
            )
          })}
        </div>
      </ControlGroup>

      <div className="divide-y divide-app-border border-y border-app-border">
        <SizeRow
          label="UI font size"
          value={settings.appearance.uiFontSize}
          min={APP_UI_FONT_SIZE_RANGE.min}
          max={APP_UI_FONT_SIZE_RANGE.max}
          onChange={(uiFontSize) => void updateSection('appearance', { uiFontSize })}
        />
        <SizeRow
          label="Code font size"
          value={settings.editor.fontSize}
          min={APP_CODE_FONT_SIZE_RANGE.min}
          max={APP_CODE_FONT_SIZE_RANGE.max}
          onChange={(fontSize) => void updateSection('editor', { fontSize })}
        />
        <SizeRow
          label="Terminal font size"
          value={settings.terminal.fontSize}
          min={APP_TERMINAL_FONT_SIZE_RANGE.min}
          max={APP_TERMINAL_FONT_SIZE_RANGE.max}
          onChange={(fontSize) => void updateSection('terminal', { fontSize })}
        />
      </div>

      <ControlGroup label="Motion">
        <div className="grid grid-cols-3 gap-1 rounded-lg bg-app-surface-2 p-1" role="group" aria-label="Motion">
          {MOTION.map(({ value, label }) => {
            const selected = settings.appearance.reducedMotion === value
            return (
              <button
                key={value}
                type="button"
                aria-pressed={selected}
                onClick={() => void updateSection('appearance', { reducedMotion: value })}
                className={`h-9 rounded-md text-sm transition-colors ${
                  selected ? 'bg-app-surface text-app-text shadow-sm' : 'text-app-text-muted hover:text-app-text'
                }`}
              >
                {label}
              </button>
            )
          })}
        </div>
      </ControlGroup>
    </div>
  )
}

function ControlGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2.5">
      <h3 className="text-sm font-medium text-app-text">{label}</h3>
      {children}
    </section>
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
    <div className="flex min-h-14 items-center justify-between gap-4 py-2">
      <span className="text-sm text-app-text">{label}</span>
      <div className="flex items-center gap-1" role="group" aria-label={label}>
        <button
          type="button"
          aria-label={`Decrease ${label}`}
          disabled={value <= min}
          onClick={() => onChange(Math.max(min, value - 1))}
          className="flex h-8 w-8 items-center justify-center rounded-md text-app-text-muted hover:bg-app-surface-2 hover:text-app-text disabled:opacity-30"
        >
          <Minus className="h-3.5 w-3.5" />
        </button>
        <output className="w-12 text-center font-mono text-sm text-app-text" aria-live="polite">{value}px</output>
        <button
          type="button"
          aria-label={`Increase ${label}`}
          disabled={value >= max}
          onClick={() => onChange(Math.min(max, value + 1))}
          className="flex h-8 w-8 items-center justify-center rounded-md text-app-text-muted hover:bg-app-surface-2 hover:text-app-text disabled:opacity-30"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )
}
