import { useEffect, useId, useMemo, useState } from 'react'
import { CodePreview } from '../editor/CodePreview'
import { useAppearance } from '../../state/appearance-context'
import { cn } from '../../lib/ui'
import { typeStyle } from '../../lib/typography'
import type { AppAccent } from '@/shared/settings'

interface MermaidDiagramProps {
  source: string
}

interface MermaidTypography {
  fontFamily: string
  fontSize: string
}

const DEFAULT_MERMAID_TYPOGRAPHY: MermaidTypography = {
  fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif',
  fontSize: 'var(--app-type-body-size, 13px)',
}

export function mermaidTypographyFromCss(readValue: (property: string) => string): MermaidTypography {
  return {
    fontFamily: readValue('--app-font-ui').trim() || DEFAULT_MERMAID_TYPOGRAPHY.fontFamily,
    fontSize: readValue('--app-type-body-size').trim() || DEFAULT_MERMAID_TYPOGRAPHY.fontSize,
  }
}

function computedMermaidTypography(): MermaidTypography {
  if (typeof window === 'undefined' || typeof document === 'undefined') return DEFAULT_MERMAID_TYPOGRAPHY
  const styles = window.getComputedStyle(document.documentElement)
  return mermaidTypographyFromCss((property) => styles.getPropertyValue(property))
}

function currentTypePreset(): string {
  return typeof document === 'undefined' ? 'standard' : (document.documentElement.dataset.typePreset ?? 'standard')
}

export function MermaidDiagram({ source }: MermaidDiagramProps) {
  const reactId = useId()
  const diagramId = `cranberri-mermaid-${reactId.replace(/[^a-zA-Z0-9_-]/g, '')}`
  const [svg, setSvg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { theme, accent } = useAppearance()
  const [typePreset, setTypePreset] = useState(currentTypePreset)
  const typography = useMemo(computedMermaidTypography, [typePreset])

  useEffect(() => {
    if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return undefined
    const root = document.documentElement
    const observer = new MutationObserver(() => setTypePreset(currentTypePreset()))
    observer.observe(root, { attributes: true, attributeFilter: ['data-type-preset'] })
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    let cancelled = false
    setSvg(null)
    setError(null)

    void import('mermaid')
      .then(async (module) => {
        module.default.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          theme: theme === 'dark' ? 'dark' : 'default',
          themeVariables: mermaidThemeVariables(theme, accent, typography),
        })
        const rendered = await module.default.render(diagramId, source)
        if (!cancelled) setSvg(rendered.svg)
      })
      .catch((renderError: unknown) => {
        if (!cancelled) {
          setError(renderError instanceof Error ? renderError.message : 'Failed to render Mermaid diagram')
        }
      })

    return () => {
      cancelled = true
    }
  }, [accent, diagramId, source, theme, typography])

  if (error) {
    return (
      <div data-mermaid-diagram="error" className="my-4">
        <div className={cn(
          typeStyle({ role: 'body', tone: 'danger' }),
          'mb-2 rounded-md border border-[var(--app-border)] bg-[var(--app-surface)] px-3 py-2',
        )}>
          Mermaid diagram failed to render: {error}
        </div>
        <CodePreview code={source} language="mermaid" />
      </div>
    )
  }

  return (
    <div
      data-mermaid-diagram="true"
      data-mermaid-render-key={svg ? `${theme}:${typePreset}:${typography.fontSize}` : 'loading'}
      className="my-4 overflow-x-auto rounded-lg border border-[var(--app-border)] bg-[var(--app-surface)] p-3"
    >
      {svg ? (
        <div
          className="[&_svg]:mx-auto [&_svg]:h-auto [&_svg]:max-w-full"
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      ) : (
        <div className={typeStyle({ role: 'status', tone: 'secondary' })}>Rendering Mermaid diagram...</div>
      )}
    </div>
  )
}

const ACCENT_COLORS: Record<AppAccent, string> = {
  green: '#22c55e',
  blue: '#3b82f6',
  orange: '#f97316',
  rose: '#f43f5e',
  violet: '#8b5cf6',
}

const LIGHT_ACCENT_COLORS: Record<AppAccent, string> = {
  green: '#15803d',
  blue: '#2563eb',
  orange: '#c2410c',
  rose: '#e11d48',
  violet: '#7c3aed',
}

function mermaidThemeVariables(theme: 'light' | 'dark', accent: AppAccent, typography: MermaidTypography) {
  if (theme === 'light') {
    return {
      background: '#ffffff',
      primaryColor: '#ebebee',
      primaryTextColor: '#1f2023',
      primaryBorderColor: LIGHT_ACCENT_COLORS[accent],
      lineColor: '#63636c',
      secondaryColor: '#f6f6f8',
      tertiaryColor: '#fcfcfd',
      fontFamily: typography.fontFamily,
      fontSize: typography.fontSize,
    }
  }
  return {
    background: '#111113',
    primaryColor: '#222226',
    primaryTextColor: '#f4f4f5',
    primaryBorderColor: ACCENT_COLORS[accent],
    lineColor: '#a6a6af',
    secondaryColor: '#17171a',
    tertiaryColor: '#1c1c20',
    fontFamily: typography.fontFamily,
    fontSize: typography.fontSize,
  }
}
