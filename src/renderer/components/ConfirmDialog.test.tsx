import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ConfirmDialog } from './ConfirmDialog'

describe('ConfirmDialog', () => {
  it('renders accessible confirmation copy, error text, and busy state', () => {
    const html = renderToStaticMarkup(
      <ConfirmDialog
        title="Delete session"
        description="Delete Codex session?"
        confirmLabel="Delete"
        busyLabel="Deleting..."
        busy
        danger
        error="Delete failed"
        onCancel={() => {}}
        onConfirm={() => {}}
      />,
    )

    expect(html).toContain('role="dialog"')
    expect(html).toContain('aria-modal="true"')
    expect(html).toContain('aria-label="Delete session"')
    expect(html).toContain('Delete Codex session?')
    expect(html).toContain('Delete failed')
    expect(html).toContain('Deleting...')
    expect(html).toContain('disabled=""')
  })
})
