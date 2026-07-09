import { useEffect, useId, useState } from 'react'
import { CodePreview } from '../editor/CodePreview'
import { useAppearance } from '../../state/appearance-context'
import type { AppAccent } from '@/shared/settings'

interface MermaidDiagramProps {
  source: string
}

export function MermaidDiagram({ source }: MermaidDiagramProps) {
  const reactId = useId()
  const diagramId = `cranberri-mermaid-${reactId.replace(/[^a-zA-Z0-9_-]/g, '')}`
  const [svg, setSvg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { theme, accent } = useAppearance()

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
          themeVariables: mermaidThemeVariables(theme, accent),
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
  }, [accent, diagramId, source, theme])

  if (error) {
    return (
      <div data-mermaid-diagram="error" className="my-4">
        <div className="mb-2 rounded-md border border-[var(--app-border)] bg-[var(--app-surface)] px-3 py-2 text-xs text-[var(--app-danger)]">
          Mermaid diagram failed to render: {error}
        </div>
        <CodePreview code={source} language="mermaid" />
      </div>
    )
  }

  return (
    <div
      data-mermaid-diagram="true"
      className="my-4 overflow-x-auto rounded-lg border border-[var(--app-border)] bg-[var(--app-surface)] p-3"
    >
      {svg ? (
        <div
          className="[&_svg]:mx-auto [&_svg]:h-auto [&_svg]:max-w-full"
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      ) : (
        <div className="text-xs text-[var(--app-text-muted)]">Rendering Mermaid diagram...</div>
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

function mermaidThemeVariables(theme: 'light' | 'dark', accent: AppAccent) {
  if (theme === 'light') {
    return {
      background: '#ffffff',
      primaryColor: '#ededf0',
      primaryTextColor: '#202123',
      primaryBorderColor: ACCENT_COLORS[accent],
      lineColor: '#67676f',
      secondaryColor: '#f7f7f8',
      tertiaryColor: '#ffffff',
      fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif',
    }
  }
  return {
    background: '#0f0f11',
    primaryColor: '#27272a',
    primaryTextColor: '#fafafa',
    primaryBorderColor: ACCENT_COLORS[accent],
    lineColor: '#a1a1aa',
    secondaryColor: '#18181b',
    tertiaryColor: '#27272a',
    fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif',
  }
}
