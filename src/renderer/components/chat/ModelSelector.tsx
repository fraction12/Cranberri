import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Check, ChevronDown, ChevronRight, Zap } from 'lucide-react'
import type { CodexReasoningEffort, CodexSpeed, CodexTurnSettings } from '@/shared/codex'
import {
  CODEX_MODELS,
  CODEX_SPEEDS,
  getCodexEffortsForModel,
  getCodexSpeedsForModel,
  normalizeCodexReasoningEffort,
  normalizeCodexSpeed,
} from '@/shared/codex'

type ModelSelectorProps = {
  settings: CodexTurnSettings
  onChange: (settings: CodexTurnSettings) => void
}

const MENU_SHELL = [
  'z-[1200] overflow-y-auto rounded-lg border border-app-border bg-app-surface p-1.5',
  'text-xs text-app-text shadow-2xl shadow-black/40 outline-none',
].join(' ')
const ITEM_CLASS = [
  'relative flex min-h-8 w-full select-none items-center justify-between rounded-md px-2 py-1.5',
  'text-left outline-none data-[highlighted]:bg-app-surface-2 data-[disabled]:opacity-40',
].join(' ')

export function ModelSelector({ settings, onChange }: ModelSelectorProps) {
  const selectedModel = CODEX_MODELS.find((option) => option.value === settings.model) ?? CODEX_MODELS[0]
  const normalizedEffort = normalizeCodexReasoningEffort(settings.model, settings.effort)
  const normalizedSpeed = normalizeCodexSpeed(settings.model, settings.speed) ?? 'standard'
  const supportedEfforts = getCodexEffortsForModel(settings.model)
  const supportedSpeeds = getCodexSpeedsForModel(settings.model)
  const selectedEffort = supportedEfforts.find((option) => option.value === normalizedEffort) ?? supportedEfforts[0]
  const selectedSpeed = CODEX_SPEEDS.find((option) => option.value === normalizedSpeed) ?? CODEX_SPEEDS[0]

  const selectModel = (model: string) => {
    onChange({
      ...settings,
      model,
      effort: normalizeCodexReasoningEffort(model, settings.effort),
      speed: normalizeCodexSpeed(model, settings.speed),
    })
  }

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          aria-label="Configure model, reasoning, and speed"
          className="flex items-center gap-1.5 rounded-full px-2 py-1 text-xs text-app-text outline-none hover:bg-app-surface-2 focus-visible:ring-2 focus-visible:ring-app-accent"
        >
          <span>{selectedModel.label.replace('GPT-', '')}</span>
          <span>{selectedEffort.label}</span>
          <span className="text-app-text-muted">·</span>
          <span>{selectedSpeed.label}</span>
          <ChevronDown className="h-3 w-3 text-app-text-muted" />
        </button>
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          side="top"
          align="end"
          sideOffset={8}
          collisionPadding={8}
          className={`w-52 ${MENU_SHELL}`}
          style={{ maxHeight: 'calc(100vh - 16px)' }}
        >
          <DropdownMenu.Label className="px-2 pb-1.5 pt-1 text-xs text-app-text-muted">
            Reasoning
          </DropdownMenu.Label>
          <DropdownMenu.RadioGroup
            value={normalizedEffort}
            onValueChange={(effort) => onChange({
              ...settings,
              effort: effort as CodexReasoningEffort,
            })}
          >
            {supportedEfforts.map((option) => (
              <MenuRadioItem key={option.value} value={option.value} label={option.label} />
            ))}
          </DropdownMenu.RadioGroup>

          <DropdownMenu.Separator className="my-1 h-px bg-app-border" />

          <DropdownMenu.Sub>
            <DropdownMenu.SubTrigger className={ITEM_CLASS}>
              <span>{selectedModel.label}</span>
              <ChevronRight className="h-3.5 w-3.5 text-app-text-muted" />
            </DropdownMenu.SubTrigger>
            <DropdownMenu.Portal>
              <DropdownMenu.SubContent
                data-model-selector-submenu="model"
                sideOffset={6}
                alignOffset={-6}
                collisionPadding={8}
                className={`w-52 ${MENU_SHELL}`}
                style={{ maxHeight: 'calc(100vh - 16px)' }}
              >
                <DropdownMenu.Label className="px-2 pb-1.5 pt-1 text-xs text-app-text-muted">
                  Model
                </DropdownMenu.Label>
                <DropdownMenu.RadioGroup value={settings.model} onValueChange={selectModel}>
                  {CODEX_MODELS.map((option) => (
                    <DropdownMenu.RadioItem key={option.value} value={option.value} className={ITEM_CLASS}>
                      <span className="flex min-w-0 flex-col">
                        <span>{option.label}</span>
                        <span className="text-micro text-app-text-muted">{option.description}</span>
                      </span>
                      <DropdownMenu.ItemIndicator>
                        <Check className="h-3.5 w-3.5 text-app-text" />
                      </DropdownMenu.ItemIndicator>
                    </DropdownMenu.RadioItem>
                  ))}
                </DropdownMenu.RadioGroup>
              </DropdownMenu.SubContent>
            </DropdownMenu.Portal>
          </DropdownMenu.Sub>

          <DropdownMenu.Sub>
            <DropdownMenu.SubTrigger className={ITEM_CLASS}>
              <span>Speed</span>
              <ChevronRight className="h-3.5 w-3.5 text-app-text-muted" />
            </DropdownMenu.SubTrigger>
            <DropdownMenu.Portal>
              <DropdownMenu.SubContent
                data-model-selector-submenu="speed"
                sideOffset={6}
                alignOffset={-6}
                collisionPadding={8}
                className={`w-44 ${MENU_SHELL}`}
                style={{ maxHeight: 'calc(100vh - 16px)' }}
              >
                <DropdownMenu.Label className="px-2 pb-1.5 pt-1 text-xs text-app-text-muted">
                  Speed
                </DropdownMenu.Label>
                <DropdownMenu.RadioGroup
                  value={normalizedSpeed}
                  onValueChange={(speed) => onChange({ ...settings, speed: speed as CodexSpeed })}
                >
                  {supportedSpeeds.map((option) => (
                    <DropdownMenu.RadioItem key={option.value} value={option.value} className={ITEM_CLASS}>
                      <span className="flex min-w-0 flex-col items-start">
                        <span className="flex items-center gap-2">
                          {option.value === 'fast' && <Zap className="h-3.5 w-3.5" />}
                          {option.label}
                        </span>
                        <span className="text-xs text-app-text-muted">{option.description}</span>
                      </span>
                      <DropdownMenu.ItemIndicator>
                        <Check className="h-3.5 w-3.5 text-app-text" />
                      </DropdownMenu.ItemIndicator>
                    </DropdownMenu.RadioItem>
                  ))}
                </DropdownMenu.RadioGroup>
              </DropdownMenu.SubContent>
            </DropdownMenu.Portal>
          </DropdownMenu.Sub>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

function MenuRadioItem({ value, label }: { value: string; label: string }) {
  return (
    <DropdownMenu.RadioItem value={value} className={ITEM_CLASS}>
      <span>{label}</span>
      <DropdownMenu.ItemIndicator>
        <Check className="h-3.5 w-3.5 text-app-text" />
      </DropdownMenu.ItemIndicator>
    </DropdownMenu.RadioItem>
  )
}
