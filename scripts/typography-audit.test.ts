import { describe, expect, it } from 'vitest'
import { findCssTypographyViolations, findTypographyViolations } from './typography-audit.mjs'

describe('typography source audit', () => {
  it('reports raw metric utilities with their source lines', () => {
    expect(findTypographyViolations(`
      <p className="text-xs leading-5 font-semibold">Status</p>
      <span className="text-[11px]">Count</span>
      const style = { fontSize: '13px', lineHeight: density.lineHeight }
    `)).toEqual([
      { token: 'text-xs', line: 2 },
      { token: 'leading-5', line: 2 },
      { token: 'font-semibold', line: 2 },
      { token: 'text-[11px]', line: 3 },
      { token: "fontSize: '13px'", line: 4 },
      { token: 'lineHeight: density.lineHeight', line: 4 },
    ])
  })

  it('catches arbitrary metrics and ignores examples in comments', () => {
    expect(findTypographyViolations(`
      // text-xs font-bold
      /* leading-5 */
      <p className="text-[12pt] font-[650] tracking-[0.02em]">Status</p>
    `)).toEqual([
      { token: 'text-[12pt]', line: 4 },
      { token: 'font-[650]', line: 4 },
      { token: 'tracking-[0.02em]', line: 4 },
    ])
  })

  it('allows semantic roles and non-metric visual utilities', () => {
    expect(findTypographyViolations(`
      typeStyle({ role: 'panelTitle', tone: 'primary' })
      <Icon className="h-4 w-4 text-app-status-danger" />
    `)).toEqual([])
  })

  it('rejects direct DOM style assignments and typography setters', () => {
    expect(findTypographyViolations(`
      element.style.fontSize = '13px'
      element.style['lineHeight'] = '20px'
      element.style.setProperty('letter-spacing', '0.02em')
      element.style.setProperty('--app-custom-property', 'allowed')
    `)).toEqual([
      { token: "element.style.fontSize = '13px'", line: 2 },
      { token: "element.style['lineHeight'] = '20px'", line: 3 },
      { token: "element.style.setProperty('letter-spacing', '0.02em')", line: 4 },
    ])
  })

  it('rejects CSS typography outside the semantic selector allowlist', () => {
    const css = `
      html { font-size: 16px; }
      body { font-family: var(--app-font-ui); font-size: var(--app-type-body-size); font-weight: 400; line-height: var(--app-type-body-line); letter-spacing: 0; }
      .type-body { font-size: var(--app-type-body-size); line-height: var(--app-type-body-line); }
      .rogue { font-size: 13px; font-family: Arial; font: 13px/20px Arial; }
    `

    expect(findCssTypographyViolations(css)).toEqual([
      { selector: '.rogue', property: 'font-size', value: '13px', line: 5 },
      { selector: '.rogue', property: 'font-family', value: 'Arial', line: 5 },
      { selector: '.rogue', property: 'font', value: '13px/20px Arial', line: 5 },
    ])
  })
})
