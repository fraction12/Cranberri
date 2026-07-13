import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ComposerSuggestionMenu } from './ComposerSuggestionMenu'

describe('ComposerSuggestionMenu', () => {
  it('links the listbox, active option, and disabled option semantics', () => {
    const html = renderToStaticMarkup(
      <ComposerSuggestionMenu
        title="Skills"
        listId="composer-suggestions"
        activeIndex={1}
        usedTokens={0}
        contextWindow={100_000}
        onSelect={() => undefined}
        suggestions={[
          { id: 'one', kind: 'skill', label: 'One', description: 'First', badge: 'Skill' },
          { id: 'two', kind: 'skill', label: 'Two', description: 'Second', badge: 'Skill', selected: true },
        ]}
      />,
    )

    expect(html).toContain('id="composer-suggestions"')
    expect(html).toContain('role="listbox"')
    expect(html).toContain('id="composer-suggestions-option-1"')
    expect(html).toContain('aria-selected="true"')
    expect(html).toContain('aria-disabled="true"')
  })
})
