import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { IconButton } from './IconButton'
import { TOOLTIP_DELAY_DURATION, TOOLTIP_SKIP_DELAY_DURATION, TooltipProvider } from './Tooltip'

describe('IconButton', () => {
  it('uses its required label for accessible button markup without a native title', () => {
    const html = renderToStaticMarkup(<TooltipProvider><IconButton label="Refresh data">R</IconButton></TooltipProvider>)

    expect(html).toContain('aria-label="Refresh data"')
    expect(html).not.toContain('title=')
  })

  it('keeps a disabled control discoverable through a focusable tooltip trigger', () => {
    const html = renderToStaticMarkup(<TooltipProvider><IconButton label="Unavailable action" disabled>U</IconButton></TooltipProvider>)

    expect(html).toContain('role="button"')
    expect(html).toContain('aria-disabled="true"')
    expect(html.match(/aria-label="Unavailable action"/g)).toHaveLength(1)
    expect(html).toContain('tabindex="0"')
    expect(html).toContain('<button type="button" disabled="" aria-hidden="true" tabindex="-1"')
  })

  it('accepts Radix asChild trigger props without replacing the button element', () => {
    const html = renderToStaticMarkup(
      <TooltipProvider>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <IconButton label="Task actions">A</IconButton>
          </DropdownMenu.Trigger>
        </DropdownMenu.Root>
      </TooltipProvider>,
    )

    expect(html).toMatch(/^<button .*type="button".*aria-label="Task actions"/)
    expect(html).toContain('aria-haspopup="menu"')
    expect(html).not.toContain('title=')
  })
})

describe('TooltipProvider', () => {
  it('exports the shared timing primitives', () => {
    expect(TOOLTIP_DELAY_DURATION).toBe(350)
    expect(TOOLTIP_SKIP_DELAY_DURATION).toBe(100)
  })
})
