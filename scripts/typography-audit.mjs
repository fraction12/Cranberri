import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import ts from 'typescript'

const TYPOGRAPHY_TOKEN_PATTERN = /(?:^|[^A-Za-z0-9_-])((?:text-(?:micro|caption|xs|sm|base|lg|xl|\d+xl|code)(?:\/[^\s'"`]+)?|text-\[[^\]]*(?:\d+(?:\.\d+)?(?:px|pt|pc|em|rem|%|vh|vw)|--app-(?:font|type))[^\]]*\]|leading-(?:none|tight|snug|normal|relaxed|loose|\d+|\[[^\]]+\])|font-(?:sans|mono|thin|extralight|light|normal|medium|semibold|bold|extrabold|black|\[[^\]]+\])|tracking-(?:tighter|tight|normal|wide|wider|widest|\[[^\]]+\])))(?=$|[^A-Za-z0-9_-])/g
const INLINE_METRIC_NAMES = new Set(['font', 'fontSize', 'lineHeight', 'fontFamily', 'fontWeight', 'letterSpacing'])
const CSS_STYLE_METRIC_NAMES = new Set(['font', 'font-size', 'line-height', 'font-family', 'font-weight', 'letter-spacing'])
const APPROVED_TYPE_TOKENS = new Set(['font-sans', 'font-mono', 'font-normal', 'font-medium', 'font-semibold'])
const APPROVED_INLINE_METRICS = new Map([
  ['src/renderer/components/editor/CodeEditor.tsx', [
    /^fontSize: 'var\(--app-(?:code-font-size|type-control-size)\)'$/,
    /^fontFamily: 'var\(--app-font-(?:mono|ui)\)'$/,
    /^lineHeight: (?:String\(CODE_LINE_HEIGHT\)|'var\(--app-type-control-line\)')$/,
  ]],
  ['src/renderer/components/right-rail/DiffViewer.tsx', [
    /^fontFamily: 'var\(--app-font-mono\)'$/,
    /^fontSize: 'var\(--app-code-font-size\)'$/,
    /^lineHeight: CODE_LINE_HEIGHT$/,
  ]],
  ['src/renderer/components/chat/MermaidDiagram.tsx', [
    /^fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif'$/,
    /^fontSize: 'var\(--app-type-body-size, 13px\)'$/,
    /^fontFamily: readValue\('--app-font-ui'\)\.trim\(\) \|\| DEFAULT_MERMAID_TYPOGRAPHY\.fontFamily$/,
    /^fontSize: readValue\('--app-type-body-size'\)\.trim\(\) \|\| DEFAULT_MERMAID_TYPOGRAPHY\.fontSize$/,
    /^fontFamily: typography\.fontFamily$/,
    /^fontSize: typography\.fontSize$/,
  ]],
  ['src/renderer/components/terminal-theme.ts', [
    /^fontFamily: sharedMonoStack\?\.trim\(\) \|\| TERMINAL_FONT_FALLBACK$/,
    /^fontSize$/,
    /^lineHeight: TERMINAL_LINE_HEIGHT$/,
  ]],
  ['src/renderer/components/TerminalWindow.tsx', [
    /^fontSize: settings\.terminal\.fontSize$/,
  ]],
  ['src/renderer/components/settings/AppearanceSettings.tsx', [
    /^fontSize$/,
  ]],
])

const CSS_ALLOWED_DECLARATIONS = new Map([
  ['html|font-size', '16px'],
  ['body|font-family', 'var(--app-font-ui)'],
  ['body|font-size', 'var(--app-type-body-size)'],
  ['body|font-weight', '400'],
  ['body|line-height', 'var(--app-type-body-line)'],
  ['body|letter-spacing', '0'],
  ...[
    ['page-title', 'page-title'],
    ['overlay-title', 'overlay-title'],
    ['panel-title', 'panel-title'],
    ['prose-heading-1', 'prose-heading-1'],
    ['prose-heading-2', 'prose-heading-2'],
    ['prose-heading-3', 'prose-heading-3'],
    ['prose-heading-4', 'prose-heading-4'],
    ['prose-heading-5', 'prose-heading-5'],
    ['prose-heading-6', 'prose-heading-6'],
    ['body', 'body'],
    ['prose', 'prose'],
    ['control', 'control'],
    ['label', 'label'],
    ['metadata', 'metadata'],
    ['micro', 'micro'],
    ['status', 'status'],
  ].flatMap(([className, variable]) => [
    [`.type-${className}|font-size`, `var(--app-type-${variable}-size)`],
    [`.type-${className}|line-height`, `var(--app-type-${variable}-line)`],
  ]),
  ['.type-code|font-size', 'var(--app-code-font-size)'],
  ['.type-code|line-height', 'var(--app-code-line-height)'],
  ['.type-terminal|font-size', 'var(--app-terminal-font-size)'],
  ['.type-terminal|line-height', 'var(--app-terminal-line-height)'],
])

function stripCodeComments(source) {
  let state = 'code'
  let escaped = false
  let result = ''
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]
    const next = source[index + 1]
    if (state === 'line-comment') {
      if (char === '\n') {
        state = 'code'
        result += char
      } else result += ' '
      continue
    }
    if (state === 'block-comment') {
      if (char === '*' && next === '/') {
        result += '  '
        index += 1
        state = 'code'
      } else result += char === '\n' ? '\n' : ' '
      continue
    }
    if (state === 'code' && char === '/' && next === '/') {
      result += '  '
      index += 1
      state = 'line-comment'
      continue
    }
    if (state === 'code' && char === '/' && next === '*') {
      result += '  '
      index += 1
      state = 'block-comment'
      continue
    }
    if (state === 'code' && (char === "'" || char === '"' || char === '`')) {
      state = char
      escaped = false
      result += char
      continue
    }
    if (state !== 'code') {
      result += char
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === state) state = 'code'
      continue
    }
    result += char
  }
  return result
}

function propertyName(node) {
  if (!node.name) return null
  if (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) return node.name.text
  return null
}

function accessName(node) {
  if (ts.isPropertyAccessExpression(node)) return node.name.text
  if (ts.isElementAccessExpression(node)) {
    const argument = node.argumentExpression
    if (argument && (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument))) {
      return argument.text
    }
  }
  return null
}

