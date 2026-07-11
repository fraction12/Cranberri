import { describe, expect, it } from 'vitest'
import { APP_TOAST_OPTIONS } from './AppToaster'

describe('AppToaster', () => {
  it('owns toast typography instead of inheriting Sonner defaults', () => {
    expect(APP_TOAST_OPTIONS.unstyled).toBe(true)
    expect(APP_TOAST_OPTIONS.classNames?.toast).toContain('type-body')
    expect(APP_TOAST_OPTIONS.classNames?.title).toContain('type-control')
    expect(APP_TOAST_OPTIONS.classNames?.description).toContain('type-metadata')
    expect(APP_TOAST_OPTIONS.classNames?.actionButton).toContain('type-control')
  })
})
