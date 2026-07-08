import { useEffect, useId, useState } from 'react'
import { CodePreview } from '../editor/CodePreview'

interface MermaidDiagramProps {
  source: string
}

export function MermaidDiagram({ source }: MermaidDiagramProps) {
  const reactId = useId()
  const diagramId = `cranberri-mermaid-${reactId.replace(/[^a-zA-Z0-9_-]/g, '')}`
  const [svg, setSvg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setSvg(null)
    setError(null)

    void import('mermaid')
      .then(async (module) => {
        module.default.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          theme: 'dark',
          themeVariables: {
            background: '#111115',
            primaryColor: '#1f2937',
            primaryTextColor: '#f4f4f5',
            primaryBorderColor: '#3f3f46',
            lineColor: '#a1a1aa',
            secondaryColor: '#18181b',
            tertiaryColor: '#27272a',
            fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
          },
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
  }, [diagramId, source])

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