function isStyleAccess(node) {
  return (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node))
    && accessName(node) === 'style'
}

function isTypographyStyleAssignment(node) {
  if (!ts.isBinaryExpression(node) || node.operatorToken.kind !== ts.SyntaxKind.EqualsToken) return false
  const target = node.left
  return (ts.isPropertyAccessExpression(target) || ts.isElementAccessExpression(target))
    && INLINE_METRIC_NAMES.has(accessName(target))
    && isStyleAccess(target.expression)
}

function isTypographyStyleSetter(node) {
  if (!ts.isCallExpression(node)) return false
  const callee = node.expression
  if ((!ts.isPropertyAccessExpression(callee) && !ts.isElementAccessExpression(callee))
    || accessName(callee) !== 'setProperty'
    || !isStyleAccess(callee.expression)) return false
  const property = node.arguments[0]
  return Boolean(property
    && (ts.isStringLiteral(property) || ts.isNoSubstitutionTemplateLiteral(property))
    && CSS_STYLE_METRIC_NAMES.has(property.text))
}

export function findTypographyViolations(source) {
  const violations = []
  const uncommented = stripCodeComments(source)
  for (const match of uncommented.matchAll(TYPOGRAPHY_TOKEN_PATTERN)) {
    const offset = match.index + match[0].indexOf(match[1])
    const line = source.slice(0, offset).split('\n').length
    violations.push({ token: match[1], line, offset })
  }

  const sourceFile = ts.createSourceFile('typography-audit.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const visit = (node) => {
    const isInlineMetric = (ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node))
      && INLINE_METRIC_NAMES.has(propertyName(node))
    if (isInlineMetric || isTypographyStyleAssignment(node) || isTypographyStyleSetter(node)) {
      const offset = node.getStart(sourceFile)
      violations.push({
        token: source.slice(offset, node.getEnd()).trim(),
        line: sourceFile.getLineAndCharacterOfPosition(offset).line + 1,
        offset,
      })
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return violations
    .sort((left, right) => left.offset - right.offset)
    .map(({ token, line }) => ({ token, line }))
}

export function findCssTypographyViolations(css) {
  const violations = []
  const uncommented = css.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ' '))
  const blockPattern = /([^{}]+)\{([^{}]*)\}/g
  for (const block of uncommented.matchAll(blockPattern)) {
    const selectors = block[1].split(',').map((selector) => selector.trim()).filter(Boolean)
    const body = block[2]
    const bodyOffset = block.index + block[0].indexOf(body)
    const declarationPattern = /(?:^|;)\s*(font-size|line-height|font-family|font-weight|letter-spacing|font)\s*:\s*([^;{}]+)(?=;|$)/g
    for (const declaration of body.matchAll(declarationPattern)) {
      const property = declaration[1]
      const value = declaration[2].trim()
      const offset = bodyOffset + declaration.index
      for (const selector of selectors) {
        const expected = CSS_ALLOWED_DECLARATIONS.get(`${selector}|${property}`)
        if (expected === value) continue
        violations.push({
          selector,
          property,
          value,
          line: css.slice(0, offset).split('\n').length,
        })
      }
    }
  }
  return violations
}

function rendererFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name)
    if (entry.isDirectory()) return rendererFiles(target)
    if (!/\.(?:ts|tsx)$/.test(entry.name) || /\.(?:test|spec)\.[^.]+$/.test(entry.name)) return []
    return [target]
  })
}

function cssBlock(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))
  if (!match) throw new Error(`Missing CSS block: ${selector}`)
  return match[1]
}

function cssValue(blocks, variable) {
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const match = blocks[index].match(new RegExp(`${variable}:\\s*([^;]+);`))
    if (match) return match[1].trim()
  }
  throw new Error(`Missing CSS variable: ${variable}`)
}

