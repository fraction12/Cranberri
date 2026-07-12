import { Check, Package, Plug } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { cn, menuSurface } from '../../lib/ui'
import { typeStyle } from '../../lib/typography'
import { ContextWindowIndicator } from './ContextWindowIndicator'

export interface ComposerSuggestion {
  id: string
  kind: 'command' | 'skill' | 'plugin'
  label: string
  description: string
  badge: string
  selected?: boolean
}

export function ComposerSuggestionMenu({
  title,
  suggestions,
  activeIndex,
  usedTokens,
  contextWindow,
  onSelect,
}: {
  title: string
  suggestions: readonly ComposerSuggestion[]
  activeIndex: number
  usedTokens: number
  contextWindow: number
  onSelect: (index: number) => void
}) {
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    listRef.current?.querySelector('[role="option"][aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  return (
    <div className={cn(menuSurface, 'absolute inset-x-0 bottom-full mb-2 max-h-[min(420px,calc(100vh-24px))] overflow-hidden p-2')}>
      <div className={cn(typeStyle({ role: 'label', tone: 'secondary' }), 'px-2 pb-1 pt-0.5')}>{title}</div>
      <div ref={listRef} className="max-h-[350px] space-y-0.5 overflow-y-auto pr-1" role="listbox" aria-label={title}>
        {suggestions.map((suggestion, index) => (
          <button
            key={suggestion.id}
            type="button"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onSelect(index)}
            disabled={suggestion.selected}
            role="option"
            aria-selected={index === activeIndex}
            className={cn(
              'flex min-h-9 w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left',
              index === activeIndex && 'bg-app-surface-2',
              suggestion.selected && 'cursor-default opacity-55',
            )}
          >
            {suggestion.kind === 'command'
              ? <ContextWindowIndicator usedTokens={usedTokens} contextWindow={contextWindow} />
              : suggestion.kind === 'plugin'
                ? <Plug className={cn('h-4 w-4 shrink-0', suggestion.selected ? 'text-app-mention' : 'text-app-text/80')} />
                : <Package className={cn('h-4 w-4 shrink-0', suggestion.selected ? 'text-app-mention' : 'text-app-text/80')} />}
            <span className={cn(typeStyle({ role: 'control' }), 'min-w-0 flex-1 truncate')}>
              <span className={suggestion.selected ? 'text-app-mention' : undefined}>{suggestion.label}</span>
              {suggestion.description && (
                <span className={cn(typeStyle({ role: 'metadata', tone: 'secondary' }), 'ml-3')}>{suggestion.description}</span>
              )}
            </span>
            {suggestion.selected ? (
              <span className={cn(typeStyle({ role: 'status', tone: 'mention' }), 'inline-flex shrink-0 items-center gap-1')}>
                <Check className="h-3.5 w-3.5" /> Selected
              </span>
            ) : (
              <span className={cn(typeStyle({ role: 'metadata', tone: 'secondary' }), 'shrink-0')}>{suggestion.badge}</span>
            )}
          </button>
        ))}
      </div>
    </div>
  )
}
