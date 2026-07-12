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
import { cn, dropdownChevronStyle, dropdownTriggerStyle, menuSurface } from '../../lib/ui'
import { typeStyle } from '../../lib/typography'

type ModelSelectorProps = {
  settings: CodexTurnSettings
  onChange: (settings: CodexTurnSettings) => void
}

const MENU_SHELL = cn(menuSurface, typeStyle({ role: 'body' }), 'z-[1200] scroll-pt-8 overscroll-contain overflow-y-auto outline-none')
const MENU_MAX_HEIGHT = 'min(360px, calc(100vh - 72px))'
const MENU_LABEL = cn(
  typeStyle({ role: 'label', tone: 'secondary' }),
  'sticky top-0 z-10 -mx-1 bg-app-elevated px-3 pb-1.5 pt-1',
)
const ITEM_CLASS = cn(
  typeStyle({ role: 'control' }),
  'relative flex min-h-8 w-full select-none items-center justify-between rounded-md px-2 py-1.5',
  'text-left outline-none data-[highlighted]:bg-app-surface-2 data-[disabled]:opacity-40',
)

export function codexModelLabel(model: string): string {
  return CODEX_MODELS.find((option) => option.value === model)?.label ?? model
}

export function ModelSelector({ settings, onChange }: ModelSelectorProps) {
  const selectedModelLabel = codexModelLabel(settings.model)
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
          data-dropdown-trigger="compact"
          className={dropdownTriggerStyle()}
        >
          <span className="max-w-28 truncate" title={selectedModelLabel}>{selectedModelLabel.replace('GPT-', '')}</span>
          <span className="shrink-0">{selectedEffort.label}</span>
          {selectedSpeed.value === 'fast' ? (
            <>
              <span className={cn(typeStyle({ role: 'metadata', tone: 'secondary' }), 'shrink-0')}>·</span>
              <span className="flex shrink-0 items-center gap-1">
                <Zap className="h-3 w-3" />
                {selectedSpeed.label}
              </span>
            </>
          ) : (
            <>
              <span className={cn(typeStyle({ role: 'metadata', tone: 'secondary' }), 'hidden shrink-0 xl:inline')}>·</span>
              <span className="hidden shrink-0 xl:inline">{selectedSpeed.label}</span>
            </>
          )}
          <ChevronDown aria-hidden="true" data-dropdown-chevron="true" className={dropdownChevronStyle()} />
        </button>
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          data-model-selector-menu="root"
          side="top"
          align="end"
          sideOffset={8}
          collisionPadding={12}
          className={`w-52 ${MENU_SHELL}`}
          style={{ maxHeight: MENU_MAX_HEIGHT }}
        >
          <DropdownMenu.Label className={MENU_LABEL}>
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

          <DropdownMenu.Separator className="h-2" />

          <DropdownMenu.Sub>
            <DropdownMenu.SubTrigger
              className={ITEM_CLASS}
              onPointerLeave={(event) => event.preventDefault()}
            >
              <span className="truncate" title={selectedModelLabel}>{selectedModelLabel}</span>
              <ChevronRight className="h-3.5 w-3.5 text-app-text-muted" />
            </DropdownMenu.SubTrigger>
            <DropdownMenu.Portal>
              <DropdownMenu.SubContent
                data-model-selector-submenu="model"
                sideOffset={6}
                alignOffset={-6}
                collisionPadding={12}
                className={`w-52 ${MENU_SHELL}`}
                style={{ maxHeight: MENU_MAX_HEIGHT }}
                onWheel={(event) => event.stopPropagation()}
              >
                <DropdownMenu.Label className={MENU_LABEL}>
                  Model
                </DropdownMenu.Label>
                <DropdownMenu.RadioGroup value={settings.model} onValueChange={selectModel}>
                  {CODEX_MODELS.map((option) => (
                    <DropdownMenu.RadioItem key={option.value} value={option.value} className={ITEM_CLASS}>
                      <span className="flex min-w-0 flex-col">
                        <span>{option.label}</span>
                        <span className={typeStyle({ role: 'metadata', tone: 'secondary' })}>{option.description}</span>
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
            <DropdownMenu.SubTrigger
              className={ITEM_CLASS}
              onPointerLeave={(event) => event.preventDefault()}
            >
              <span>Speed</span>
              <ChevronRight className="h-3.5 w-3.5 text-app-text-muted" />
            </DropdownMenu.SubTrigger>
            <DropdownMenu.Portal>
              <DropdownMenu.SubContent
                data-model-selector-submenu="speed"
                sideOffset={6}
                alignOffset={-6}
                collisionPadding={12}
                className={`w-44 ${MENU_SHELL}`}
                style={{ maxHeight: MENU_MAX_HEIGHT }}
                onWheel={(event) => event.stopPropagation()}
              >
                <DropdownMenu.Label className={MENU_LABEL}>
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
                        <span className={typeStyle({ role: 'metadata', tone: 'secondary' })}>{option.description}</span>
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