function rgb(blocks, variable) {
  const channels = cssValue(blocks, variable).split(/\s+/).map(Number)
  if (channels.length !== 3 || channels.some((channel) => !Number.isFinite(channel))) {
    throw new Error(`Invalid RGB variable: ${variable}`)
  }
  return channels
}

function luminance(channels) {
  const linear = channels.map((channel) => {
    const value = channel / 255
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  })
  return (0.2126 * linear[0]) + (0.7152 * linear[1]) + (0.0722 * linear[2])
}

function contrast(foreground, background) {
  const foregroundLuminance = luminance(foreground)
  const backgroundLuminance = luminance(background)
  return (Math.max(foregroundLuminance, backgroundLuminance) + 0.05)
    / (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
}

function contrastFailures(css) {
  const root = cssBlock(css, ':root')
  const light = cssBlock(css, ":root[data-theme='light']")
  const themes = [
    { name: 'dark', blocks: [root] },
    { name: 'light', blocks: [root, light] },
  ]
  const foregrounds = [
    '--app-text-rgb',
    '--app-text-secondary-rgb',
    '--app-text-tertiary-rgb',
    '--app-status-success-rgb',
    '--app-status-warning-rgb',
    '--app-status-info-rgb',
    '--app-status-danger-rgb',
    '--app-mention-rgb',
  ]
  const backgrounds = [
    '--app-bg-rgb',
    '--app-surface-rgb',
    '--app-surface-2-rgb',
    '--app-elevated-rgb',
  ]
  const failures = []

  for (const theme of themes) {
    for (const foreground of foregrounds) {
      for (const background of backgrounds) {
        const ratio = contrast(rgb(theme.blocks, foreground), rgb(theme.blocks, background))
        if (ratio < 4.5) failures.push(`${theme.name}: ${foreground} on ${background} is ${ratio.toFixed(2)}:1`)
      }
    }
  }

  const accentNames = ['green', 'blue', 'orange', 'rose', 'violet']
  for (const accent of accentNames) {
    const darkAccent = cssBlock(css, `:root[data-accent='${accent}']`)
    const lightAccent = cssBlock(css, `:root[data-theme='light'][data-accent='${accent}']`)
    for (const [themeName, blocks] of [
      ['dark', [root, darkAccent]],
      ['light', [root, light, lightAccent]],
    ]) {
      for (const background of ['--app-accent-rgb', '--app-accent-hover-rgb']) {
        const ratio = contrast(rgb(blocks, '--app-accent-contrast-rgb'), rgb(blocks, background))
        if (ratio < 4.5) failures.push(`${themeName} ${accent}: accent contrast on ${background} is ${ratio.toFixed(2)}:1`)
      }
    }
  }

  for (const theme of themes) {
    for (const background of ['--app-danger-fill-rgb', '--app-danger-fill-hover-rgb']) {
      const ratio = contrast(rgb(theme.blocks, '--app-on-danger-rgb'), rgb(theme.blocks, background))
      if (ratio < 4.5) failures.push(`${theme.name}: on-danger on ${background} is ${ratio.toFixed(2)}:1`)
    }
  }
  return failures
}

export function auditTypography(repoRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)))) {
  const rendererRoot = path.join(repoRoot, 'src/renderer')
  const metricFailures = rendererFiles(rendererRoot).flatMap((file) => {
    const relative = path.relative(repoRoot, file)
    return findTypographyViolations(fs.readFileSync(file, 'utf8'))
      .filter(({ token }) => {
        if (relative === 'src/renderer/lib/typography.ts' && APPROVED_TYPE_TOKENS.has(token)) return false
        return !(APPROVED_INLINE_METRICS.get(relative) ?? []).some((pattern) => pattern.test(token))
      })
      .map((violation) => ({ relative, ...violation }))
  })
  const css = fs.readFileSync(path.join(rendererRoot, 'index.css'), 'utf8')
  return {
    metricFailures,
    cssMetricFailures: findCssTypographyViolations(css),
    contrastFailures: contrastFailures(css),
  }
}

function main() {
  const { metricFailures, cssMetricFailures, contrastFailures: colorFailures } = auditTypography()
  if (metricFailures.length === 0 && cssMetricFailures.length === 0 && colorFailures.length === 0) {
    console.log('Typography audit passed.')
    return
  }
  if (metricFailures.length > 0) {
    console.error('Unauthorized typography utilities:')
    for (const failure of metricFailures) console.error(`  ${failure.relative}:${failure.line} ${failure.token}`)
  }
  if (cssMetricFailures.length > 0) {
    console.error('Unauthorized stylesheet typography declarations:')
    for (const failure of cssMetricFailures) {
      console.error(`  src/renderer/index.css:${failure.line} ${failure.selector} { ${failure.property}: ${failure.value} }`)
    }
  }
  if (colorFailures.length > 0) {
    console.error('Typography contrast failures:')
    for (const failure of colorFailures) console.error(`  ${failure}`)
  }
  process.exitCode = 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
