import {
  normalizeCodexReasoningEffort,
  normalizeCodexSpeed,
  type CodexReasoningEffort,
  type CodexServiceTier,
  type CodexTurnSettings,
} from '../../shared/codex'

interface CodexTurnOverrides {
  model: string | null
  effort: CodexReasoningEffort | null
  serviceTier?: CodexServiceTier | null
}

export function buildCodexTurnOverrides(settings?: CodexTurnSettings): CodexTurnOverrides {
  if (!settings) return { model: null, effort: null }

  const overrides: CodexTurnOverrides = {
    model: settings.model,
    effort: normalizeCodexReasoningEffort(settings.model, settings.effort),
  }

  const speed = normalizeCodexSpeed(settings.model, settings.speed)
  if (speed === 'fast') overrides.serviceTier = 'priority'
  if (speed === 'standard') overrides.serviceTier = null
  return overrides
}
