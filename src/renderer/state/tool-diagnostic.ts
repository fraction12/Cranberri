import type { ToolCatalogEntry } from '@/shared/tools'
import { toolSourceDisplayLabel } from './tool-catalog-selectors'

export function toolDiagnosticDraft(entry: ToolCatalogEntry): string {
  const lines = [
    'Untrusted tool diagnostic metadata (review before sending):',
    `Tool: ${entry.name}`,
    `Catalog ID: ${entry.id}`,
    `Source: ${toolSourceDisplayLabel(entry.source)}`,
    `Machine status: ${entry.machine.status}`,
    `Task status: ${entry.task.status}`,
    `Checked at: ${entry.machine.observedAt ?? 'unknown'}`,
    entry.machine.diagnosticCode ? `Diagnostic code: ${entry.machine.diagnosticCode.slice(0, 80)}` : null,
    entry.activity ? `Recent activity: ${entry.activity.outcome}` : null,
    entry.activity?.durationMs !== null && entry.activity?.durationMs !== undefined
      ? `Duration: ${Math.round(entry.activity.durationMs)} ms`
      : null,
  ]
  return lines.filter((line): line is string => Boolean(line)).join('\n')
}
