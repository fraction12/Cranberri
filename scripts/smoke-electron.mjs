import { _electron as electron } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const appExecutable = process.platform === 'darwin'
  ? path.resolve('dist/mac-arm64/Cranberri.app/Contents/MacOS/Cranberri')
  : process.platform === 'win32'
    ? path.resolve('dist/win-unpacked/Cranberri.exe')
    : path.resolve('dist/linux-unpacked/cranberri')

const SMOKE_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lUzf1wAAAABJRU5ErkJggg=='
const smokeScreenshotDir = process.env.CRANBERRI_SMOKE_SCREENSHOT_DIR
const useRendererScreenshots = process.env.CRANBERRI_SMOKE_RENDERER_SCREENSHOTS === '1'
const typographyUat = process.env.CRANBERRI_SMOKE_TYPOGRAPHY_UAT === '1'
const dropdownUat = process.env.CRANBERRI_SMOKE_DROPDOWN_UAT === '1'
const composerUatOnly = process.env.CRANBERRI_SMOKE_COMPOSER_UAT_ONLY === '1'
const handoffUatOnly = process.env.CRANBERRI_SMOKE_HANDOFF_UAT_ONLY === '1'
const realCodexTimeoutMs = Number(process.env.CRANBERRI_SMOKE_REAL_TIMEOUT_MS ?? 180_000)
const capturedSmokeScreenshots = new Set()
let screenshotElectronApp = null

const REQUIRED_TYPOGRAPHY_UAT_CAPTURES = [
  'workspace-chat-light-compact',
  'workspace-chat-light-standard',
  'workspace-chat-light-large',
  'workspace-chat-dark-compact',
  'workspace-chat-dark-standard',
  'workspace-chat-dark-large',
  'dropdown-add-context-light-standard',
  'dropdown-approval-light-standard',
  'dropdown-skills-light-standard',
  'dropdown-skills-light-standard-scrolled',
  'model-selector-regular',
  'expandable-usage-light-standard',
  'expandable-health-light-standard',
  'dropdown-diff-options-light-standard',
  'dropdown-repo-options-light-standard',
  'dropdown-add-context-dark-large',
  'dropdown-add-context-dark-large-scrolled',
  'dropdown-approval-dark-large',
  'dropdown-model-dark-large',
  'dropdown-model-dark-large-scrolled',
  'dropdown-session-options-dark-large',
  'composer-long-message',
  'workspace-narrow-long-composer-dark',
]

if (typographyUat && (!smokeScreenshotDir || !useRendererScreenshots)) {
  throw new Error('Typography UAT requires CRANBERRI_SMOKE_SCREENSHOT_DIR and CRANBERRI_SMOKE_RENDERER_SCREENSHOTS=1.')
}

if (!fs.existsSync(appExecutable)) {
  throw new Error(`Packaged app not found at ${appExecutable}. Run npm run package:dir first.`)
}

function createFixtureRepo(rootDir, repoName = 'cranberri-smoke-repo', dirty = true) {
  const repoPath = path.join(rootDir, repoName)
  fs.mkdirSync(repoPath, { recursive: true })
  fs.writeFileSync(path.join(repoPath, 'README.md'), [
    '# Cranberri smoke repo',
    '',
    'Search marker: cranberri-electron-smoke-search.',
    '',
  ].join('\n'))
  fs.writeFileSync(path.join(repoPath, 'index.html'), [
    '<!doctype html>',
    '<html>',
    '<head><title>Smoke Browser Page</title></head>',
    '<body><main><h1>Smoke Browser Page</h1><p>cranberri-browser-smoke-ready</p></main></body>',
    '</html>',
  ].join('\n'))
  fs.writeFileSync(path.join(repoPath, 'smoke-image.png'), Buffer.from(SMOKE_PNG_BASE64, 'base64'))
  execFileSync('git', ['init', '--quiet'], { cwd: repoPath, stdio: 'ignore' })
  execFileSync('git', ['remote', 'add', 'origin', 'git@github.com:fraction12/Cranberri.git'], { cwd: repoPath, stdio: 'ignore' })
  execFileSync('git', ['add', 'README.md', 'index.html', 'smoke-image.png'], { cwd: repoPath, stdio: 'ignore' })
  execFileSync('git', ['-c', 'user.name=Cranberri Smoke', '-c', 'user.email=smoke@example.invalid', 'commit', '--quiet', '-m', 'Initial smoke fixture'], { cwd: repoPath, stdio: 'ignore' })
  execFileSync('git', ['branch', 'smoke/context'], { cwd: repoPath, stdio: 'ignore' })
  execFileSync('git', ['tag', 'v0.0.0-smoke'], { cwd: repoPath, stdio: 'ignore' })
  if (dirty) fs.appendFileSync(path.join(repoPath, 'README.md'), 'Modified marker: cranberri-diff-smoke-ready.\n')
  return repoPath
}

function seedRegisteredRepo(userDataDir, repoPath, secondaryRepoPath = null) {
  const repos = [{
    id: 'smoke-repo',
    name: path.basename(repoPath),
    path: repoPath,
  }]
  if (secondaryRepoPath) {
    repos.push({
      id: 'smoke-repo-secondary',
      name: path.basename(secondaryRepoPath),
      path: secondaryRepoPath,
    })
  }
  fs.writeFileSync(path.join(userDataDir, 'repos.json'), JSON.stringify({
    repos,
    activeRepoId: 'smoke-repo',
  }, null, 2))
}

function smokeStep(label) {
  console.log(`[smoke] ${label}`)
}

async function captureSmokeScreenshot(page, name) {
  if (!smokeScreenshotDir) return
  await page.evaluate(() => new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve))
  }))
  await page.waitForTimeout(50)
  if (screenshotElectronApp && !useRendererScreenshots) {
    await captureNativeSmokeScreenshot(screenshotElectronApp, name)
    capturedSmokeScreenshots.add(name)
    return
  }
  fs.mkdirSync(smokeScreenshotDir, { recursive: true })
  await page.screenshot({ path: path.join(smokeScreenshotDir, `${name}.png`) })
  capturedSmokeScreenshots.add(name)
}

function assertGeometry(metrics, expected, label) {
  const tolerance = 0.75
  for (const [key, expectedValue] of Object.entries(expected)) {
    const actualValue = metrics[key]
    if (!Number.isFinite(actualValue) || Math.abs(actualValue - expectedValue) > tolerance) {
      throw new Error(`${label} ${key} rendered at ${actualValue}px; expected ${expectedValue}px (${JSON.stringify(metrics)})`)
    }
  }
}

async function assertSelectControlGeometry(control, density) {
  const metrics = await control.evaluate((element) => {
    const host = element.closest('[data-select-control]')
    const chevron = host?.querySelector('[data-select-chevron]')
    if (!(host instanceof HTMLElement) || !(chevron instanceof SVGElement)) {
      throw new Error('Select control is missing its shared host or chevron')
    }
    const controlRect = element.getBoundingClientRect()
    const chevronRect = chevron.getBoundingClientRect()
    const computed = getComputedStyle(element)
    return {
      height: controlRect.height,
      paddingLeft: Number.parseFloat(computed.paddingLeft),
      paddingRight: Number.parseFloat(computed.paddingRight),
      rightInset: controlRect.right - chevronRect.right,
      chevronWidth: chevronRect.width,
    }
  })
  assertGeometry(metrics, density === 'standard'
    ? { height: 36, paddingLeft: 14, paddingRight: 40, rightInset: 12, chevronWidth: 14 }
    : { height: 32, paddingLeft: 10, paddingRight: 32, rightInset: 10, chevronWidth: 12 }, `${density} select`)
}

async function assertCompactDropdownGeometry(trigger) {
  const metrics = await trigger.evaluate((element) => {
    const chevron = element.querySelector('[data-dropdown-chevron]')
    if (!(chevron instanceof SVGElement)) throw new Error('Dropdown trigger is missing its shared chevron')
    const triggerRect = element.getBoundingClientRect()
    const chevronRect = chevron.getBoundingClientRect()
    const computed = getComputedStyle(element)
    return {
      height: triggerRect.height,
      paddingRight: Number.parseFloat(computed.paddingRight),
      rightInset: triggerRect.right - chevronRect.right,
      chevronWidth: chevronRect.width,
    }
  })
  assertGeometry(metrics, { height: 28, paddingRight: 10, rightInset: 10, chevronWidth: 12 }, 'compact dropdown')
}

async function assertRenderedTypography(page, preset) {
  const expectedByPreset = {
    compact: {
      body: ['12px', '18px'],
      prose: ['14px', '22px'],
      control: ['12px', '16px'],
      metadata: ['12px', '16px'],
      panelTitle: ['12px', '16px'],
    },
    standard: {
      body: ['13px', '20px'],
      prose: ['15px', '24px'],
      control: ['13px', '18px'],
      metadata: ['12px', '16px'],
      panelTitle: ['13px', '18px'],
    },
    large: {
      body: ['14px', '22px'],
      prose: ['16px', '26px'],
      control: ['14px', '20px'],
      metadata: ['13px', '18px'],
      panelTitle: ['14px', '20px'],
    },
  }
  const expected = expectedByPreset[preset]
  if (!expected) throw new Error(`Unknown typography preset: ${preset}`)

  await page.evaluate(({ expectedMetrics }) => {
    const parseRgb = (value) => {
      const channels = value.match(/[\d.]+/g)?.slice(0, 3).map(Number)
      if (!channels || channels.length !== 3) throw new Error(`Could not parse color: ${value}`)
      return channels
    }
    const luminance = (channels) => {
      const linear = channels.map((channel) => {
        const value = channel / 255
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
      })
      return (0.2126 * linear[0]) + (0.7152 * linear[1]) + (0.0722 * linear[2])
    }
    const contrast = (foreground, background) => {
      const foregroundLuminance = luminance(parseRgb(foreground))
      const backgroundLuminance = luminance(parseRgb(background))
      return (Math.max(foregroundLuminance, backgroundLuminance) + 0.05)
        / (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
    }

    const host = document.createElement('div')
    host.style.cssText = 'position:fixed;left:-10000px;top:0;display:block;'
    document.body.append(host)
    try {
      for (const [role, [fontSize, lineHeight]] of Object.entries(expectedMetrics)) {
        const probe = document.createElement('span')
        probe.className = `type-${role.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`
        probe.textContent = role
        host.append(probe)
        const computed = getComputedStyle(probe)
        if (computed.fontSize !== fontSize || computed.lineHeight !== lineHeight) {
          throw new Error(`${role} rendered ${computed.fontSize}/${computed.lineHeight}; expected ${fontSize}/${lineHeight}`)
        }
      }

      const backgrounds = ['bg-app-bg', 'bg-app-surface', 'bg-app-surface-2', 'bg-app-elevated']
      const tones = [
        'text-app-text',
        'text-app-text-secondary',
        'text-app-text-tertiary',
        'text-app-status-success',
        'text-app-status-warning',
        'text-app-status-info',
        'text-app-status-danger',
        'text-app-mention',
      ]
      for (const backgroundClass of backgrounds) {
        const surface = document.createElement('div')
        surface.className = backgroundClass
        host.append(surface)
        const background = getComputedStyle(surface).backgroundColor
        for (const toneClass of tones) {
          const probe = document.createElement('span')
          probe.className = toneClass
          probe.textContent = toneClass
          surface.append(probe)
          const ratio = contrast(getComputedStyle(probe).color, background)
          if (ratio < 4.5) throw new Error(`${toneClass} on ${backgroundClass} rendered at ${ratio.toFixed(2)}:1`)
        }
      }
    } finally {
      host.remove()
    }
  }, { expectedMetrics: expected })
}

async function scrollOpenSurface(page, surface, name) {
  await surface.waitFor({ state: 'visible', timeout: 10_000 })
  const metrics = await surface.evaluate((element, surfaceName) => {
    element.dataset.smokeScrollSurface = surfaceName
    element.dataset.smokeScrollStart = String(element.scrollTop)
    return {
      initial: element.scrollTop,
      maximum: element.scrollHeight - element.clientHeight,
    }
  }, name)
  if (metrics.maximum <= 0) throw new Error(`${name} was expected to scroll but had no overflow.`)
  const bounds = await surface.boundingBox()
  if (!bounds) throw new Error(`${name} did not have visible bounds.`)
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
  await page.mouse.wheel(0, metrics.initial < metrics.maximum ? 320 : -320)
  await page.waitForFunction((surfaceName) => {
    const element = document.querySelector(`[data-smoke-scroll-surface="${surfaceName}"]`)
    return element instanceof HTMLElement
      && element.scrollTop !== Number(element.dataset.smokeScrollStart)
  }, name, { timeout: 10_000 })
  await surface.waitFor({ state: 'visible', timeout: 2_000 })
}

async function captureNativeSmokeScreenshot(electronApp, name) {
  if (!smokeScreenshotDir) return
  fs.mkdirSync(smokeScreenshotDir, { recursive: true })
  const base64 = await electronApp.evaluate(async ({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0]
    if (!window) throw new Error('Main window not found')
    window.webContents.invalidate()
    await new Promise((resolve) => setTimeout(resolve, 75))
    return (await window.capturePage()).toPNG().toString('base64')
  })
  fs.writeFileSync(path.join(smokeScreenshotDir, `${name}.png`), Buffer.from(base64, 'base64'))
}

async function launchApp(userDataDir, extraEnv = {}) {
  return electron.launch({
    executablePath: appExecutable,
    env: {
      ...process.env,
      CRANBERRI_USER_DATA_DIR: userDataDir,
      CRANBERRI_HOME: path.join(userDataDir, 'cranberri-home'),
      ...extraEnv,
    },
  })
}

async function mainWindowChildViewCount(electronApp) {
  return electronApp.evaluate(({ BrowserWindow }) => (
    BrowserWindow.getAllWindows()[0]?.contentView.children.length ?? -1
  ))
}

async function setAttachedBrowserBackground(electronApp, color) {
  return electronApp.evaluate(async ({ BrowserWindow }, nextColor) => {
    const window = BrowserWindow.getAllWindows()[0]
    if (!window) throw new Error('Main window not found')
    const browserView = window.contentView.children.find((view) => (
      'webContents' in view && !view.webContents.isDestroyed()
    ))
    if (!browserView || !('webContents' in browserView)) {
      throw new Error('Attached browser view not found')
    }
    return browserView.webContents.executeJavaScript(`
      document.documentElement.style.background = ${JSON.stringify(nextColor)};
      document.body.style.background = ${JSON.stringify(nextColor)};
      getComputedStyle(document.body).backgroundColor;
    `)
  }, color)
}

async function waitForMainWindowChildViewCount(electronApp, expected, label) {
  const deadline = Date.now() + 10_000
  let count = await mainWindowChildViewCount(electronApp)
  while (count !== expected && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100))
    count = await mainWindowChildViewCount(electronApp)
  }
  if (count !== expected) {
    throw new Error(`${label}: expected ${expected} native child views, found ${count}`)
  }
}

async function resizeMainWindow(electronApp, width, height, minimumWidth, minimumHeight) {
  await electronApp.evaluate(({ BrowserWindow }, bounds) => {
    const window = BrowserWindow.getAllWindows()[0]
    if (!window) throw new Error('Main window not found')
    window.setMinimumSize(bounds.minimumWidth, bounds.minimumHeight)
    window.setSize(bounds.width, bounds.height)
  }, { width, height, minimumWidth, minimumHeight })
}

async function smokePage(electronApp, run) {
  const pageErrors = []
  const consoleErrors = []
  const page = await electronApp.firstWindow({ timeout: 20_000 })
  page.on('pageerror', (error) => pageErrors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })

  await page.waitForLoadState('domcontentloaded')
  await page.locator('header').getByText('Cranberri', { exact: true }).waitFor({ timeout: 10_000 })
  screenshotElectronApp = electronApp

  try {
    await run(page)
  } catch (error) {
    const diagnostics = [
      pageErrors.length > 0 ? `Renderer page errors:\n${pageErrors.join('\n')}` : null,
      consoleErrors.length > 0 ? `Renderer console errors:\n${consoleErrors.join('\n')}` : null,
    ].filter(Boolean).join('\n')
    if (diagnostics) throw new Error(`${error instanceof Error ? error.message : String(error)}\n${diagnostics}`, { cause: error })
    throw error
  } finally {
    if (screenshotElectronApp === electronApp) screenshotElectronApp = null
  }

  if (pageErrors.length > 0) {
    throw new Error(`Renderer page errors:\n${pageErrors.join('\n')}`)
  }

  const unexpectedConsoleErrors = consoleErrors.filter((line) => !/Failed to check Codex connection/i.test(line))
  if (unexpectedConsoleErrors.length > 0) {
    throw new Error(`Renderer console errors:\n${unexpectedConsoleErrors.join('\n')}`)
  }
}

async function closeElectronApp(electronApp) {
  const appProcess = electronApp.process()
  await Promise.race([
    electronApp.close().catch(() => undefined),
    new Promise((resolve) => setTimeout(resolve, 5_000)),
  ])
  if (!appProcess.killed) appProcess.kill('SIGTERM')
}

async function clickCommandItemByText(page, text, timeout = 10_000) {
  try {
    await page.waitForFunction((label) => {
      return [...document.querySelectorAll('[cmdk-item]')]
        .some((item) => item.textContent?.includes(label))
    }, text, { timeout })
  } catch (error) {
    const visibleItems = await page.locator('[cmdk-item]').allTextContents()
    const paletteText = await page.locator('[cmdk-list]').textContent().catch(() => null)
    throw new Error(`Command item did not appear: ${text}. Items: ${JSON.stringify(visibleItems)}. Palette: ${paletteText}`, { cause: error })
  }
  await page.evaluate((label) => {
    const item = [...document.querySelectorAll('[cmdk-item]')]
      .find((node) => node.textContent?.includes(label))
    if (!item) throw new Error(`Command item not found: ${label}`)
    item.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  }, text)
}

async function runClipboardCommand(page, action, label, expectedParts, timeout = 10_000) {
  const sentinel = `cranberri-smoke-pending-${Date.now()}-${Math.random()}`
  await page.evaluate((text) => navigator.clipboard.writeText(text), sentinel)
  await action.click()
  await page.locator('[data-sonner-toast][data-type="success"] [data-title]')
    .filter({ hasText: label })
    .last()
    .waitFor({ timeout })
  await page.waitForFunction(async (parts) => {
    const text = await navigator.clipboard.readText()
    return parts.every((part) => text.includes(part))
  }, expectedParts, { timeout })
  return page.evaluate(() => navigator.clipboard.readText())
}

async function waitForVisibleToastsToClear(page, timeout = 10_000) {
  await page.mouse.move(24, 24)
  try {
    await page.waitForFunction(
      () => !document.querySelector('[data-sonner-toast][data-visible="true"]'),
      undefined,
      { timeout },
    )
  } catch (error) {
    const toastStates = await page.locator('[data-sonner-toast]').evaluateAll((toasts) => (
      toasts.map((toast) => ({
        text: toast.textContent,
        visible: toast.getAttribute('data-visible'),
        removed: toast.getAttribute('data-removed'),
        mounted: toast.getAttribute('data-mounted'),
      }))
    ))
    throw new Error(`Visible toasts did not clear: ${JSON.stringify(toastStates)}`, { cause: error })
  }
  await page.waitForTimeout(250)
}

async function clickButtonByAccessibleName(page, name, timeout = 10_000) {
  await page.waitForFunction((expectedName) => {
    return [...document.querySelectorAll('button')]
      .some((button) => button.getAttribute('aria-label') === expectedName || button.getAttribute('title') === expectedName)
  }, name, { timeout })
  await page.evaluate((expectedName) => {
    const button = [...document.querySelectorAll('button')]
      .find((node) => node.getAttribute('aria-label') === expectedName || node.getAttribute('title') === expectedName)
    if (!button) throw new Error(`Button not found: ${expectedName}`)
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  }, name)
}

async function waitForAssistantArticleText(page, text, minimumCount = 1, timeout = 10_000) {
  await page.waitForFunction(({ expectedText, count }) => {
    return [...document.querySelectorAll('article')]
      .filter((article) => article.textContent?.includes(expectedText))
      .length >= count
  }, { expectedText: text, count: minimumCount }, { timeout })
}

async function waitForRealCodexArticleText(page, text, repoPath) {
  try {
    await waitForAssistantArticleText(page, text, 1, realCodexTimeoutMs)
  } catch (error) {
    const diagnostics = await page.evaluate(async (targetRepoPath) => {
      const [connection, tasks, threads, health] = await Promise.allSettled([
        window.cranberri.codex.getConnectionStatus(),
        window.cranberri.tasks.snapshot(),
        window.cranberri.codex.listThreads(targetRepoPath, { archived: false, limit: 10 }),
        window.cranberri.health.diagnostics(),
      ])
      const value = (result) => result.status === 'fulfilled' ? result.value : { error: String(result.reason) }
      return {
        connection: value(connection),
        tasks: value(tasks),
        threads: value(threads),
        health: value(health),
        visibleText: document.body.innerText.slice(-8_000),
      }
    }, repoPath)
    throw new Error(`${error instanceof Error ? error.message : String(error)}\nReal Codex diagnostics:\n${JSON.stringify(diagnostics, null, 2)}`, { cause: error })
  }
}

async function openCommandPalette(page) {
  const input = page.getByPlaceholder('Run command or switch repo...')
  if (await input.count()) {
    const alreadyClosing = await input.waitFor({ state: 'detached', timeout: 250 })
      .then(() => true)
      .catch(() => false)
    if (!alreadyClosing && await input.isVisible().catch(() => false)) await page.keyboard.press('Escape')
    await input.waitFor({ state: 'detached', timeout: 10_000 })
  }
  const trigger = page.getByLabel('Open command palette')
  await trigger.focus()
  await trigger.evaluate((button) => {
    if (!(button instanceof HTMLButtonElement)) throw new Error('Open command palette button not found')
    button.click()
  })
  await page.waitForFunction(() => {
    return document.querySelector('button[aria-label="Open command palette"]')?.getAttribute('aria-expanded') === 'true'
  }, undefined, { timeout: 10_000 })
  await input.waitFor({ state: 'visible', timeout: 10_000 })
  await page.waitForTimeout(50)
  if (await trigger.getAttribute('aria-expanded') !== 'true') {
    throw new Error('Command palette closed again before it became interactive')
  }
}

async function submitGoToLine(page, action, value) {
  await action()
  const dialog = page.getByRole('dialog', { name: 'Go to line' })
  await dialog.waitFor({ timeout: 10_000 })
  await dialog.getByRole('textbox', { name: 'Line' }).fill(value)
  await dialog.getByRole('button', { name: 'Go' }).click()
}

async function runFreshStartupSmoke() {
  smokeStep('fresh startup')
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cranberri-smoke-fresh-'))
  const pendingUpdateResultPath = path.join(userDataDir, 'updater-result.json')
  fs.writeFileSync(pendingUpdateResultPath, JSON.stringify({
    success: true,
    phase: 'relaunching',
    message: 'Update installed successfully',
    logPath: null,
  }))
  const electronApp = await launchApp(userDataDir)

  try {
    await smokePage(electronApp, async (page) => {
      await page.locator('[data-sonner-toast][data-type="success"] [data-title]')
        .filter({ hasText: 'Update installed successfully' })
        .waitFor({ timeout: 10_000 })
      if (!fs.existsSync(pendingUpdateResultPath)) throw new Error('Pending update diagnostics were cleared before acknowledgement')
      const retainedResult = JSON.parse(fs.readFileSync(pendingUpdateResultPath, 'utf8'))
      if (!retainedResult.success || retainedResult.phase !== 'relaunching') {
        throw new Error(`Pending update diagnostics were corrupted: ${JSON.stringify(retainedResult)}`)
      }
      await page.getByText('No repo selected').waitFor({ timeout: 10_000 })
      await waitForVisibleToastsToClear(page)

      await page.getByLabel('Open settings').click()
      await page.getByRole('heading', { name: 'Settings' }).waitFor({ timeout: 10_000 })
      await page.getByText('Checking Codex connection...', { exact: true }).waitFor({ state: 'detached', timeout: 15_000 })
      await captureSmokeScreenshot(page, 'settings-general-light')
      const defaultModel = page.getByLabel('Default model')
      const defaultEffort = page.getByLabel('Default reasoning effort')
      const defaultSpeed = page.getByLabel('Default speed')
      const defaultApproval = page.getByLabel('Default approval mode')
      for (const control of [defaultModel, defaultEffort, defaultSpeed, defaultApproval]) {
        await assertSelectControlGeometry(control, 'standard')
      }
      await defaultModel.selectOption('gpt-5.6-sol')
      await defaultEffort.locator('option[value="ultra"]').waitFor({ state: 'attached', timeout: 10_000 })
      await defaultEffort.selectOption('ultra')
      await defaultSpeed.selectOption('fast')
      await defaultModel.selectOption('gpt-5.4-mini')
      await page.waitForFunction(() => {
        const effort = document.querySelector('select[aria-label="Default reasoning effort"]')
        const speed = document.querySelector('select[aria-label="Default speed"]')
        return effort?.value === 'medium'
          && ![...effort.options].some((option) => option.value === 'ultra')
          && speed?.value === 'standard'
          && ![...speed.options].some((option) => option.value === 'fast')
      }, undefined, { timeout: 10_000 })
      await page.getByRole('button', { name: 'Appearance' }).click()
      await page.getByRole('group', { name: 'Theme' }).getByRole('button', { name: 'Light' }).click()
      await page.waitForFunction(() => document.documentElement.dataset.theme === 'light')
      const nativeThemeSource = await electronApp.evaluate(({ nativeTheme }) => nativeTheme.themeSource)
      if (nativeThemeSource !== 'light') throw new Error(`Native theme did not follow renderer setting: ${nativeThemeSource}`)
      await page.getByRole('group', { name: 'Accent color' }).getByRole('button', { name: 'Blue' }).click()
      await page.waitForFunction(() => document.documentElement.dataset.accent === 'blue')
      await page.getByRole('group', { name: 'Interface text size' }).getByRole('button', { name: 'Large' }).click()
      await page.waitForFunction(() => (
        document.documentElement.dataset.typePreset === 'large'
        && getComputedStyle(document.documentElement).fontSize === '16px'
      ))
      await page.waitForTimeout(200)
      await captureSmokeScreenshot(page, 'appearance-light')
      if (smokeScreenshotDir) {
        await page.getByRole('group', { name: 'Theme' }).getByRole('button', { name: 'Dark' }).click()
        await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark')
        await page.waitForFunction(() => document.querySelector('button[aria-pressed="true"]')?.textContent?.trim() === 'Dark')
        await page.waitForTimeout(200)
        await captureSmokeScreenshot(page, 'appearance-dark')

        await page.getByRole('button', { name: 'General', exact: true }).click()
        await page.getByRole('heading', { name: 'General', exact: true }).waitFor({ timeout: 10_000 })
        await captureSmokeScreenshot(page, 'settings-general-dark')
        await page.getByRole('button', { name: 'Tools', exact: true }).click()
        await page.getByPlaceholder('Search tools').waitFor({ timeout: 10_000 })
        await page.getByText('Loading tools...', { exact: true }).waitFor({ state: 'detached', timeout: 15_000 })
        await captureSmokeScreenshot(page, 'settings-tools-dark')
        await page.getByRole('button', { name: 'Extensions', exact: true }).click()
        await page.getByRole('heading', { name: 'Extensions', exact: true }).waitFor({ timeout: 10_000 })
        await page.getByText('Loading extensions', { exact: true }).waitFor({ state: 'detached', timeout: 15_000 })
        await captureSmokeScreenshot(page, 'settings-extensions-dark')
        await page.getByRole('button', { name: 'Updates', exact: true }).click()
        await page.getByRole('heading', { name: 'Updates', exact: true }).waitFor({ timeout: 10_000 })
        await captureSmokeScreenshot(page, 'settings-updates-dark')
        await page.getByRole('button', { name: 'Diagnostics', exact: true }).click()
        await page.getByRole('heading', { name: 'Diagnostics', exact: true }).waitFor({ timeout: 10_000 })
        await page.getByText('Reading diagnostics...', { exact: true }).waitFor({ state: 'detached', timeout: 15_000 })
        await captureSmokeScreenshot(page, 'settings-diagnostics-dark')
        await page.getByRole('button', { name: 'Shortcuts', exact: true }).click()
        await page.getByRole('heading', { name: 'Shortcuts', exact: true }).waitFor({ timeout: 10_000 })
        await captureSmokeScreenshot(page, 'settings-shortcuts-dark')
        await page.getByRole('button', { name: 'About', exact: true }).click()
        await page.getByRole('heading', { name: 'About', exact: true }).waitFor({ timeout: 10_000 })
        await captureSmokeScreenshot(page, 'settings-about-dark')

        await page.getByRole('button', { name: 'Appearance', exact: true }).click()
        await page.getByRole('group', { name: 'Theme' }).getByRole('button', { name: 'Light' }).click()
        await page.waitForFunction(() => document.documentElement.dataset.theme === 'light')
      }
      await page.getByRole('button', { name: 'Diagnostics' }).click()
      await page.getByText(/Everything looks good|items? need attention/).waitFor({ timeout: 10_000 })
      await page.getByText('Files and logs', { exact: true }).click()
      await page.getByText('User data').waitFor({ timeout: 10_000 })
      await page.getByLabel('Copy User data').click()
      await page.waitForFunction((expectedPath) => navigator.clipboard.readText().then((text) => text === expectedPath), userDataDir, { timeout: 10_000 })
      await page.locator('[data-sonner-toast][data-type="success"] [data-title]').filter({ hasText: 'Copied user data' }).waitFor({ timeout: 10_000 })
      const openUserDataPath = page.getByLabel('Open User data')
      const revealUserDataPath = page.getByLabel('Reveal User data')
      await openUserDataPath.waitFor({ timeout: 10_000 })
      await revealUserDataPath.waitFor({ timeout: 10_000 })
      if (await openUserDataPath.isDisabled() || await revealUserDataPath.isDisabled()) {
        throw new Error('Diagnostics user-data native handoff controls should be enabled')
      }
      if (process.platform === 'darwin') {
        await page.getByLabel('Open Apple Events automation settings').waitFor({ timeout: 10_000 })
      }
      await waitForVisibleToastsToClear(page)
      await captureSmokeScreenshot(page, 'settings-diagnostics-light')
      await page.getByRole('button', { name: 'Extensions' }).click()
      await page.getByRole('heading', { name: 'Extensions' }).waitFor({ timeout: 10_000 })
      await page.getByRole('button', { name: 'Installed' }).waitFor({ timeout: 10_000 })
      await page.getByText('Loading extensions', { exact: true }).waitFor({ state: 'detached', timeout: 15_000 })
      await captureSmokeScreenshot(page, 'settings-extensions-light')
      await page.getByRole('button', { name: 'Connections', exact: true }).click()
      await page.getByRole('heading', { name: 'Available apps', exact: true }).waitFor({ timeout: 10_000 })
      await page.getByRole('heading', { name: 'App directory', exact: true }).waitFor({ timeout: 10_000 })
      if (await page.getByRole('heading', { name: 'Connected apps', exact: true }).count()) {
        throw new Error('Connections still labels Codex directory entries as connected apps')
      }
      const appDirectory = page.locator('[data-app-directory="true"]')
      const showUnavailableApps = appDirectory.getByRole('button', { name: 'Show unavailable' })
      if (await showUnavailableApps.count()) {
        await showUnavailableApps.click()
        await appDirectory.getByText('Unavailable', { exact: true }).first().waitFor({ timeout: 10_000 })
        if (await appDirectory.getByTitle('Add to chat').count()) {
          throw new Error('Unavailable directory apps still expose an add-to-chat action')
        }
      }
      await captureSmokeScreenshot(page, 'settings-connections-light')
      const settingsContent = page.locator('main[aria-live="polite"]')
      await settingsContent.evaluate((element) => { element.scrollTop = element.scrollHeight })
      await page.getByRole('button', { name: 'Updates' }).click()
      await page.getByRole('heading', { name: 'Updates' }).waitFor({ timeout: 10_000 })
      await page.waitForFunction(() => document.querySelector('main[aria-live="polite"]')?.scrollTop === 0)
      await captureSmokeScreenshot(page, 'settings-updates-light')
      if (await page.getByText('Install result', { exact: true }).count()) {
        throw new Error('Completed update results should be shown as toasts, not modal content')
      }
      await page.getByLabel('Close settings').click()
      await page.getByText('Settings').waitFor({ state: 'detached', timeout: 10_000 })

      await openCommandPalette(page)
      await page.getByPlaceholder('Run command or switch repo...').fill('copy diagnostics user data path')
      await clickCommandItemByText(page, 'Copy diagnostics User data path')
      await page.waitForFunction((expectedPath) => navigator.clipboard.readText().then((text) => text === expectedPath), userDataDir, { timeout: 10_000 })
      await openCommandPalette(page)
      await page.getByPlaceholder('Run command or switch repo...').fill('reveal diagnostics user data path')
      await page.locator('[cmdk-item]').filter({ hasText: 'Reveal diagnostics User data path' }).first().waitFor({ timeout: 10_000 })
      await page.keyboard.press('Escape')
      await page.getByPlaceholder('Run command or switch repo...').waitFor({ state: 'detached', timeout: 10_000 })
      await openCommandPalette(page)
      await page.getByPlaceholder('Run command or switch repo...').fill('macos accessibility permission')
      await page.locator('[cmdk-item]').filter({ hasText: 'Open macOS Accessibility settings' }).first().waitFor({ timeout: 10_000 })
      await page.keyboard.press('Escape')
      await page.getByPlaceholder('Run command or switch repo...').waitFor({ state: 'detached', timeout: 10_000 })
      await openCommandPalette(page)
      await page.getByPlaceholder('Run command or switch repo...').fill('clear telemetry debug logs')
      await page.locator('[cmdk-item]').filter({ hasText: 'Clear diagnostics telemetry' }).first().waitFor({ timeout: 10_000 })
      await page.keyboard.press('Escape')
      await page.getByPlaceholder('Run command or switch repo...').waitFor({ state: 'detached', timeout: 10_000 })

      await openCommandPalette(page)
      await page.getByPlaceholder('Run command or switch repo...').waitFor({ timeout: 10_000 })
      await page.waitForFunction(() => document.activeElement?.getAttribute('placeholder') === 'Run command or switch repo...')
      await page.keyboard.press('Tab')
      await page.waitForFunction(() => {
        const dialog = document.querySelector('[role="dialog"]')
        return dialog instanceof HTMLElement && dialog.contains(document.activeElement)
      })
      await page.getByPlaceholder('Run command or switch repo...').fill('settings')
      await page.getByText('Open settings').waitFor({ timeout: 10_000 })
      await page.getByText('Loading Codex capabilities...', { exact: true }).waitFor({ state: 'detached', timeout: 15_000 })
      await waitForVisibleToastsToClear(page)
      await captureSmokeScreenshot(page, 'command-palette-light')
      await page.keyboard.press('Escape')
      await page.getByPlaceholder('Run command or switch repo...').waitFor({ state: 'detached', timeout: 10_000 })
      await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Open command palette')
    })
  } finally {
    await closeElectronApp(electronApp)
    fs.rmSync(userDataDir, { recursive: true, force: true })
  }
}

async function runIdleToolCatalogSmoke() {
  smokeStep('idle tool catalog enrichment')
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cranberri-smoke-idle-tools-'))
  const electronApp = await launchApp(userDataDir, { CRANBERRI_FAKE_CODEX: '1' })

  try {
    await smokePage(electronApp, async (page) => {
      await page.getByText('No repo selected').waitFor({ timeout: 10_000 })
      await page.getByLabel('Open settings').click()
      const settingsDialog = page.getByRole('dialog', { name: 'Settings' })
      await settingsDialog.getByRole('button', { name: 'Tools', exact: true }).click()
      const search = settingsDialog.getByPlaceholder('Search tools')
      await search.waitFor({ timeout: 10_000 })
      await search.fill('inspect_fixture')
      await settingsDialog.getByLabel('Tool catalog').locator('article')
        .filter({ hasText: 'inspect_fixture' })
        .first()
        .waitFor({ timeout: 20_000 })
      await settingsDialog.getByLabel('Close settings').click()
    })
  } finally {
    await closeElectronApp(electronApp)
    fs.rmSync(userDataDir, { recursive: true, force: true })
  }
}

async function runRealCodexSmoke() {
  smokeStep('real Codex app-server first turn')
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cranberri-smoke-real-codex-'))
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cranberri-smoke-real-fixture-'))
  const repoPath = fs.realpathSync(createFixtureRepo(fixtureRoot, 'cranberri-real-codex-repo', false))
  seedRegisteredRepo(userDataDir, repoPath)
  const electronApp = await launchApp(userDataDir, {
    CRANBERRI_FAKE_CODEX: '0',
    GITHUB_TOKEN: '',
    GH_TOKEN: '',
  })

  try {
    await smokePage(electronApp, async (page) => {
      await page.getByText(repoPath).waitFor({ timeout: 10_000 })
      const composer = page.getByRole('textbox', { name: 'Chat message' })
      await composer.waitFor({ timeout: 20_000 })
      await composer.fill('Reply with exactly the five lowercase words cranberri, real, codex, smoke, and ready joined by hyphens. Do not use tools or modify files.')
      await page.getByLabel('Send message').click()
      await waitForRealCodexArticleText(page, 'cranberri-real-codex-smoke-ready', repoPath)
      if (await page.getByText(/Fake Codex received:/).count()) {
        throw new Error('Real Codex smoke used FakeCodexClient')
      }
      await page.waitForFunction(async (targetRepoPath) => {
        const result = await window.cranberri.codex.listThreads(targetRepoPath, { archived: false, limit: 10 })
        return result.sessions.length > 0
      }, repoPath, { timeout: 30_000 })
      const identity = await page.evaluate(async () => {
        const snapshot = await window.cranberri.tasks.snapshot()
        const task = snapshot.tasks.find((candidate) => candidate.location === 'local' && candidate.threadId)
        return task ? { taskId: task.id, threadId: task.threadId } : null
      })
      if (!identity?.threadId) throw new Error('Real Codex session did not persist task identity')
      await page.getByRole('button', { name: 'Task actions' }).click()
      await page.getByRole('menuitem', { name: 'Continue in worktree' }).click()
      await page.getByText(/^Continued in a worktree(?: with Local changes)?$/).waitFor({ timeout: 30_000 })
      await page.waitForFunction(async ({ taskId, threadId }) => {
        const status = await window.cranberri.tasks.status(taskId)
        return status.task.threadId === threadId && status.task.location === 'worktree' && status.task.state === 'active'
      }, identity, { timeout: 30_000 })
      const promoted = await page.evaluate((taskId) => window.cranberri.tasks.status(taskId), identity.taskId)
      if (!promoted.worktree) {
        const snapshot = await page.evaluate(() => window.cranberri.tasks.snapshot())
        throw new Error(`Real Codex promotion did not create a managed worktree: ${JSON.stringify({ promoted, snapshot })}`)
      }
      const projectHistory = await page.evaluate(() => window.cranberri.tasks.history({ projectId: 'smoke-repo', limit: 10 }))
      if (!projectHistory.sessions.some((session) => session.id === identity.threadId)) {
        throw new Error('Promoted real Codex session disappeared from project history')
      }
      await composer.fill('Use the shell to write the absolute current working directory followed by a newline to a file named .cranberri-worktree-cwd-proof in the current directory. Then reply with exactly cranberri-real-worktree-ready.')
      await page.getByLabel('Send message').click()
      await waitForRealCodexArticleText(page, 'cranberri-real-worktree-ready', repoPath)
      const proofPath = path.join(promoted.worktree.path, '.cranberri-worktree-cwd-proof')
      if (!fs.existsSync(proofPath) || fs.readFileSync(proofPath, 'utf8').trim() !== promoted.worktree.path) {
        throw new Error('Real Codex second turn did not execute in the promoted worktree')
      }
      if (fs.existsSync(path.join(repoPath, '.cranberri-worktree-cwd-proof'))) {
        throw new Error('Real Codex second turn leaked into the pinned Local checkout')
      }
      const changedFiles = await page.evaluate((targetRepoPath) => window.cranberri.git.status(targetRepoPath), repoPath)
      if (changedFiles.length > 0) {
        throw new Error(`Real Codex smoke modified its clean fixture: ${JSON.stringify(changedFiles)}`)
      }
    })
  } finally {
    await closeElectronApp(electronApp)
    fs.rmSync(userDataDir, { recursive: true, force: true })
    fs.rmSync(fixtureRoot, { recursive: true, force: true })
  }
}

async function runSessionWorkspaceSmoke() {
  smokeStep('session workspace lifecycle')
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cranberri-smoke-sessions-'))
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cranberri-smoke-session-fixture-'))
  const repoPath = createFixtureRepo(fixtureRoot, 'cranberri-session-repo', false)
  fs.writeFileSync(path.join(repoPath, 'local-draft.txt'), 'carry this Local change\n')
  seedRegisteredRepo(userDataDir, repoPath)
  const staleWorkspace = {
    activeWindowId: 'legacy-local-window',
    windows: [{
      id: 'legacy-local-window', type: 'chat', title: 'Local control', projectId: 'smoke-repo',
      taskId: 'control-smoke-repo', checkoutId: 'local-smoke-repo',
    }],
  }
  fs.writeFileSync(path.join(userDataDir, 'app-state.json'), JSON.stringify({
    version: 2,
    expandedProjectIds: { 'smoke-repo': true },
    workspacesByProjectId: { 'smoke-repo': staleWorkspace },
    pinnedCodexSessionsByProjectId: {},
    expandedRepoIds: { 'smoke-repo': true },
    workspacesByRepoId: { 'smoke-repo': staleWorkspace },
    pinnedCodexSessionIdsByRepoPath: {},
    pinnedCodexSessionsByRepoPath: {},
  }, null, 2))
  fs.writeFileSync(path.join(userDataDir, 'tasks.json'), JSON.stringify({
    version: 1,
    tasks: [{
      id: 'control-smoke-repo', projectId: 'smoke-repo', threadId: null,
      checkoutId: 'local-smoke-repo', worktreeId: null, role: 'control', location: 'local',
      state: 'local', baseRef: 'refs/heads/main', baseSha: null, environmentId: null,
      environmentRevision: null, pendingFirstTurn: null, createdAt: 1, updatedAt: 1, archivedAt: null,
    }],
    managedWorktrees: [], localLeaseByProjectId: {}, interruptedOperations: [],
  }, null, 2))
  const electronApp = await launchApp(userDataDir, { CRANBERRI_FAKE_CODEX: '1', GITHUB_TOKEN: '', GH_TOKEN: '' })
  try {
    await smokePage(electronApp, async (page) => {
      await page.getByText('Local · main', { exact: true }).waitFor({ timeout: 10_000 })
      await page.waitForFunction(async () => {
        const [appState, tasks] = await Promise.all([
          window.cranberri.appState.read(),
          window.cranberri.tasks.snapshot(),
        ])
        const repaired = appState.workspacesByProjectId['smoke-repo']?.windows.find((windowState) => windowState.id === 'legacy-local-window')
        return repaired?.taskId === null
          && repaired.title === 'New local session'
          && repaired.sessionTarget === 'local'
          && tasks.tasks.every((task) => task.role !== 'control')
      }, undefined, { timeout: 10_000 })
      await page.getByText('local-draft.txt', { exact: true }).waitFor({ timeout: 10_000 })
      if (await page.getByText('Changes could not be loaded', { exact: true }).count()) {
        throw new Error('Stale Local task binding still poisoned the right rail')
      }
      const repoName = path.basename(repoPath)
      const repo = page.locator('[data-repo-id="smoke-repo"]')
      await repo.hover()
      await repo.getByRole('button', { name: `New session in ${repoName}` }).click()
      await page.getByRole('menuitem', { name: /New Local session/ }).waitFor({ timeout: 10_000 })
      await page.getByRole('menuitem', { name: /New Worktree session/ }).waitFor({ timeout: 10_000 })
      await captureSmokeScreenshot(page, 'new-session-menu')
      await page.keyboard.press('Escape')
      const composer = page.getByRole('textbox', { name: 'Chat message' })
      await composer.fill('cranberri local promotion smoke')
      await page.getByLabel('Send message').click()
      await page.getByText('cranberri-fake-codex-stream-complete').last().waitFor({ timeout: 20_000 })
      const identity = await page.evaluate(async () => {
        const snapshot = await window.cranberri.tasks.snapshot()
        const task = snapshot.tasks.find((candidate) => candidate.location === 'local' && candidate.threadId)
        return task ? { taskId: task.id, threadId: task.threadId } : null
      })
      if (!identity?.threadId) throw new Error('Local session did not persist a task and thread identity')
      const restoredWindowId = `session-${identity.threadId}`
      await page.evaluate(async ({ taskId, restoredWindowId }) => {
        const state = await window.cranberri.appState.read()
        const workspace = state.workspacesByProjectId['smoke-repo']
        if (!workspace) throw new Error('Smoke workspace is unavailable')
        const activeWindow = workspace.windows.find((candidate) => candidate.id === workspace.activeWindowId)
        if (!activeWindow) throw new Error('Smoke chat window is unavailable')
        const restoredWindow = { ...activeWindow, id: restoredWindowId, taskId: `deleted-${taskId}` }
        await window.cranberri.appState.write({
          ...state,
          workspacesByProjectId: {
            ...state.workspacesByProjectId,
            'smoke-repo': { windows: [restoredWindow], activeWindowId: restoredWindowId },
          },
        })
      }, { taskId: identity.taskId, restoredWindowId })
      await page.reload()
      await page.getByText('cranberri-fake-codex-stream-complete').last().waitFor({ timeout: 20_000 })
      await page.waitForFunction(async (windowId) => {
        const state = await window.cranberri.appState.read()
        return state.workspacesByProjectId['smoke-repo']?.windows.find((candidate) => candidate.id === windowId)?.taskId === null
      }, restoredWindowId, { timeout: 10_000 })
      const localSessionRow = page.locator(`[data-session-id="${identity.threadId}"][data-session-location="local"]`)
      await localSessionRow.waitFor({ timeout: 10_000 })
      await localSessionRow.locator('button').first().click()
      await page.waitForFunction(async ({ windowId, taskId }) => {
        const state = await window.cranberri.appState.read()
        return state.workspacesByProjectId['smoke-repo']?.windows.find((candidate) => candidate.id === windowId)?.taskId === taskId
      }, { windowId: restoredWindowId, taskId: identity.taskId }, { timeout: 10_000 })
      await page.getByTitle('GitHub').click()
      const githubPanel = page.locator('[data-bottom-panel="github"]')
      await githubPanel.getByText('fraction12/Cranberri', { exact: true }).first().waitFor({ timeout: 10_000 })
      await page.getByRole('button', { name: 'Task actions' }).click()
      await page.getByRole('menuitem', { name: 'Continue in worktree' }).click()
      await page.waitForFunction(async ({ taskId, threadId }) => {
        const snapshot = await window.cranberri.tasks.snapshot()
        return snapshot.tasks.some((task) => task.id === taskId && task.threadId === threadId && task.location === 'worktree')
      }, identity, { timeout: 20_000 })
      try {
        await page.getByText('Worktree · from main', { exact: true }).waitFor({ timeout: 10_000 })
      } catch (error) {
        const diagnostics = await page.evaluate(async () => ({
          headers: [...document.querySelectorAll('header')].map((header) => header.textContent),
          tasks: await window.cranberri.tasks.snapshot(),
          appState: await window.cranberri.appState.read(),
        }))
        throw new Error(`${error instanceof Error ? error.message : String(error)}\nSession workspace diagnostics:\n${JSON.stringify(diagnostics, null, 2)}`, { cause: error })
      }
      const promotedStatus = await page.evaluate((taskId) => window.cranberri.tasks.status(taskId), identity.taskId)
      if (!promotedStatus.worktree || !fs.existsSync(path.join(promotedStatus.worktree.path, 'local-draft.txt'))) {
        throw new Error('Continue in worktree did not carry the dirty Local checkout')
      }
      fs.writeFileSync(path.join(promotedStatus.worktree.path, 'worktree-right-rail-proof.txt'), 'active worktree\n')
      await page.getByText('worktree-right-rail-proof.txt', { exact: true }).waitFor({ timeout: 10_000 })
      await page.waitForTimeout(250)
      if (await page.getByText(/Repo is not registered/).count()) {
        throw new Error('GitHub panel kept the registered-repo route after the session moved into a worktree')
      }
      await githubPanel.getByText('fraction12/Cranberri', { exact: true }).first().waitFor({ timeout: 10_000 })
      const worktreeGitHub = await page.evaluate(async (taskId) => ({
        summary: await window.cranberri.git.taskGithubSummary(taskId),
        branches: await window.cranberri.github.taskPanelData(taskId, 'branches'),
      }), identity.taskId)
      if (worktreeGitHub.summary.webUrl !== 'https://github.com/fraction12/Cranberri'
        || worktreeGitHub.branches.kind !== 'branches') {
        throw new Error(`Worktree GitHub route returned the wrong checkout data: ${JSON.stringify(worktreeGitHub)}`)
      }
      const expandSessions = repo.getByRole('button', { name: `Expand sessions for ${repoName}` })
      if (await expandSessions.count()) await expandSessions.click()
      const promotedRow = repo.locator(`[data-session-id="${identity.threadId}"][data-session-location="worktree"]`)
      await promotedRow.waitFor({ timeout: 10_000 })
      await waitForVisibleToastsToClear(page)
      await captureSmokeScreenshot(page, 'local-session-continued-in-worktree')

      await page.getByRole('button', { name: 'Task actions' }).click()
      await page.getByRole('menuitem', { name: 'Archive session' }).click()
      await page.waitForFunction(async (taskId) => (await window.cranberri.tasks.status(taskId)).task.state === 'archived', identity.taskId, { timeout: 10_000 })
      await page.waitForFunction(async (threadId) => {
        const state = await window.cranberri.appState.read()
        return Object.values(state.workspacesByProjectId)
          .every((workspace) => workspace.windows.every((windowState) => windowState.threadId !== threadId))
      }, identity.threadId, { timeout: 10_000 })
      const showArchived = repo.getByRole('button', { name: /Show archived/ })
      await showArchived.waitFor({ timeout: 10_000 })
      await showArchived.click()
      await promotedRow.waitFor({ timeout: 10_000 })
      await promotedRow.getByRole('button', { name: /worktree session/i }).click()
      await composer.waitFor({ state: 'visible' })
      await page.waitForFunction(() => {
        const input = document.querySelector('[aria-label="Chat message"]')
        return input instanceof HTMLElement && input.getAttribute('contenteditable') === 'false'
      }, undefined, { timeout: 10_000 })

      await page.getByRole('button', { name: 'Task actions' }).click()
      await page.getByRole('menuitem', { name: 'Restore session' }).click()
      await page.waitForFunction(async ({ taskId, threadId }) => {
        const task = (await window.cranberri.tasks.status(taskId)).task
        return task.state === 'active' && task.threadId === threadId
      }, identity, { timeout: 10_000 })
      await page.waitForFunction(() => {
        const input = document.querySelector('[aria-label="Chat message"]')
        return input instanceof HTMLElement && input.getAttribute('contenteditable') === 'true'
      }, undefined, { timeout: 10_000 })
      await promotedRow.waitFor({ timeout: 10_000 })

      await promotedRow.locator('button[aria-label^="Options for"]').click()
      await page.getByRole('menuitem', { name: 'Archive' }).click()
      await page.waitForFunction(async ({ taskId, threadId }) => {
        const [status, appState] = await Promise.all([
          window.cranberri.tasks.status(taskId),
          window.cranberri.appState.read(),
        ])
        const workspace = appState.workspacesByProjectId['smoke-repo']
        const sessionWindowId = `session-${threadId}`
        const sessionChatOpen = workspace?.windows.some((candidate) => candidate.type === 'chat'
          && (candidate.id === sessionWindowId || candidate.taskId === taskId))
        return status.task.state === 'archived' && !sessionChatOpen
      }, identity, { timeout: 10_000 })

      await repo.hover()
      await repo.getByRole('button', { name: `New session in ${repoName}` }).click()
      await page.getByRole('menuitem', { name: /New Local session/ }).click()
      const deleteComposer = page.getByRole('textbox', { name: 'Chat message' })
      await deleteComposer.fill('cranberri delete close smoke')
      await page.getByLabel('Send message').click()
      await page.getByText('Fake Codex received: cranberri delete close smoke').waitFor({ timeout: 20_000 })
      const deleteIdentity = await page.evaluate(async (archivedTaskId) => {
        const snapshot = await window.cranberri.tasks.snapshot()
        const task = snapshot.tasks
          .filter((candidate) => candidate.projectId === 'smoke-repo' && candidate.id !== archivedTaskId && candidate.threadId)
          .sort((left, right) => right.createdAt - left.createdAt)[0]
        if (!task?.threadId) throw new Error('Delete-close smoke session did not bind a thread')
        return { taskId: task.id, threadId: task.threadId }
      }, identity.taskId)
      const deleteRow = repo.locator(`[data-session-id="${deleteIdentity.threadId}"]`)
      await deleteRow.waitFor({ timeout: 10_000 })
      await deleteRow.locator('button[aria-label^="Options for"]').click()
      await page.getByRole('menuitem', { name: 'Delete' }).click()
      await page.getByRole('dialog', { name: 'Delete session' }).getByRole('button', { name: 'Delete' }).click()
      await page.waitForFunction(async ({ taskId, threadId }) => {
        const [snapshot, appState] = await Promise.all([
          window.cranberri.tasks.snapshot(),
          window.cranberri.appState.read(),
        ])
        const workspace = appState.workspacesByProjectId['smoke-repo']
        const sessionWindowId = `session-${threadId}`
        const sessionChatOpen = workspace?.windows.some((candidate) => candidate.type === 'chat'
          && (candidate.id === sessionWindowId || candidate.taskId === taskId))
        return !snapshot.tasks.some((candidate) => candidate.id === taskId) && !sessionChatOpen
      }, deleteIdentity, { timeout: 10_000 })
    })
  } finally {
    await closeElectronApp(electronApp)
    fs.rmSync(userDataDir, { recursive: true, force: true })
    fs.rmSync(fixtureRoot, { recursive: true, force: true })
  }
}

async function runPackagedHandoffUat(page, secondaryRepoPath) {
  smokeStep('packaged handoff UAT')
  const secondaryRepoName = path.basename(secondaryRepoPath)
  const secondaryRepo = page.locator('[data-repo-id="smoke-repo-secondary"]')
  await secondaryRepo.hover()
  await secondaryRepo.getByRole('button', { name: `New session in ${secondaryRepoName}` }).click()
  await page.getByRole('menuitem', { name: /New Local session/ }).click()
  await page.waitForFunction(async () => (await window.cranberri.repos.list()).activeRepoId === 'smoke-repo-secondary', undefined, { timeout: 10_000 })
  const composer = page.getByRole('textbox', { name: 'Chat message' })
  await composer.fill('cranberri packaged handoff uat')
  await page.getByLabel('Send message').click()
  await page.getByText('Fake Codex received: cranberri packaged handoff uat').waitFor({ timeout: 20_000 })
  await page.getByText('cranberri-fake-codex-stream-complete').last().waitFor({ timeout: 20_000 })
  await page.getByRole('button', { name: 'Task actions' }).click()
  await page.getByRole('menuitem', { name: 'Continue in worktree' }).click()
  await page.getByText('Worktree · from main', { exact: true }).waitFor({ timeout: 20_000 })
  const identity = await page.evaluate(async () => {
    const snapshot = await window.cranberri.tasks.snapshot()
    const task = snapshot.tasks.find((candidate) => candidate.projectId === 'smoke-repo-secondary'
      && candidate.location === 'worktree'
      && candidate.threadId)
    if (!task) throw new Error('Continued worktree task was not found')
    const worktree = snapshot.managedWorktrees.find((candidate) => candidate.id === task.worktreeId)
    if (!worktree) throw new Error('Continued worktree record was not found')
    return { taskId: task.id, worktreePath: worktree.path, proposedBranch: `codex/task-${task.id.slice(0, 8)}` }
  })

  await page.getByRole('button', { name: 'Task actions' }).click()
  await page.getByRole('menuitem', { name: 'Test in Local' }).click()
  const localDialog = page.getByRole('dialog', { name: 'Test branch in Local?' })
  const branchInput = localDialog.getByRole('textbox', { name: 'Branch' })
  await branchInput.waitFor({ timeout: 10_000 })
  if (await branchInput.inputValue() !== identity.proposedBranch) {
    throw new Error('Detached worktree did not propose a new task branch')
  }
  await localDialog.getByRole('button', { name: 'Continue' }).click()
  await page.getByText(`Local · ${identity.proposedBranch}`, { exact: true }).waitFor({ timeout: 20_000 })
  await page.waitForFunction(async ({ taskId, proposedBranch }) => {
    const status = await window.cranberri.tasks.status(taskId)
    const repos = await window.cranberri.repos.list()
    const project = repos.projects.find((candidate) => candidate.id === status.task.projectId)
    return status.task.location === 'local'
      && status.task.checkoutId === project?.localCheckoutId
      && status.worktree?.branch === proposedBranch
  }, identity, { timeout: 20_000 })

  await page.getByRole('button', { name: 'Task actions' }).click()
  await page.getByRole('menuitem', { name: 'Return to worktree' }).click()
  const worktreeDialog = page.getByRole('dialog', { name: 'Move branch to a worktree?' })
  await worktreeDialog.getByRole('textbox', { name: 'Branch' }).waitFor({ timeout: 10_000 })
  await worktreeDialog.getByRole('button', { name: 'Continue' }).click()
  await page.getByText(`Worktree · ${identity.proposedBranch}`, { exact: true }).waitFor({ timeout: 20_000 })
  await page.waitForFunction(async ({ taskId, worktreePath }) => {
    const status = await window.cranberri.tasks.status(taskId)
    return status.task.location === 'worktree' && status.worktree?.path === worktreePath
  }, identity, { timeout: 20_000 })
}

async function runRepoWorkspaceSmoke() {
  smokeStep('repo workspace setup')
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cranberri-smoke-repo-'))
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cranberri-smoke-fixture-'))
  const repoPath = createFixtureRepo(fixtureRoot)
  const secondaryRepoPath = createFixtureRepo(fixtureRoot, 'cranberri-secondary-repo', false)
  seedRegisteredRepo(userDataDir, repoPath, secondaryRepoPath)
  const browserUrl = pathToFileURL(path.join(repoPath, 'index.html')).toString()
  const electronApp = await launchApp(userDataDir, {
    CRANBERRI_FAKE_CODEX: '1',
    CRANBERRI_FAKE_PICK_FILES: path.join(repoPath, 'README.md'),
    GITHUB_TOKEN: '',
    GH_TOKEN: '',
  })

  try {
    await smokePage(electronApp, async (page) => {
      smokeStep('repo and chat basics')
      await page.getByText(repoPath).waitFor({ timeout: 10_000 })
      await page.getByText('Local · main', { exact: true }).waitFor({ timeout: 10_000 })
      if (handoffUatOnly) {
        await runPackagedHandoffUat(page, secondaryRepoPath)
        return
      }
      const primaryRepoName = path.basename(repoPath)
      const primaryRepo = page.locator('[data-repo-id="smoke-repo"]')
      await primaryRepo.hover()
      await primaryRepo.getByRole('button', { name: `Options for ${primaryRepoName}` }).click()
      await page.getByRole('menuitem', { name: /Pinned local branch/ }).hover()
      await page.getByRole('menuitem', { name: 'smoke/context', exact: true }).click()
      await page.waitForFunction(async () => (await window.cranberri.repos.list()).projects
        .find((project) => project.id === 'smoke-repo')?.pinnedLocalBranch === 'smoke/context', undefined, { timeout: 10_000 })
      await page.getByText('Local · smoke/context', { exact: true }).waitFor({ timeout: 10_000 })
      await primaryRepo.hover()
      await primaryRepo.getByRole('button', { name: `Options for ${primaryRepoName}` }).click()
      await page.getByRole('menuitem', { name: /Pinned local branch/ }).hover()
      await page.getByRole('menuitem', { name: /main.*Current/, exact: false }).click()
      await page.waitForFunction(async () => (await window.cranberri.repos.list()).projects
        .find((project) => project.id === 'smoke-repo')?.pinnedLocalBranch === 'main', undefined, { timeout: 10_000 })
      await page.getByText('Local · main', { exact: true }).waitFor({ timeout: 10_000 })
      await primaryRepo.hover()
      await primaryRepo.getByRole('button', { name: `New session in ${primaryRepoName}` }).click()
      await page.getByRole('menuitem', { name: /New Local session/ }).waitFor({ timeout: 10_000 })
      await captureSmokeScreenshot(page, 'new-session-menu')
      await page.getByRole('menuitem', { name: /New Worktree session/ }).click()
      await page.getByLabel('New worktree setup').waitFor({ timeout: 10_000 })
      await page.getByRole('button', { name: 'Close New local session' }).click()
      const branchSelector = page.getByRole('button', { name: 'Base branch: main' })
      const environmentSelector = page.getByRole('button', { name: 'Environment: No environment' })
      await branchSelector.waitFor({ timeout: 10_000 })
      await environmentSelector.waitFor({ timeout: 10_000 })
      const compactDropdowns = page.locator('[data-dropdown-trigger="compact"]:visible')
      const compactDropdownCount = await compactDropdowns.count()
      if (compactDropdownCount !== 4) throw new Error(`Expected four visible compact dropdowns, found ${compactDropdownCount}`)
      for (let index = 0; index < compactDropdownCount; index += 1) {
        await assertCompactDropdownGeometry(compactDropdowns.nth(index))
      }
      await branchSelector.click()
      await page.locator('[data-dropdown-menu="branch"]').waitFor({ timeout: 10_000 })
      await captureSmokeScreenshot(page, 'dropdown-branch-light-standard')
      await page.keyboard.press('Escape')
      await environmentSelector.click()
      await page.locator('[data-dropdown-menu="environment"]').waitFor({ timeout: 10_000 })
      await captureSmokeScreenshot(page, 'dropdown-environment-light-standard')
      await page.keyboard.press('Escape')
      const approvalSelector = page.getByRole('button', { name: /Approval policy:/ })
      await approvalSelector.click()
      await page.locator('[data-dropdown-menu="approval"]').waitFor({ timeout: 10_000 })
      await captureSmokeScreenshot(page, 'dropdown-approval-light-standard')
      await page.keyboard.press('Escape')
      const modelTrigger = page.getByRole('button', { name: 'Configure model, reasoning, and speed' })
      await modelTrigger.click()
      await page.locator('[data-model-selector-menu="root"]').waitFor({ timeout: 10_000 })
      await captureSmokeScreenshot(page, 'dropdown-model-trigger-light-standard')
      await page.keyboard.press('Escape')
      await page.getByLabel('Open settings').click()
      await page.getByRole('button', { name: 'Environments', exact: true }).click()
      const environmentProject = page.getByLabel('Environment project')
      const defaultEnvironment = page.getByLabel('Default environment')
      await environmentProject.waitFor({ timeout: 10_000 })
      await defaultEnvironment.waitFor({ timeout: 10_000 })
      await assertSelectControlGeometry(environmentProject, 'compact')
      await assertSelectControlGeometry(defaultEnvironment, 'compact')
      await captureSmokeScreenshot(page, 'settings-environments-selects-light-standard')
      if (dropdownUat) {
        await page.getByRole('button', { name: 'Appearance', exact: true }).click()
        await page.getByRole('group', { name: 'Theme' }).getByRole('button', { name: 'Dark' }).click()
        await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark')
        await page.getByRole('button', { name: 'General', exact: true }).click()
        for (const label of ['Default model', 'Default reasoning effort', 'Default speed', 'Default approval mode']) {
          await assertSelectControlGeometry(page.getByLabel(label), 'standard')
        }
        await captureSmokeScreenshot(page, 'settings-general-selects-dark-standard')
      }
      await page.getByLabel('Close settings').click()
      if (dropdownUat) {
        smokeStep('dropdown geometry assertions complete')
        return
      }
      await page.waitForFunction(() => {
        const composer = document.querySelector('[data-chat-composer="true"]')
        if (!(composer instanceof HTMLElement)) return false
        return !composer.querySelector('[aria-label^="Task location:"]')
          && !composer.querySelector('[aria-label^="Base branch:"]')
          && !composer.querySelector('[aria-label^="Environment:"]')
      })
      await captureSmokeScreenshot(page, 'new-worktree-session-header')
      await resizeMainWindow(electronApp, 900, 250, 800, 240)
      await page.waitForFunction(() => window.innerHeight < 320)
      const modelSelector = page.getByRole('button', { name: 'Configure model, reasoning, and speed' })
      await modelSelector.click()
      const modelMenu = page.locator('[data-model-selector-menu="root"]')
      await modelMenu.waitFor({ timeout: 10_000 })
      const menuMetrics = await modelMenu.evaluate((element) => ({
        clientHeight: element.clientHeight,
        overflowY: getComputedStyle(element).overflowY,
        scrollHeight: element.scrollHeight,
      }))
      if (menuMetrics.overflowY !== 'auto' || menuMetrics.scrollHeight - menuMetrics.clientHeight < 16) {
        throw new Error(`Model menu is not scrollable in a constrained window: ${JSON.stringify(menuMetrics)}`)
      }
      await modelMenu.hover()
      await page.mouse.wheel(0, 180)
      await page.waitForFunction(() => {
        const menu = document.querySelector('[data-model-selector-menu="root"]')
        return menu instanceof HTMLElement && menu.scrollTop > 0
      })
      await modelMenu.waitFor({ state: 'visible', timeout: 2_000 })
      await modelMenu.evaluate((element) => { element.scrollTop = 0 })
      await page.getByRole('menuitem', { name: /GPT-5\.5/ }).hover()
      const modelSubmenu = page.locator('[data-model-selector-submenu="model"]')
      await modelSubmenu.waitFor({ timeout: 10_000 })
      const submenuMetrics = await modelSubmenu.evaluate((element) => {
        return {
          clientHeight: element.clientHeight,
          overflowY: getComputedStyle(element).overflowY,
          scrollHeight: element.scrollHeight,
        }
      })
      if (submenuMetrics.overflowY !== 'auto' || submenuMetrics.scrollHeight - submenuMetrics.clientHeight < 16) {
        throw new Error(`Model submenu is not scrollable in a constrained window: ${JSON.stringify(submenuMetrics)}`)
      }
      const submenuBox = await modelSubmenu.boundingBox()
      if (!submenuBox) throw new Error('Model submenu did not expose a visible bounding box')
      const initialSubmenuScroll = await modelSubmenu.evaluate((element) => element.scrollTop)
      const maximumSubmenuScroll = submenuMetrics.scrollHeight - submenuMetrics.clientHeight
      const pointer = {
        x: submenuBox.x + Math.min(24, submenuBox.width / 2),
        y: submenuBox.y + Math.min(40, submenuBox.height / 2),
      }
      await page.mouse.move(
        pointer.x,
        pointer.y,
      )
      const wheelTarget = await page.evaluate(({ x, y }) => {
        const target = document.elementFromPoint(x, y)
        const submenu = document.querySelector('[data-model-selector-submenu="model"]')
        return {
          target: target instanceof HTMLElement ? target.outerHTML.slice(0, 240) : null,
          insideSubmenu: Boolean(target && submenu?.contains(target)),
        }
      }, pointer)
      await page.mouse.wheel(0, initialSubmenuScroll < maximumSubmenuScroll ? 240 : -240)
      await page.waitForTimeout(250)
      const finalSubmenuScroll = await page.evaluate(() => {
        const submenu = document.querySelector('[data-model-selector-submenu="model"]')
        return submenu instanceof HTMLElement ? submenu.scrollTop : null
      })
      if (finalSubmenuScroll === null || finalSubmenuScroll === initialSubmenuScroll) {
        throw new Error(`Model submenu did not move under wheel input: ${JSON.stringify({
          initialSubmenuScroll,
          maximumSubmenuScroll,
          finalSubmenuScroll,
          pointer,
          wheelTarget,
        })}`)
      }
      await modelSubmenu.waitFor({ state: 'visible', timeout: 2_000 })
      await modelSubmenu.evaluate((element) => { element.scrollTop = 0 })
      await captureSmokeScreenshot(page, 'model-selector')
      await page.keyboard.press('Escape')
      await page.keyboard.press('Escape')
      await page.waitForFunction(() => (
        document.querySelector('button[aria-label="Configure model, reasoning, and speed"]')?.getAttribute('aria-expanded') !== 'true'
      ))
      await modelSelector.click()
      await page.getByRole('menuitem', { name: /GPT-5\.5/ }).hover()
      await page.getByRole('menuitemradio', { name: /GPT-5\.6-Sol Most capable/ }).click()
      await page.waitForFunction(() => {
        const toolbar = document.querySelector('[data-composer-toolbar="true"]')
        const send = document.querySelector('button[aria-label="Send message"]')
        if (!(toolbar instanceof HTMLElement) || !(send instanceof HTMLElement)) return false
        const toolbarRect = toolbar.getBoundingClientRect()
        const sendRect = send.getBoundingClientRect()
        return toolbar.scrollWidth <= toolbar.clientWidth + 1
          && sendRect.left >= toolbarRect.left - 1
          && sendRect.right <= toolbarRect.right + 1
      }, undefined, { timeout: 10_000 })
      await resizeMainWindow(electronApp, 1400, 900, 900, 600)
      await page.waitForFunction(() => window.innerHeight > 700)
      await page.getByLabel('Add context').click()
      await page.getByText('Add to chat', { exact: true }).waitFor({ timeout: 10_000 })
      await captureSmokeScreenshot(page, 'dropdown-add-context-light-standard')
      await page.waitForTimeout(50)
      await page.keyboard.press('Escape')
      await page.getByText('Add to chat', { exact: true }).waitFor({ state: 'detached', timeout: 10_000 })
      await page.getByRole('button', { name: /Approval policy:/ }).click()
      const approvalMenuTitle = page.getByText('Approval policy', { exact: true }).last()
      await approvalMenuTitle.waitFor({ timeout: 10_000 })
      await captureSmokeScreenshot(page, 'dropdown-approval-light-standard')
      await page.waitForTimeout(50)
      await page.keyboard.press('Escape')
      await approvalMenuTitle.waitFor({ state: 'detached', timeout: 10_000 })
      await modelSelector.click()
      await page.getByRole('menuitemradio', { name: 'Ultra', exact: true }).click()
      await modelSelector.click()
      await page.getByRole('menuitem', { name: 'Speed', exact: true }).hover()
      await page.getByRole('menuitemradio', { name: /Fast 1\.5x speed/ }).click()
      await modelSelector.click()
      await page.getByRole('menuitem', { name: /GPT-5\.6-Sol/ }).hover()
      await captureSmokeScreenshot(page, 'model-selector-regular')
      await page.getByRole('menuitemradio', { name: /GPT-5\.4-Mini Efficient coding/ }).click()
      await page.waitForFunction(() => {
        const trigger = document.querySelector('button[aria-label="Configure model, reasoning, and speed"]')
        return trigger?.textContent?.includes('5.4-Mini')
          && trigger.textContent.includes('Medium')
          && trigger.textContent.includes('Standard')
      }, undefined, { timeout: 10_000 })
      await modelSelector.click()
      await page.getByRole('menuitem', { name: 'Speed', exact: true }).hover()
      if (await page.getByRole('menuitemradio', { name: /Fast 1\.5x speed/ }).count() !== 0) {
        throw new Error('GPT-5.4-Mini should not expose Fast mode')
      }
      await page.keyboard.press('Escape')
      await page.keyboard.press('Escape')
      const composer = page.getByRole('textbox', { name: 'Chat message' })
      await composer.click()
      await page.keyboard.type('/')
      const skillsMenu = page.getByRole('listbox', { name: 'Commands' })
      await skillsMenu.waitFor({ timeout: 10_000 })
      await captureSmokeScreenshot(page, 'dropdown-commands-light-standard')
      await composer.fill('')
      await composer.fill('this is a test $')
      const skillMentionsMenu = page.getByRole('listbox', { name: 'Skills' })
      await skillMentionsMenu.waitFor({ timeout: 10_000 })
      await scrollOpenSurface(page, skillMentionsMenu, 'skills-menu')
      const firstSkill = skillMentionsMenu.getByRole('option').first()
      await firstSkill.click()
      await page.keyboard.type('d')
      await page.waitForFunction(() => {
        const input = document.querySelector('[data-composer-input="true"]')
        const mention = input?.querySelector('[data-composer-mention="skill"]')
        return input instanceof HTMLElement
          && mention instanceof HTMLElement
          && (input.textContent ?? '').startsWith('this is a test ')
          && (input.textContent ?? '').endsWith(' d')
          && !document.querySelector('[data-chat-composer="true"] textarea')
      }, undefined, { timeout: 10_000 })
      const caretGeometry = await page.evaluate(() => {
        const input = document.querySelector('[data-composer-input="true"]')
        const mention = input?.querySelector('[data-composer-mention="skill"]')
        const selection = window.getSelection()
        if (!(input instanceof HTMLElement) || !(mention instanceof HTMLElement) || !selection?.rangeCount) return null
        const caret = selection.getRangeAt(0).getBoundingClientRect()
        const mentionRect = mention.getBoundingClientRect()
        return { caretLeft: caret.left, mentionRight: mentionRect.right }
      })
      if (!caretGeometry || caretGeometry.caretLeft < caretGeometry.mentionRight) {
        throw new Error(`Composer caret did not advance past the skill mention: ${JSON.stringify(caretGeometry)}`)
      }
      await captureSmokeScreenshot(page, 'composer-native-skill-caret')
      await composer.fill('$')
      await page.getByRole('listbox', { name: 'Skills' }).getByRole('option').first().click()
      await page.keyboard.press('Backspace')
      await page.keyboard.press('Backspace')
      if (await page.locator('[data-composer-mention="skill"]').count()) {
        throw new Error('Backspace did not remove the skill mention atomically')
      }
      await composer.fill('@')
      const pluginMentionsMenu = page.getByRole('listbox', { name: 'Plugins and context' })
      await pluginMentionsMenu.waitFor({ timeout: 10_000 })
      await pluginMentionsMenu.getByRole('option').first().click()
      await page.keyboard.type(' test')
      await page.locator('[data-composer-mention="plugin"]').waitFor({ timeout: 10_000 })
      await composer.fill('composition guard')
      const articleCountBeforeComposition = await page.locator('article').count()
      await composer.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', isComposing: true })
      await page.waitForTimeout(150)
      if ((await composer.textContent()) !== 'composition guard' || await page.locator('article').count() !== articleCountBeforeComposition) {
        throw new Error('IME composition Enter submitted the composer')
      }
      await composer.fill('')
      await page.getByLabel('Add context').click()
      await page.getByRole('menuitem', { name: /^Goal/ }).click()
      await page.getByTitle('Remove goal').waitFor({ timeout: 10_000 })
      await page.getByLabel('Add context').click()
      await page.getByRole('menuitem', { name: /^Plan mode/ }).click()
      await page.getByTitle('Turn off plan mode').waitFor({ timeout: 10_000 })
      if (await page.getByTitle('Remove goal').count()) {
        throw new Error('Plan mode did not replace Goal mode')
      }
      await page.getByLabel('Add context').click()
      await page.getByRole('menuitem', { name: /^Goal/ }).click()
      await page.getByTitle('Remove goal').waitFor({ timeout: 10_000 })
      if (await page.getByTitle('Turn off plan mode').count()) {
        throw new Error('Goal mode did not replace Plan mode')
      }
      await page.getByTitle('Remove goal').click()
      await page.locator('[data-chat-transcript-scroll="true"]').evaluate((element) => {
        element.scrollTop = element.scrollHeight
      })
      const compactComposerHeight = await page.locator('[data-chat-composer="true"]').evaluate((element) => (
        element.getBoundingClientRect().height
      ))
      await composer.fill(Array.from({ length: 40 }, (_, index) => `Long composer line ${index + 1}`).join('\n'))
      if (await page.getByText('Ask Codex to inspect, edit, or explain this repo.', { exact: true }).count() !== 0) {
        throw new Error('New-chat empty state remained visible behind a composer draft')
      }
      await page.waitForFunction(() => {
        const viewport = document.querySelector('[data-composer-viewport="true"]')
        if (!(viewport instanceof HTMLElement)) return false
        return viewport.clientHeight <= (window.innerHeight * 0.25) + 1
          && viewport.scrollHeight > viewport.clientHeight
          && getComputedStyle(viewport).overflowY === 'auto'
      }, undefined, { timeout: 10_000 })
      await page.locator('[data-composer-viewport="true"]').evaluate((viewport) => {
        viewport.scrollTop = viewport.scrollHeight
        viewport.dispatchEvent(new Event('scroll'))
      })
      await page.waitForFunction(() => {
        const viewport = document.querySelector('[data-composer-viewport="true"]')
        if (!(viewport instanceof HTMLElement)) return false
        return viewport.scrollTop > 0
      }, undefined, { timeout: 10_000 })
      await page.waitForFunction((initialHeight) => {
        const composerRoot = document.querySelector('[data-chat-composer="true"]')
        const transcriptEnd = document.querySelector('[data-chat-transcript-end="true"]')
        if (!(composerRoot instanceof HTMLElement) || !(transcriptEnd instanceof HTMLElement)) return false
        return composerRoot.getBoundingClientRect().height >= initialHeight + 80
          && transcriptEnd.getBoundingClientRect().bottom <= composerRoot.getBoundingClientRect().top
      }, compactComposerHeight, { timeout: 10_000 })
      await captureSmokeScreenshot(page, 'composer-long-message')
      await composer.fill('')
      await page.getByRole('button', { name: 'Usage remaining' }).click()
      await page.getByText('Usage remaining', { exact: true }).waitFor({ timeout: 10_000 })
      await captureSmokeScreenshot(page, 'expandable-usage-light-standard')
      await page.getByRole('button', { name: 'Usage remaining' }).click()
      await page.getByRole('button', { name: 'Cranberri health' }).click()
      await page.getByText('Cranberri health', { exact: true }).waitFor({ timeout: 10_000 })
      await page.waitForFunction(() => {
        const card = document.querySelector('[data-health-card="true"]')
        if (!(card instanceof HTMLElement)) return false
        const cardRect = card.getBoundingClientRect()
        const buttons = [...card.querySelectorAll('button')].filter((button) => (
          button.textContent?.trim() === 'Refresh' || button.textContent?.includes('Doctor')
        ))
        return buttons.length === 2 && buttons.every((button) => {
          const rect = button.getBoundingClientRect()
          return rect.top >= cardRect.top && rect.bottom <= cardRect.bottom && rect.bottom <= window.innerHeight
        })
      }, undefined, { timeout: 10_000 })
      await captureSmokeScreenshot(page, 'expandable-health-light-standard')
      await page.getByRole('button', { name: 'Cranberri health' }).click()
      await page.getByTitle('README.md').click()
      await page.getByText('cranberri-diff-smoke-ready').waitFor({ timeout: 20_000 }).catch(async (error) => {
        const rightRailText = await page.locator('.bg-app-surface').last().textContent().catch(() => '')
        throw new Error(`${error instanceof Error ? error.message : String(error)}\nRight rail text:\n${rightRailText}`)
      })
      await openCommandPalette(page)
      await page.getByPlaceholder('Run command or switch repo...').fill('git commit changes')
      const openCommitAction = page.locator('[cmdk-item]').filter({ hasText: 'Open commit dialog' }).first()
      await openCommitAction.waitFor({ timeout: 10_000 })
      if (await openCommitAction.getAttribute('aria-disabled') === 'true') {
        throw new Error(`Open commit dialog action was disabled: ${await openCommitAction.textContent()}`)
      }
      await openCommitAction.click()
      const commitDialog = page.getByRole('dialog', { name: 'Commit changes' })
      await commitDialog.waitFor({ timeout: 10_000 })
      await commitDialog.getByText('Stage and commit the current working tree.').waitFor()
      await captureSmokeScreenshot(page, 'commit-dialog-light')
      await page.getByRole('button', { name: 'Cancel' }).click()
      await openCommandPalette(page)
      await page.getByPlaceholder('Run command or switch repo...').fill('draft commit message')
      const draftCommitAction = page.locator('[cmdk-item]').filter({ hasText: 'Draft commit message' }).first()
      await draftCommitAction.waitFor({ timeout: 10_000 })
      if (await draftCommitAction.getAttribute('aria-disabled') === 'true') {
        throw new Error(`Draft commit message action was disabled: ${await draftCommitAction.textContent()}`)
      }
      await draftCommitAction.click()
      await page.waitForFunction(() => {
        return [...document.querySelectorAll('input')]
          .some((input) => input.value === 'chore(git): draft smoke commit')
      }, { timeout: 10_000 })
      await page.getByRole('button', { name: 'Cancel' }).click()
      await page.getByLabel('Send selected file context to chat').click()
      await page.waitForFunction(() => {
        return [...document.querySelectorAll('[data-composer-input="true"]')]
          .some((textarea) => (textarea.textContent ?? '').includes('Repo file context:') && (textarea.textContent ?? '').includes('cranberri-diff-smoke-ready'))
      }, { timeout: 10_000 })
      await page.getByLabel('Send message').click()
      await page.getByText('Fake Codex received: Repo file context:').waitFor({ timeout: 20_000 }).catch(async (error) => {
        const diagnostics = await page.evaluate(async () => ({
          tasks: await window.cranberri.tasks.snapshot().catch((reason) => ({ error: String(reason) })),
          composer: [...document.querySelectorAll('[data-composer-input="true"]')].map((item) => (item.textContent ?? '')),
          notifications: [...document.querySelectorAll('[data-sonner-toast]')].map((item) => item.textContent),
        }))
        throw new Error(`${error instanceof Error ? error.message : String(error)}\nWorktree send diagnostics:\n${JSON.stringify(diagnostics, null, 2)}`)
      })
      await page.getByRole('tab', { name: 'Files' }).click()

      await composer.fill('cranberri-model-settings-smoke')
      await page.getByLabel('Send message').click()
      await page.getByText('settings:gpt-5.4-mini|medium|standard').waitFor({ timeout: 20_000 }).catch(async (error) => {
        const diagnostics = await page.evaluate(async () => ({
          tasks: await window.cranberri.tasks.snapshot().catch((reason) => ({ error: String(reason) })),
          composer: [...document.querySelectorAll('[data-composer-input="true"]')].map((item) => (item.textContent ?? '')),
          notifications: [...document.querySelectorAll('[data-sonner-toast]')].map((item) => item.textContent),
          transcript: document.querySelector('[data-chat-transcript-end="true"]')?.parentElement?.textContent,
        }))
        throw new Error(`${error instanceof Error ? error.message : String(error)}\nTask follow-up diagnostics:\n${JSON.stringify(diagnostics, null, 2)}`)
      })

      await composer.waitFor({ timeout: 10_000 })
      await composer.fill('cranberri fake codex smoke')
      await page.getByLabel('Send message').click()
      await page.getByText('Fake Codex received: cranberri fake codex smoke').waitFor({ timeout: 10_000 })
      await page.getByText('cranberri-fake-codex-stream-complete').last().waitFor({ timeout: 10_000 })
      await captureSmokeScreenshot(page, 'chat-transcript-light')
      await composer.fill('cranberri-chat-trail-smoke')
      await page.getByLabel('Send message').click()
      const activeTurn = page.locator('[data-turn-activity]').last()
      await activeTurn.locator('button[aria-expanded="true"]').waitFor({ timeout: 10_000 })
      await activeTurn.getByText('Inspecting the chat turn lifecycle.').waitFor({ timeout: 10_000 })
      await activeTurn.getByText('rg cranberri-shell-private-sentinel', { exact: true }).waitFor({ timeout: 10_000 })
      await page.getByRole('textbox', { name: 'Chat message' }).fill('Focus only on the chat trail.')
      await page.getByRole('textbox', { name: 'Chat message' }).press('Enter')
      await activeTurn.getByText('Focus only on the chat trail.').waitFor({ timeout: 10_000 })
      await captureSmokeScreenshot(page, 'chat-turn-active-steering')
      await resizeMainWindow(electronApp, 900, 600, 900, 600)
      await page.waitForFunction(() => window.innerWidth < 1_000 && window.innerHeight < 700)
      await page.waitForTimeout(250)
      await captureSmokeScreenshot(page, 'chat-turn-active-steering-compact')
      await resizeMainWindow(electronApp, 1400, 900, 900, 600)
      await page.waitForFunction(() => window.innerWidth > 1_200 && window.innerHeight > 700)
      await activeTurn.getByText(/Worked for \d+s/).waitFor({ timeout: 10_000 })
      await activeTurn.locator('button[aria-expanded="false"]').waitFor({ timeout: 10_000 })
      await page.getByText('Fake Codex received: cranberri-chat-trail-smoke').waitFor({ timeout: 10_000 })
      await composer.fill('cranberri-smoke-reject-turn')
      await page.getByLabel('Send message').click()
      const transcript = page.locator('[data-chat-transcript-end="true"]').locator('..')
      await transcript.getByText('Error: Fake Codex rejected turn').waitFor({ timeout: 10_000 })
      await composer.fill('cranberri fake codex smoke')
      if (await page.getByLabel('Send message').isDisabled()) {
        throw new Error('Rejected Codex turn left the chat running')
      }
      await page.getByLabel('Send message').click()
      await page.getByText('Fake Codex received: cranberri fake codex smoke').last().waitFor({ timeout: 10_000 })
      await openCommandPalette(page)
      await page.getByPlaceholder('Run command or switch repo...').fill('copy latest prompt')
      await clickCommandItemByText(page, 'Copy latest prompt')
      await page.getByText('Copy latest prompt').waitFor({ timeout: 10_000 })
      await openCommandPalette(page)
      await page.getByPlaceholder('Run command or switch repo...').fill('send latest prompt to chat')
      await page.locator('[cmdk-item]').filter({ hasText: 'Send latest prompt to chat' }).first().click()
      await page.waitForFunction(() => {
        return [...document.querySelectorAll('[data-composer-input="true"]')]
          .some((textarea) => (textarea.textContent ?? '').includes('User prompt context:')
            && (textarea.textContent ?? '').includes('cranberri fake codex smoke'))
      }, { timeout: 10_000 })
      await page.getByLabel('Send message').click()
      await waitForAssistantArticleText(page, 'Fake Codex received: User prompt context:')
      await openCommandPalette(page)
      await page.getByPlaceholder('Run command or switch repo...').fill('send latest response to chat')
      await page.locator('[cmdk-item]').filter({ hasText: 'Send latest response to chat' }).first().click()
      await page.waitForFunction(() => {
        return [...document.querySelectorAll('[data-composer-input="true"]')]
          .some((textarea) => (textarea.textContent ?? '').includes('Assistant response context:')
            && (textarea.textContent ?? '').includes('cranberri fake codex smoke'))
      }, { timeout: 10_000 })
      await page.getByLabel('Send message').click()
      await waitForAssistantArticleText(page, 'Fake Codex received: Assistant response context:')
      await openCommandPalette(page)
      await page.getByPlaceholder('Run command or switch repo...').fill('copy latest response')
      await page.locator('[cmdk-item]').filter({ hasText: 'Copy latest response' }).first().click()
      await page.getByText('Copy latest response').waitFor({ timeout: 10_000 })
      await page.getByLabel('Send response to chat').last().click()
      await page.waitForFunction(() => {
        return [...document.querySelectorAll('[data-composer-input="true"]')]
          .some((textarea) => (textarea.textContent ?? '').includes('Assistant response context:')
            && (textarea.textContent ?? '').includes('cranberri fake codex smoke'))
      }, { timeout: 10_000 })
      await page.getByLabel('Send message').click()
      await waitForAssistantArticleText(page, 'Fake Codex received: Assistant response context:', 2)
      await openCommandPalette(page)
      await page.getByPlaceholder('Run command or switch repo...').fill('transcript cranberri fake codex smoke')
      const transcriptMessageAction = page.locator('[cmdk-item]').filter({ hasText: 'Send transcript message to chat:' }).first()
      await transcriptMessageAction.waitFor({ timeout: 10_000 })
      await transcriptMessageAction.click()
      await page.waitForFunction(() => {
        return [...document.querySelectorAll('[data-composer-input="true"]')]
          .some((textarea) => ((textarea.textContent ?? '').includes('Assistant response context:')
            || (textarea.textContent ?? '').includes('User prompt context:'))
            && (textarea.textContent ?? '').includes('cranberri fake codex smoke'))
      }, { timeout: 10_000 })
      const fakeResponseCountBeforeTranscriptSend = await page.locator('article').filter({ hasText: 'Fake Codex received:' }).count()
      await page.getByLabel('Send message').click()
      await page.waitForFunction(({ count }) => {
        return [...document.querySelectorAll('article')]
          .filter((article) => article.textContent?.includes('Fake Codex received:'))
          .length > count
      }, { count: fakeResponseCountBeforeTranscriptSend }, { timeout: 10_000 })
      await openCommandPalette(page)
      await page.getByPlaceholder('Run command or switch repo...').fill('export active chat transcript')
      const exportTranscriptAction = page.locator('[cmdk-item]').filter({ hasText: 'Export active chat transcript' }).first()
      await exportTranscriptAction.waitFor({ timeout: 10_000 })
      if (await exportTranscriptAction.getAttribute('aria-disabled') === 'true') {
        throw new Error(`Export transcript action was disabled: ${await exportTranscriptAction.textContent()}`)
      }
      await page.keyboard.press('Escape')
      await openCommandPalette(page)
      await page.getByPlaceholder('Run command or switch repo...').fill('copy active chat transcript')
      const copyTranscriptAction = page.locator('[cmdk-item]').filter({ hasText: 'Copy active chat transcript' }).first()
      await copyTranscriptAction.waitFor({ timeout: 10_000 })
      if (await copyTranscriptAction.getAttribute('aria-disabled') === 'true') {
        throw new Error(`Copy transcript action was disabled: ${await copyTranscriptAction.textContent()}`)
      }
      await copyTranscriptAction.click()
      await page.getByText('Copy active chat transcript').waitFor({ timeout: 10_000 })
      await composer.fill([
        'Mermaid smoke:',
        '',
        '```mermaid',
        'flowchart TD',
        '  A[Native parity] --> B[Cranberri]',
        '```',
      ].join('\n'))
      await page.getByLabel('Send message').click()
      await page.locator('[data-mermaid-diagram="true"]').last().waitFor({ timeout: 10_000 })
      await page.locator('[data-mermaid-diagram="true"] svg').last().waitFor({ timeout: 10_000 })
      await composer.fill([
        'Code copy smoke:',
        '',
        '```ts',
        'const cranberryCopySmoke = true',
        '```',
      ].join('\n'))
      await page.getByLabel('Send message').click()
      const codeCopyPreview = page.locator('[data-code-preview="true"]').filter({ hasText: 'cranberryCopySmoke' }).last()
      await codeCopyPreview.waitFor({ timeout: 10_000 })
      await codeCopyPreview.getByLabel('Copy code').click()
      await codeCopyPreview.getByText('Copied').waitFor({ timeout: 10_000 })
      await composer.fill([
        'Image smoke:',
        '',
        `![Cranberri smoke image](${path.join(repoPath, 'smoke-image.png')})`,
      ].join('\n'))
      await page.getByLabel('Send message').click()
      await page.locator('[data-markdown-media="image"] img[alt="Cranberri smoke image"]').last().waitFor({ timeout: 10_000 })
      await page.waitForFunction(() => {
        return [...document.querySelectorAll('[data-markdown-media="image"] img')]
          .some((image) => image instanceof HTMLImageElement
            && image.alt === 'Cranberri smoke image'
            && image.complete
            && image.naturalWidth > 0)
      }, { timeout: 10_000 })
      await page.locator('[data-markdown-media="image"]').last().getByLabel('Send image to chat').click()
      await page.waitForFunction(() => {
        return [...document.querySelectorAll('[data-composer-input="true"]')]
          .some((textarea) => (textarea.textContent ?? '').includes('Image from assistant markdown:') && (textarea.textContent ?? '').includes('smoke-image.png'))
      }, { timeout: 10_000 })
      await page.getByLabel('Send message').click()
      await page.waitForFunction(() => {
        return [...document.querySelectorAll('article')]
          .some((article) => article.textContent?.includes('Fake Codex received: Image from assistant markdown:')
            && article.textContent.includes('local-images:1'))
      }, { timeout: 10_000 })
      await composer.fill([
        'Remote image smoke:',
        '',
        '![Cranberri remote image](https://example.com/cranberri-remote-smoke.png)',
      ].join('\n'))
      await page.getByLabel('Send message').click()
      const remoteImagePreview = page.locator('[data-markdown-media="image"]').filter({ hasText: 'Cranberri remote image' }).last()
      await remoteImagePreview.waitFor({ timeout: 10_000 })
      await remoteImagePreview.getByLabel('Send image to chat').click()
      await page.waitForFunction(() => {
        return [...document.querySelectorAll('[data-composer-input="true"]')]
          .some((textarea) => (textarea.textContent ?? '').includes('Image from assistant markdown:') && (textarea.textContent ?? '').includes('Cranberri remote image'))
      }, { timeout: 10_000 })
      await page.getByLabel('Send message').click()
      await page.waitForFunction(() => {
        return [...document.querySelectorAll('article')]
          .some((article) => article.textContent?.includes('Fake Codex received: Image from assistant markdown:')
            && article.textContent.includes('Cranberri remote image')
            && article.textContent.includes('local-images:1'))
      }, { timeout: 10_000 })
      smokeStep('attachments and voice')
      await composer.click()
      await page.evaluate(() => {
        const textarea = document.querySelector('[data-composer-input="true"]')
        if (!(textarea instanceof HTMLElement)) throw new Error('Composer editor not found')
        const dataTransfer = new DataTransfer()
        dataTransfer.setData('text/plain', [
          'Please inspect this pasted image.',
          'https://example.com/cranberri-pasted-image.png',
        ].join('\n'))
        textarea.dispatchEvent(new ClipboardEvent('paste', {
          bubbles: true,
          cancelable: true,
          clipboardData: dataTransfer,
        }))
      })
      await page.waitForFunction(() => {
        return [...document.querySelectorAll('[data-composer-input="true"]')]
          .some((textarea) => (textarea.textContent ?? '').includes('Please inspect this pasted image.'))
      }, { timeout: 10_000 })
      await page.getByText('cranberri-pasted-image.png').waitFor({ timeout: 10_000 })
      await page.waitForFunction(() => {
        return [...document.querySelectorAll('[data-composer-attachments="context"] img')]
          .some((image) => image.getAttribute('src') === 'https://example.com/cranberri-pasted-image.png')
      }, { timeout: 10_000 })
      await page.getByLabel('Send message').click()
      await page.waitForFunction(() => {
        return [...document.querySelectorAll('article')]
          .some((article) => article.textContent?.includes('Fake Codex received: Please inspect this pasted image.')
            && article.textContent.includes('local-images:1'))
      }, { timeout: 10_000 })
      await composer.click()
      await page.evaluate((pastedPath) => {
        const textarea = document.querySelector('[data-composer-input="true"]')
        if (!(textarea instanceof HTMLElement)) throw new Error('Composer editor not found')
        const dataTransfer = new DataTransfer()
        dataTransfer.setData('text/plain', [
          'Please inspect this pasted local file.',
          pastedPath,
        ].join('\n'))
        textarea.dispatchEvent(new ClipboardEvent('paste', {
          bubbles: true,
          cancelable: true,
          clipboardData: dataTransfer,
        }))
      }, path.join(repoPath, 'README.md'))
      await page.waitForFunction(() => {
        return [...document.querySelectorAll('[data-composer-input="true"]')]
          .some((textarea) => (textarea.textContent ?? '').includes('Please inspect this pasted local file.'))
      }, { timeout: 10_000 })
      await page.getByLabel('Remove attached file README.md').waitFor({ timeout: 10_000 })
      await page.getByLabel('Send message').click()
      await page.waitForFunction((pastedPath) => {
        return [...document.querySelectorAll('article')]
          .some((article) => article.textContent?.includes('Fake Codex received: Attached local paths:')
            && article.textContent.includes(pastedPath))
      }, path.join(repoPath, 'README.md'), { timeout: 10_000 })
      await composer.click()
      await page.evaluate(() => {
        const textarea = document.querySelector('[data-composer-input="true"]')
        if (!(textarea instanceof HTMLElement)) throw new Error('Composer editor not found')
        const dataTransfer = new DataTransfer()
        dataTransfer.setData('text/plain', 'Please inspect this pasted screenshot.')
        dataTransfer.items.add(new File(['cranberri clipboard image smoke'], 'cranberri-clipboard-smoke.png', {
          type: 'image/png',
        }))
        textarea.dispatchEvent(new ClipboardEvent('paste', {
          bubbles: true,
          cancelable: true,
          clipboardData: dataTransfer,
        }))
      })
      await page.waitForFunction(() => {
        return [...document.querySelectorAll('[data-composer-input="true"]')]
          .some((textarea) => (textarea.textContent ?? '').includes('Please inspect this pasted screenshot.'))
      }, { timeout: 10_000 })
      await page.getByText('Inline image').waitFor({ timeout: 10_000 })
      await page.waitForFunction(() => {
        return [...document.querySelectorAll('[data-composer-attachments="context"] img')]
          .some((image) => image.getAttribute('src')?.startsWith('data:image/png;base64,'))
      }, { timeout: 10_000 })
      await page.getByLabel('Send message').click()
      await page.waitForFunction(() => {
        return [...document.querySelectorAll('article')]
          .some((article) => article.textContent?.includes('Fake Codex received: Please inspect this pasted screenshot.')
            && article.textContent.includes('local-images:1'))
      }, { timeout: 10_000 })
      await composer.click()
      await page.evaluate(() => {
        const textarea = document.querySelector('[data-composer-input="true"]')
        if (!(textarea instanceof HTMLElement)) throw new Error('Composer editor not found')
        const dataTransfer = new DataTransfer()
        dataTransfer.setData('text/plain', 'Please inspect this dropped screenshot.')
        dataTransfer.items.add(new File(['cranberri dropped image smoke'], 'cranberri-dropped-smoke.png', {
          type: 'image/png',
        }))
        textarea.dispatchEvent(new DragEvent('dragover', {
          bubbles: true,
          cancelable: true,
          dataTransfer,
        }))
        textarea.dispatchEvent(new DragEvent('drop', {
          bubbles: true,
          cancelable: true,
          dataTransfer,
        }))
      })
      await page.waitForFunction(() => {
        return [...document.querySelectorAll('[data-composer-input="true"]')]
          .some((textarea) => (textarea.textContent ?? '').includes('Please inspect this dropped screenshot.'))
      }, { timeout: 10_000 })
      await page.getByText('Inline image').waitFor({ timeout: 10_000 })
      await page.waitForFunction(() => {
        return [...document.querySelectorAll('[data-composer-attachments="context"] img')]
          .some((image) => image.getAttribute('src')?.startsWith('data:image/png;base64,'))
      }, { timeout: 10_000 })
      await page.getByLabel('Send message').click()
      await page.waitForFunction(() => {
        return [...document.querySelectorAll('article')]
          .some((article) => article.textContent?.includes('Fake Codex received: Please inspect this dropped screenshot.')
            && article.textContent.includes('local-images:1'))
      }, { timeout: 10_000 })
      await composer.click()
      await page.evaluate((droppedPath) => {
        const textarea = document.querySelector('[data-composer-input="true"]')
        if (!(textarea instanceof HTMLElement)) throw new Error('Composer editor not found')
        const dataTransfer = new DataTransfer()
        dataTransfer.setData('text/plain', 'Please inspect this dropped local file.')
        const file = new File(['cranberri dropped file smoke'], 'README.md', {
          type: 'text/markdown',
        })
        Object.defineProperty(file, 'path', { value: droppedPath })
        dataTransfer.items.add(file)
        textarea.dispatchEvent(new DragEvent('dragover', {
          bubbles: true,
          cancelable: true,
          dataTransfer,
        }))
        textarea.dispatchEvent(new DragEvent('drop', {
          bubbles: true,
          cancelable: true,
          dataTransfer,
        }))
      }, path.join(repoPath, 'README.md'))
      await page.waitForFunction(() => {
        return [...document.querySelectorAll('[data-composer-input="true"]')]
          .some((textarea) => (textarea.textContent ?? '').includes('Please inspect this dropped local file.'))
      }, { timeout: 10_000 })
      await page.getByLabel('Remove attached file README.md').waitFor({ timeout: 10_000 })
      await page.getByLabel('Send message').click()
      await page.waitForFunction((droppedPath) => {
        return [...document.querySelectorAll('article')]
          .some((article) => article.textContent?.includes('Fake Codex received: Attached local paths:')
            && article.textContent.includes(droppedPath))
      }, path.join(repoPath, 'README.md'), { timeout: 10_000 })
      await openCommandPalette(page)
      await page.getByPlaceholder('Run command or switch repo...').fill('attach files active chat')
      const attachFilesAction = page.locator('[cmdk-item]').filter({ hasText: 'Attach files to active chat' }).first()
      await attachFilesAction.waitFor({ timeout: 10_000 })
      if (await attachFilesAction.getAttribute('aria-disabled') === 'true') {
        throw new Error(`Attach files action was disabled: ${await attachFilesAction.textContent()}`)
      }
      await attachFilesAction.click()
      await page.getByLabel('Remove attached file README.md').waitFor({ timeout: 10_000 })
      await page.getByLabel('Send message').click()
      await page.waitForFunction((attachedPath) => {
        return [...document.querySelectorAll('article')]
          .some((article) => article.textContent?.includes('Fake Codex received: Attached local paths:')
            && article.textContent.includes(attachedPath))
      }, path.join(repoPath, 'README.md'), { timeout: 10_000 })
      await openCommandPalette(page)
      await page.getByPlaceholder('Run command or switch repo...').fill('README')
      const attachSearchedFileAction = page.locator('[cmdk-item]').filter({ hasText: 'Attach file to active chat: README.md' }).first()
      try {
        await attachSearchedFileAction.waitFor({ timeout: 10_000 })
      } catch (error) {
        const visibleItems = await page.locator('[cmdk-item]').allTextContents()
        const paletteText = await page.locator('[cmdk-list]').textContent()
        throw new Error(`Repo search action did not appear. Items: ${JSON.stringify(visibleItems)}. Palette: ${paletteText}`, { cause: error })
      }
      if (await attachSearchedFileAction.getAttribute('aria-disabled') === 'true') {
        throw new Error(`Attach searched file action was disabled: ${await attachSearchedFileAction.textContent()}`)
      }
      await attachSearchedFileAction.click()
      await page.getByLabel('Remove attached file README.md').waitFor({ timeout: 10_000 })
      await page.getByLabel('Send message').click()
      await page.waitForFunction((attachedPath) => {
        return [...document.querySelectorAll('article')]
          .some((article) => article.textContent?.includes('Fake Codex received: Attached local paths:')
            && article.textContent.includes(attachedPath))
      }, path.join(repoPath, 'README.md'), { timeout: 10_000 })
      await page.evaluate(() => {
        class FakeSpeechRecognition {
          continuous = false
          interimResults = false
          lang = ''
          onresult = null
          onerror = null
          onend = null

          start() {
            window.setTimeout(() => {
              this.onresult?.({
                resultIndex: 0,
                results: {
                  length: 1,
                  0: {
                    length: 1,
                    isFinal: true,
                    0: { transcript: 'cranberri dictated smoke text' },
                  },
                },
              })
              this.onend?.()
            }, 0)
          }

          stop() {
            this.onend?.()
          }

          abort() {
            this.onend?.()
          }
        }
        Object.defineProperty(window, 'SpeechRecognition', {
          configurable: true,
          value: FakeSpeechRecognition,
        })
        Object.defineProperty(window, 'webkitSpeechRecognition', {
          configurable: true,
          value: FakeSpeechRecognition,
        })
      })
      await page.getByLabel('Send message').waitFor({ timeout: 10_000 })
      await page.getByLabel('Start voice dictation').click()
      await page.waitForFunction(() => {
        return [...document.querySelectorAll('[data-composer-input="true"]')]
          .some((textarea) => (textarea.textContent ?? '').includes('cranberri dictated smoke text'))
      }, { timeout: 10_000 })
      await page.waitForTimeout(200)
      await page.waitForFunction(() => {
        const composer = [...document.querySelectorAll('[data-composer-input="true"]')]
          .find((textarea) => (textarea.textContent ?? '').includes('cranberri dictated smoke text'))
        const send = document.querySelector('button[aria-label="Send message"]')
        return Boolean(composer && send instanceof HTMLButtonElement && !send.disabled)
      }, { timeout: 10_000 })
      await page.getByLabel('Send message').click()
      await page.getByText('Fake Codex received: cranberri dictated smoke text').waitFor({ timeout: 10_000 }).catch(async (error) => {
        const diagnostics = await page.evaluate(async () => ({
          tasks: await window.cranberri.tasks.snapshot().catch((reason) => ({ error: String(reason) })),
          composer: [...document.querySelectorAll('[data-composer-input="true"]')].map((item) => ({
            text: item.textContent,
            placeholder: item.getAttribute('aria-placeholder'),
          })),
          primaryAction: document.querySelector('button[aria-label="Send message"], button[aria-label="Stop Codex"]')?.getAttribute('aria-label'),
          notifications: [...document.querySelectorAll('[data-sonner-toast]')].map((item) => item.textContent),
          transcript: document.querySelector('[data-chat-transcript-end="true"]')?.parentElement?.textContent,
        }))
        throw new Error(`${error instanceof Error ? error.message : String(error)}\nDictation send diagnostics:\n${JSON.stringify(diagnostics, null, 2)}`)
      })
      await page.waitForFunction(async () => {
        const result = await window.cranberri.telemetry.readEvents(80)
        return result.events.some((event) => {
          const payload = event.payload
          return event.type === 'codex:event'
            && payload
            && typeof payload === 'object'
            && payload.type === 'context_usage'
            && payload.usedTokens === 128
            && payload.contextWindow === 258400
        })
      }, { timeout: 10_000 })
      if (composerUatOnly) return
      await openCommandPalette(page)
      await page.getByPlaceholder('Run command or switch repo...').fill('active chat context')
      const activeChatContextAction = page.locator('[cmdk-item]').filter({ hasText: 'Send active chat context' }).first()
      await activeChatContextAction.waitFor({ timeout: 10_000 })
      if (await activeChatContextAction.getAttribute('aria-disabled') === 'true') {
        throw new Error(`Active chat context action was disabled: ${await activeChatContextAction.textContent()}`)
      }
      await activeChatContextAction.click()
      await page.waitForTimeout(500)
      const activeChatComposers = await page.locator('[data-composer-input="true"]').evaluateAll((nodes) => nodes.map((node) => node.textContent ?? ''))
      if (!activeChatComposers.some((value) => value.includes('Active chat context:') && value.includes('Smoke Codex Thread') && value.includes('128 / 258,400 tokens'))) {
        throw new Error(`Active chat context did not reach composer. Composers:\n${activeChatComposers.join('\n---\n')}`)
      }
      await page.getByLabel('Send message').click()
      await page.getByText('Fake Codex received: Active chat context:').waitFor({ timeout: 10_000 })
      await openCommandPalette(page)
      await page.getByPlaceholder('Run command or switch repo...').fill('fake codex smoke')
      await page.locator('[cmdk-item]').filter({ hasText: 'Send session match: Smoke Codex Thread' }).first().click()
      await page.waitForFunction(() => {
        return [...document.querySelectorAll('[data-composer-input="true"]')]
          .some((textarea) => (textarea.textContent ?? '').includes('Codex session context:') && (textarea.textContent ?? '').includes('cranberri fake codex smoke'))
      }, { timeout: 10_000 })
      await page.getByLabel('Send message').click()
      await page.getByText('Fake Codex received: Codex session context:').waitFor({ timeout: 10_000 })
      await page.getByText('cranberri-fake-codex-stream-complete').last().waitFor({ timeout: 10_000 })
      const sessionContextArticleCount = await page.locator('article').count()
      await openCommandPalette(page)
      await page.getByPlaceholder('Run command or switch repo...').fill('send latest session context')
      const sendLatestSessionAction = page.locator('[cmdk-item]').filter({ hasText: 'Send latest session context to chat' }).first()
      await sendLatestSessionAction.waitFor({ timeout: 10_000 })
      if (await sendLatestSessionAction.getAttribute('aria-disabled') === 'true') {
        throw new Error(`Send latest session context action was disabled: ${await sendLatestSessionAction.textContent()}`)
      }
      await sendLatestSessionAction.click()
      await page.waitForFunction(() => {
        return [...document.querySelectorAll('[data-composer-input="true"]')]
          .some((textarea) => (textarea.textContent ?? '').includes('Codex session context:') && (textarea.textContent ?? '').includes('cranberri fake codex smoke'))
      }, { timeout: 10_000 })
      await page.getByLabel('Send message').click()
      await page.getByText('Fake Codex received: Codex session context:').last().waitFor({ timeout: 10_000 })
      await page.waitForFunction((count) => document.querySelectorAll('article').length > count, sessionContextArticleCount, { timeout: 10_000 })
      await openCommandPalette(page)
      await page.getByPlaceholder('Run command or switch repo...').fill('copy latest session context')
      const copyLatestSessionAction = page.locator('[cmdk-item]').filter({ hasText: 'Copy latest session context' }).first()
      await copyLatestSessionAction.waitFor({ timeout: 10_000 })
      if (await copyLatestSessionAction.getAttribute('aria-disabled') === 'true') {
        throw new Error(`Copy latest session context action was disabled: ${await copyLatestSessionAction.textContent()}`)
      }
      await copyLatestSessionAction.click()
      const copiedSessionContext = await page.evaluate(() => navigator.clipboard.readText())
      if (!copiedSessionContext.includes('Codex session context:') || !copiedSessionContext.includes('cranberri fake codex smoke')) {
        throw new Error(`Latest session context clipboard was wrong:\n${copiedSessionContext}`)
      }
      await openCommandPalette(page)
      await page.getByPlaceholder('Run command or switch repo...').fill('compact active chat')
      const compactAction = page.locator('[cmdk-item]').filter({ hasText: 'Compact active chat' }).first()
      await compactAction.waitFor({ timeout: 10_000 })
      if (await compactAction.getAttribute('aria-disabled') === 'true') {
        throw new Error(`Compact active chat action was disabled: ${await compactAction.textContent()}`)
      }
      await compactAction.click()
      await page.waitForFunction(async () => {
        const result = await window.cranberri.telemetry.readEvents(80)
        return result.events.some((event) => {
          const payload = event.payload
          return event.type === 'codex:event'
            && payload
            && typeof payload === 'object'
            && payload.type === 'context_compaction'
            && payload.state === 'completed'
        })
      }, { timeout: 10_000 })

      smokeStep('first-class subagent workers')
      await composer.fill('cranberri-worker-smoke')
      await page.getByLabel('Send message').click()
      if (await page.locator('[data-worker-shelf="true"]').count() !== 0) {
        throw new Error('Agents should not render above the chat transcript')
      }
      await page.getByRole('tab', { name: /Agents/ }).click()
      await page.locator('[data-agents-panel="true"]').waitFor({ timeout: 10_000 })
      const workerRow = page.locator('[data-worker-id^="fake-worker-"]').first()
      await workerRow.waitFor({ timeout: 10_000 })
      await workerRow.getByText('Euclid', { exact: true }).waitFor({ timeout: 10_000 })
      await page.waitForFunction(() => {
        const worker = document.querySelector('[data-worker-id^="fake-worker-"]')
        return worker?.getAttribute('data-worker-status') === 'running'
      }, undefined, { timeout: 10_000 })
      await page.getByLabel('View Euclid').click()
      await page.getByLabel('Steer Euclid').click()
      await page.getByPlaceholder('Steer this agent...').fill('Focus on the renderer Agents rail.')
      await page.getByLabel('Send agent instruction').click()
      await workerRow.getByText(/Direction sent through parent|Steered:/).waitFor({ timeout: 10_000 })

      await page.getByLabel('Open Euclid').click()
      const workerTab = page.getByRole('tab', { name: 'Switch to Inspect worker smoke fixture' })
      await workerTab.waitFor({ timeout: 10_000 })
      await page.waitForFunction(() => document.querySelector('[role="tab"][aria-label="Switch to Inspect worker smoke fixture"]')?.getAttribute('aria-selected') === 'true')
      await page.getByRole('tab', { name: /Agents/ }).click()
      await page.getByLabel('Open parent task').waitFor({ timeout: 10_000 }).catch(async (error) => {
        const diagnostics = await page.evaluate(async () => ({
          workspace: await window.cranberri.appState.read().catch((reason) => ({ error: String(reason) })),
          tasks: await window.cranberri.tasks.snapshot().catch((reason) => ({ error: String(reason) })),
          tabs: [...document.querySelectorAll('[role="tab"]')].map((tab) => ({
            label: tab.getAttribute('aria-label'),
            selected: tab.getAttribute('aria-selected'),
          })),
          agentsPanel: document.querySelector('[data-agents-panel="true"]')?.textContent,
          notifications: [...document.querySelectorAll('[data-sonner-toast]')].map((item) => item.textContent),
        }))
        throw new Error(`${error instanceof Error ? error.message : String(error)}\nWorker open diagnostics:\n${JSON.stringify(diagnostics, null, 2)}`)
      })
      await page.getByText('Inspect the fake worker smoke fixture.').waitFor({ timeout: 10_000 })
      await page.getByRole('textbox', { name: 'Chat message' }).fill('Steer from the opened worker transcript.')
      await page.getByRole('button', { name: 'Send message' }).click()
      await page.getByText('Steer from the opened worker transcript.', { exact: true }).waitFor({ timeout: 10_000 })
      await page.getByLabel('Open parent task').click()
      const stopWorkerButton = page.locator('button[aria-label="Stop Euclid"]:visible')
      if (!await stopWorkerButton.isVisible().catch(() => false)) {
        await page.locator('button[aria-label="View Euclid"]:visible').click()
      }
      await stopWorkerButton.waitFor({ timeout: 10_000 })
      await stopWorkerButton.click()
      await page.waitForFunction(() => {
        const worker = document.querySelector('[data-worker-id^="fake-worker-"]')
        return worker?.getAttribute('data-worker-status') === 'interrupted'
      }, undefined, { timeout: 10_000 })
      await page.locator('button[aria-label="Resume Euclid"]:visible').click()
      await page.locator('input[placeholder="Resume with a new instruction..."]:visible').fill('Recheck the fixture after interruption.')
      await page.locator('button[aria-label="Send agent instruction"]:visible').click()
      await page.waitForFunction(() => {
        const worker = document.querySelector('[data-worker-id^="fake-worker-"]')
        return worker?.getAttribute('data-worker-status') === 'completed'
      }, undefined, { timeout: 10_000 })
      if (await page.locator('[data-session-worker-id]').count() !== 0) {
        throw new Error('Subagents should not appear in the repo rail')
      }
      if (await page.locator('button[aria-label^="Expand workers for"]').count() !== 0) {
        throw new Error('Repo sessions should not expose worker disclosure controls')
      }
      const restoredWorkerTree = await page.evaluate(async (projectId) => {
        const listed = await window.cranberri.tasks.history({ projectId, archived: false, limit: 20 })
        const parent = listed.sessions.find((session) => session.workers?.some((worker) => worker.nickname === 'Euclid'))
        if (!parent) return null
        const snapshot = await window.cranberri.tasks.snapshot()
        const task = snapshot.tasks.find((candidate) => candidate.threadId === parent.id)
        if (!task) return null
        const restored = await window.cranberri.tasks.read(task.id, false)
        return {
          parentId: parent.id,
          listedStatus: parent.workers?.[0]?.status,
          restoredStatus: restored.thread.workers?.[0]?.status,
          hasHistoricalSpawn: restored.thread.turns.some((turn) => turn.items?.some((item) => item.type === 'collabAgentToolCall')),
        }
      }, 'smoke-repo')
      if (!restoredWorkerTree
        || restoredWorkerTree.listedStatus !== 'completed'
        || restoredWorkerTree.restoredStatus !== 'completed'
        || !restoredWorkerTree.hasHistoricalSpawn) {
        throw new Error(`Worker tree did not restore correctly: ${JSON.stringify(restoredWorkerTree)}`)
      }
      if (await page.getByLabel('Switch to Inspect worker smoke fixture').count() !== 1) {
        throw new Error('Opening and returning from a worker created duplicate worker tabs')
      }
      await page.getByLabel('Close Inspect worker smoke fixture').click()
      await captureSmokeScreenshot(page, 'subagent-workers')

      smokeStep('approvals and tools')
      await composer.fill('cranberri-approval-smoke-request')
      await page.getByLabel('Send message').click()
      await page.getByText('Install fake smoke dependency').waitFor({ timeout: 10_000 })
      await openCommandPalette(page)
      await page.getByPlaceholder('Run command or switch repo...').fill('approve fake smoke dependency')
      await page.locator('[cmdk-item]').filter({ hasText: 'Approve pending Codex action' }).first().click()
      await page.getByText('Install fake smoke dependency').waitFor({ state: 'detached', timeout: 10_000 })
      await composer.fill('cranberri-approval-smoke-request')
      await page.getByLabel('Send message').click()
      await page.getByText('Install fake smoke dependency').waitFor({ timeout: 10_000 })
      await openCommandPalette(page)
      await page.getByPlaceholder('Run command or switch repo...').fill('deny fake smoke dependency')
      await page.locator('[cmdk-item]').filter({ hasText: 'Deny pending Codex action' }).first().click()
      await page.getByText('Install fake smoke dependency').waitFor({ state: 'detached', timeout: 10_000 })
      await page.getByTitle('Tools').click()
      await page.getByText('apply_patch', { exact: true }).first().waitFor({ timeout: 10_000 })
      const applyPatchToolRow = page.locator('article').filter({ hasText: 'apply_patch' }).first()
      await applyPatchToolRow.locator('button[aria-expanded]').click()
      await applyPatchToolRow.getByText('Recent use').waitFor({ timeout: 10_000 })
      await applyPatchToolRow.getByText(/Used successfully/).waitFor({ timeout: 10_000 })
      const visibleToolText = await applyPatchToolRow.textContent()
      if (!visibleToolText?.includes('apply_patch') || visibleToolText.includes('cranberri-approval-smoke-request')) {
        throw new Error(`Curated tool activity leaked or omitted data:\n${visibleToolText}`)
      }
      const execCommandToolRow = page.locator('article').filter({ hasText: 'exec_command' }).first()
      await execCommandToolRow.locator('button[aria-expanded]').click()
      await execCommandToolRow.getByText(/Used successfully/).waitFor({ timeout: 10_000 })
      const execCommandText = await execCommandToolRow.textContent()
      if (!execCommandText?.includes('exec_command') || execCommandText.includes('cranberri-shell-private-sentinel')) {
        throw new Error(`Shell activity attribution leaked or omitted data:\n${execCommandText}`)
      }
      const rgToolRow = page.locator('article').filter({ hasText: /^rg/ }).first()
      await rgToolRow.locator('button[aria-expanded]').click()
      if (await rgToolRow.getByText('Recent use').count()) {
        throw new Error('Shell command activity was incorrectly attributed to rg')
      }
      await captureSmokeScreenshot(page, 'tools-rail-light')
      const telemetryLeakedShellText = await page.evaluate(async () => {
        const result = await window.cranberri.telemetry.readEvents(200)
        return result.events.some((event) => JSON.stringify(event).includes('cranberri-shell-private-sentinel'))
      })
      if (telemetryLeakedShellText) throw new Error('Shell command text leaked into telemetry')

      smokeStep('right rail reader')
      await openCommandPalette(page)
      await page.getByPlaceholder('Run command or switch repo...').fill('cranberri-electron-smoke-search')
      await page.locator('[cmdk-item]').filter({ hasText: 'README.md:3' }).first().click()
      const focusedCodeEditor = page.locator('[data-code-editor="true"][data-focus-line="3"]')
      await focusedCodeEditor.waitFor({ timeout: 10_000 })
      await page.waitForFunction(() => {
        return document.querySelector('[data-code-editor="true"][data-focus-line="3"]')
          ?.textContent
          ?.includes('Search marker: cranberri-electron-smoke-search.')
      }, { timeout: 10_000 })
      await captureSmokeScreenshot(page, 'diff-reader-light')
      await page.getByLabel('File options').click()
      await page.getByRole('menuitemcheckbox', { name: 'Wrap content' }).waitFor({ timeout: 10_000 })
      await captureSmokeScreenshot(page, 'dropdown-diff-options-light-standard')
      await page.getByLabel('Copy selected file absolute path').click()
      await page.waitForFunction(async (expectedPath) => {
        return await navigator.clipboard.readText() === expectedPath
      }, path.join(repoPath, 'README.md'), { timeout: 10_000 })
      await page.getByLabel('File options').click()
      if (await page.getByLabel('Open selected file').getAttribute('data-disabled') !== null) {
        throw new Error('Right-rail open selected file button was disabled')
      }
      if (await page.getByLabel('Reveal selected file in Finder').getAttribute('data-disabled') !== null) {
        throw new Error('Right-rail reveal selected file button was disabled')
      }
      await page.keyboard.press('Escape')
      await page.getByLabel('Search selected file').click()
      await page.locator('.cm-panel.cm-search input').first().waitFor({ timeout: 10_000 })
      await page.keyboard.press('Escape')
      await submitGoToLine(
        page,
        () => page.locator('button[aria-label="Go to line in selected file"]').click(),
        '1',
      )
      await page.locator('[data-code-editor="true"][data-focus-line="1"]').waitFor({ timeout: 10_000 })
      await openCommandPalette(page)
      await page.getByPlaceholder('Run command or switch repo...').fill('search selected file')
      const searchSelectedFileAction = page.locator('[cmdk-item]').filter({ hasText: 'Search selected file' }).first()
      await searchSelectedFileAction.waitFor({ timeout: 10_000 })
      if (await searchSelectedFileAction.getAttribute('aria-disabled') === 'true') {
        throw new Error(`Search selected file action was disabled: ${await searchSelectedFileAction.textContent()}`)
      }
      await searchSelectedFileAction.click()
      await page.locator('.cm-panel.cm-search input').first().waitFor({ timeout: 10_000 })
      await page.keyboard.press('Escape')
      await openCommandPalette(page)
      await page.getByPlaceholder('Run command or switch repo...').fill('go to line selected file')
      const goToLineAction = page.locator('[cmdk-item]').filter({ hasText: 'Go to line in selected file' }).first()
      await goToLineAction.waitFor({ timeout: 10_000 })
      if (await goToLineAction.getAttribute('aria-disabled') === 'true') {
        throw new Error(`Go to line selected file action was disabled: ${await goToLineAction.textContent()}`)
      }
      await submitGoToLine(page, () => goToLineAction.click(), '5')
      await page.locator('[data-code-editor="true"][data-focus-line="5"]').waitFor({ timeout: 10_000 })
      smokeStep('right rail file context actions')
      await openCommandPalette(page)
      await page.getByPlaceholder('Run command or switch repo...').fill('send selected file context')
      const sendSelectedFileAction = page.locator('[cmdk-item]').filter({ hasText: 'Send selected file context' }).first()
      await sendSelectedFileAction.waitFor({ timeout: 10_000 })
      if (await sendSelectedFileAction.getAttribute('aria-disabled') === 'true') {
        throw new Error(`Send selected file context action was disabled: ${await sendSelectedFileAction.textContent()}`)
      }
      await sendSelectedFileAction.click()
      await page.waitForFunction(() => {
        return [...document.querySelectorAll('[data-composer-input="true"]')]
          .some((textarea) => (textarea.textContent ?? '').includes('Repo file context:') && (textarea.textContent ?? '').includes('Search marker: cranberri-electron-smoke-search.'))
      }, { timeout: 10_000 })
      await page.getByLabel('Send message').click()
      await page.getByText('Fake Codex received: Repo file context:').last().waitFor({ timeout: 10_000 })
      smokeStep('repo context actions')
      smokeStep('repo status context')
      await openCommandPalette(page)
      await page.getByPlaceholder('Run command or switch repo...').fill('send latest repo file context')
      const sendLatestRepoFileAction = page.locator('[cmdk-item]').filter({ hasText: 'Send latest repo file context to chat' }).first()
      await sendLatestRepoFileAction.waitFor({ timeout: 10_000 })
      if (await sendLatestRepoFileAction.getAttribute('aria-disabled') === 'true') {
        throw new Error(`Send latest repo file context action was disabled: ${await sendLatestRepoFileAction.textContent()}`)
      }
      await sendLatestRepoFileAction.click()
      await page.waitForFunction(() => {
        return [...document.querySelectorAll('[data-composer-input="true"]')]
          .some((textarea) => (textarea.textContent ?? '').includes('Repo file context:') && (textarea.textContent ?? '').includes('Search marker: cranberri-electron-smoke-search.'))
      }, { timeout: 10_000 })
      const repoFileContextCountBefore = await page.locator('article').filter({ hasText: 'Fake Codex received: Repo file context:' }).count()
      await page.getByLabel('Send message').click()
      await page.waitForFunction((countBefore) => {
        return [...document.querySelectorAll('article')]
          .filter((article) => article.textContent?.includes('Fake Codex received: Repo file context:')).length >= countBefore + 1
      }, repoFileContextCountBefore, { timeout: 10_000 })
      await openCommandPalette(page)
      await page.getByPlaceholder('Run command or switch repo...').fill('copy latest repo file context')
      const copyLatestRepoFileAction = page.locator('[cmdk-item]').filter({ hasText: 'Copy latest repo file context' }).first()
      await copyLatestRepoFileAction.waitFor({ timeout: 10_000 })
      if (await copyLatestRepoFileAction.getAttribute('aria-disabled') === 'true') {
        throw new Error(`Copy latest repo file context action was disabled: ${await copyLatestRepoFileAction.textContent()}`)
      }
      await copyLatestRepoFileAction.click()
      await page.waitForFunction(async () => {
        const text = await navigator.clipboard.readText()
        return text.includes('Repo file context:') && text.includes('Search marker: cranberri-electron-smoke-search.')
      }, { timeout: 10_000 })
      await openCommandPalette(page)
      await page.getByPlaceholder('Run command or switch repo...').fill('attach selected file active chat')
      const attachSelectedFileAction = page.locator('[cmdk-item]').filter({ hasText: 'Attach selected file to active chat' }).first()
      await attachSelectedFileAction.waitFor({ timeout: 10_000 })
      if (await attachSelectedFileAction.getAttribute('aria-disabled') === 'true') {
        throw new Error(`Attach selected file action was disabled: ${await attachSelectedFileAction.textContent()}`)
      }
      await attachSelectedFileAction.click()
      await page.getByLabel('Remove attached file README.md').waitFor({ timeout: 10_000 })
      await page.getByLabel('Send message').click()
      await page.waitForFunction((attachedPath) => {
        return [...document.querySelectorAll('article')]
          .some((article) => article.textContent?.includes('Fake Codex received: Attached local paths:')
            && article.textContent.includes(attachedPath))
      }, path.join(repoPath, 'README.md'), { timeout: 10_000 })
      await openCommandPalette(page)
      await page.getByPlaceholder('Run command or switch repo...').fill('copy selected file content')
      const copySelectedFileContentAction = page.locator('[cmdk-item]').filter({ hasText: 'Copy selected file content' }).first()
      await copySelectedFileContentAction.waitFor({ timeout: 10_000 })
      if (await copySelectedFileContentAction.getAttribute('aria-disabled') === 'true') {
        throw new Error(`Copy selected file content action was disabled: ${await copySelectedFileContentAction.textContent()}`)
      }
      await copySelectedFileContentAction.click()
      await page.getByText('File contents copied').waitFor({ timeout: 10_000 })
      await openCommandPalette(page)
      await page.getByPlaceholder('Run command or switch repo...').fill('copy selected file absolute path')
      const copySelectedFileAbsolutePathAction = page.locator('[cmdk-item]').filter({ hasText: 'Copy selected file absolute path' }).first()
      await copySelectedFileAbsolutePathAction.waitFor({ timeout: 10_000 })
      if (await copySelectedFileAbsolutePathAction.getAttribute('aria-disabled') === 'true') {
        throw new Error(`Copy selected file absolute path action was disabled: ${await copySelectedFileAbsolutePathAction.textContent()}`)
      }
      await copySelectedFileAbsolutePathAction.click()
      await page.getByText('Absolute path copied').waitFor({ timeout: 10_000 })
      await page.waitForFunction(async (expectedPath) => {
        return await navigator.clipboard.readText() === expectedPath
      }, path.join(repoPath, 'README.md'), { timeout: 10_000 })
      await openCommandPalette(page)
      await page.getByPlaceholder('Run command or switch repo...').fill('open selected file')
      const openSelectedFileAction = page.locator('[cmdk-item]').filter({ hasText: 'Open selected file' }).first()
      await openSelectedFileAction.waitFor({ timeout: 10_000 })
      if (await openSelectedFileAction.getAttribute('aria-disabled') === 'true') {
        throw new Error(`Open selected file action was disabled: ${await openSelectedFileAction.textContent()}`)
      }
      await page.keyboard.press('Escape')
      await openCommandPalette(page)
      await page.getByPlaceholder('Run command or switch repo...').fill('reveal selected file finder')
      const revealSelectedFileAction = page.locator('[cmdk-item]').filter({ hasText: 'Reveal selected file in Finder' }).first()
      await revealSelectedFileAction.waitFor({ timeout: 10_000 })
      if (await revealSelectedFileAction.getAttribute('aria-disabled') === 'true') {
        throw new Error(`Reveal selected file action was disabled: ${await revealSelectedFileAction.textContent()}`)
      }
      await page.keyboard.press('Escape')
      await openCommandPalette(page)
      await page.getByPlaceholder('Run command or switch repo...').fill('README')
      await page.locator('[cmdk-item]').filter({ hasText: 'README.md' }).first().waitFor({ timeout: 10_000 })
      await page.locator('[cmdk-item]').filter({ hasText: 'Send file context: README.md' }).first().click()
      await page.waitForFunction(() => {
        return [...document.querySelectorAll('[data-composer-input="true"]')]
          .some((textarea) => (textarea.textContent ?? '').includes('Repo file context:') && (textarea.textContent ?? '').includes('Search marker: cranberri-electron-smoke-search.'))
      }, { timeout: 10_000 })
      await page.getByLabel('Send message').click()
      await page.getByText('Fake Codex received: Repo file context:').last().waitFor({ timeout: 10_000 })
      await openCommandPalette(page)
      await page.getByPlaceholder('Run command or switch repo...').fill('git status context')
      await page.locator('[cmdk-item]').filter({ hasText: 'Send git status context' }).first().click()
      await page.waitForFunction(() => {
        return [...document.querySelectorAll('[data-composer-input="true"]')]
          .some((textarea) => (textarea.textContent ?? '').includes('Repo status context:') && (textarea.textContent ?? '').includes('- modified: README.md'))
      }, { timeout: 10_000 })
      await page.getByLabel('Send message').click()
      await page.getByText('Fake Codex received: Repo status context:').waitFor({ timeout: 10_000 })
      smokeStep('repo diff context')
      await openCommandPalette(page)
      await page.getByPlaceholder('Run command or switch repo...').fill('repo diff context')
      await page.locator('[cmdk-item]').filter({ hasText: 'Send repo diff context' }).first().click()
      await page.waitForFunction(() => {
        return [...document.querySelectorAll('[data-composer-input="true"]')]
          .some((textarea) => (textarea.textContent ?? '').includes('Repo diff context:') && (textarea.textContent ?? '').includes('cranberri-diff-smoke-ready'))
      }, { timeout: 10_000 })
      await page.getByLabel('Send message').click()
      await page.getByText('Fake Codex received: Repo diff context:').waitFor({ timeout: 10_000 })
      smokeStep('repo changes review prompt')
      await openCommandPalette(page)
      await page.getByPlaceholder('Run command or switch repo...').fill('review repo changes')
      const reviewRepoChangesAction = page.locator('[cmdk-item]').filter({ hasText: 'Review repo changes' }).first()
      await reviewRepoChangesAction.waitFor({ timeout: 10_000 })
      if (await reviewRepoChangesAction.getAttribute('aria-disabled') === 'true') {
        throw new Error(`Review repo changes action was disabled: ${await reviewRepoChangesAction.textContent()}`)
      }
      await reviewRepoChangesAction.click()
      await page.waitForFunction(() => {
        return [...document.querySelectorAll('[data-composer-input="true"]')]
          .some((textarea) => (textarea.textContent ?? '').includes('Review these repo changes.')
            && (textarea.textContent ?? '').includes('Prioritize correctness bugs')
            && (textarea.textContent ?? '').includes('cranberri-diff-smoke-ready'))
      }, { timeout: 10_000 })
      await page.getByLabel('Send message').click()
      await page.getByText('Fake Codex received: Review these repo changes.').waitFor({ timeout: 10_000 })
      smokeStep('repo changes explanation prompt')
      await openCommandPalette(page)
      await page.getByPlaceholder('Run command or switch repo...').fill('explain repo changes')
      const explainRepoChangesAction = page.locator('[cmdk-item]').filter({ hasText: 'Explain repo changes' }).first()
      await explainRepoChangesAction.waitFor({ timeout: 10_000 })
      if (await explainRepoChangesAction.getAttribute('aria-disabled') === 'true') {
        throw new Error(`Explain repo changes action was disabled: ${await explainRepoChangesAction.textContent()}`)
      }
      await explainRepoChangesAction.click()
      await page.waitForFunction(() => {
        return [...document.querySelectorAll('[data-composer-input="true"]')]
          .some((textarea) => (textarea.textContent ?? '').includes('Explain these repo changes.')
            && (textarea.textContent ?? '').includes('Summarize what changed, why it likely matters')
            && (textarea.textContent ?? '').includes('cranberri-diff-smoke-ready'))
      }, { timeout: 10_000 })
      await page.getByLabel('Send message').click()
      await page.getByText('Fake Codex received: Explain these repo changes.').waitFor({ timeout: 10_000 })
      smokeStep('repo changes test prompt')
      await openCommandPalette(page)
      await page.getByPlaceholder('Run command or switch repo...').fill('write tests for repo changes')
      const testRepoChangesAction = page.locator('[cmdk-item]').filter({ hasText: 'Write tests for repo changes' }).first()
      await testRepoChangesAction.waitFor({ timeout: 10_000 })
      if (await testRepoChangesAction.getAttribute('aria-disabled') === 'true') {
        throw new Error(`Write tests for repo changes action was disabled: ${await testRepoChangesAction.textContent()}`)
      }
      await testRepoChangesAction.click()
      await page.waitForFunction(() => {
        return [...document.querySelectorAll('[data-composer-input="true"]')]
          .some((textarea) => (textarea.textContent ?? '').includes('Write or update tests for these repo changes.')
            && (textarea.textContent ?? '').includes('Start by identifying the behavior changed by the diff')
            && (textarea.textContent ?? '').includes('cranberri-diff-smoke-ready'))
      }, { timeout: 10_000 })
      await page.getByLabel('Send message').click()
      await page.getByText('Fake Codex received: Write or update tests for these repo changes.').waitFor({ timeout: 10_000 })
      smokeStep('repo changes PR description prompt')
      await openCommandPalette(page)
      await page.getByPlaceholder('Run command or switch repo...').fill('draft pr description')
      const draftPrAction = page.locator('[cmdk-item]').filter({ hasText: 'Draft PR description from repo changes' }).first()
      await draftPrAction.waitFor({ timeout: 10_000 })
      if (await draftPrAction.getAttribute('aria-disabled') === 'true') {
        throw new Error(`Draft PR description action was disabled: ${await draftPrAction.textContent()}`)
      }
      await draftPrAction.click()
      await page.waitForFunction(() => {
        return [...document.querySelectorAll('[data-composer-input="true"]')]
          .some((textarea) => (textarea.textContent ?? '').includes('Draft a pull request description for these repo changes.')
            && (textarea.textContent ?? '').includes('Include Summary, Testing, and Risks sections')
            && (textarea.textContent ?? '').includes('cranberri-diff-smoke-ready'))
      }, { timeout: 10_000 })
      await page.getByLabel('Send message').click()
      await page.getByText('Fake Codex received: Draft a pull request description for these repo changes.').waitFor({ timeout: 10_000 })
      await openCommandPalette(page)
      await page.getByPlaceholder('Run command or switch repo...').fill('send latest repo changes context')
      const sendLatestRepoChangesAction = page.locator('[cmdk-item]').filter({ hasText: 'Send latest repo changes context to chat' }).first()
      await sendLatestRepoChangesAction.waitFor({ timeout: 10_000 })
      if (await sendLatestRepoChangesAction.getAttribute('aria-disabled') === 'true') {
        throw new Error(`Send latest repo changes context action was disabled: ${await sendLatestRepoChangesAction.textContent()}`)
      }
      await sendLatestRepoChangesAction.click()
      await page.waitForFunction(() => {
        return [...document.querySelectorAll('[data-composer-input="true"]')]
          .some((textarea) => (textarea.textContent ?? '').includes('Repo diff context:') && (textarea.textContent ?? '').includes('cranberri-diff-smoke-ready'))
      }, { timeout: 10_000 })
      await page.getByLabel('Send message').click()
      await page.waitForFunction(() => {
        return [...document.querySelectorAll('article')]
          .filter((article) => article.textContent?.includes('Fake Codex received: Repo diff context:')).length >= 2
      }, { timeout: 10_000 })
      smokeStep('copy latest repo changes context')
      await openCommandPalette(page)
      await page.getByPlaceholder('Run command or switch repo...').fill('copy latest repo changes context')
      const copyLatestRepoChangesAction = page.locator('[cmdk-item]').filter({ hasText: 'Copy latest repo changes context' }).first()
      await copyLatestRepoChangesAction.waitFor({ timeout: 10_000 })
      if (await copyLatestRepoChangesAction.getAttribute('aria-disabled') === 'true') {
        throw new Error(`Copy latest repo changes context action was disabled: ${await copyLatestRepoChangesAction.textContent()}`)
      }
      await copyLatestRepoChangesAction.click()
      await page.waitForFunction(async () => {
        const text = await navigator.clipboard.readText()
        return text.includes('Repo diff context:') && text.includes('cranberri-diff-smoke-ready')
      }, { timeout: 10_000 })
      smokeStep('github context actions')
      await openCommandPalette(page)
      await page.getByPlaceholder('Run command or switch repo...').fill('copy repo diff context')
      const copyRepoDiffAction = page.locator('[cmdk-item]').filter({ hasText: 'Copy repo diff context' }).first()
      await copyRepoDiffAction.waitFor({ timeout: 10_000 })
      if (await copyRepoDiffAction.getAttribute('aria-disabled') === 'true') {
        throw new Error(`Copy repo diff context action was disabled: ${await copyRepoDiffAction.textContent()}`)
      }
      await copyRepoDiffAction.click()
      await page.waitForFunction(async () => {
        const text = await navigator.clipboard.readText()
        return text.includes('Repo diff context:') && text.includes('cranberri-diff-smoke-ready')
      }, { timeout: 10_000 })
      smokeStep('copy repo diff context')
      await openCommandPalette(page)
      await page.getByPlaceholder('Run command or switch repo...').fill('github repo context')
      await page.locator('[cmdk-item]').filter({ hasText: 'Send GitHub repo context' }).first().click()
      await page.waitForFunction(() => {
        return [...document.querySelectorAll('[data-composer-input="true"]')]
          .some((textarea) => (textarea.textContent ?? '').includes('GitHub context:') && (textarea.textContent ?? '').includes('fraction12/Cranberri'))
      }, { timeout: 10_000 })
      await page.getByLabel('Send message').click()
      await page.getByText('Fake Codex received: GitHub context:').waitFor({ timeout: 10_000 })
      await openCommandPalette(page)
      await page.getByPlaceholder('Run command or switch repo...').fill('github branch context')
      await page.locator('[cmdk-item]').filter({ hasText: 'Send GitHub branch context' }).first().click()
      await page.waitForFunction(() => {
        return [...document.querySelectorAll('[data-composer-input="true"]')]
          .some((textarea) => (textarea.textContent ?? '').includes('GitHub context:') && (textarea.textContent ?? '').includes('Panel: branches') && (textarea.textContent ?? '').includes('Source: git'))
      }, { timeout: 10_000 })
      await page.getByLabel('Send message').click()
      await page.getByText('Fake Codex received: GitHub context:').last().waitFor({ timeout: 10_000 })
      await openCommandPalette(page)
      await page.getByPlaceholder('Run command or switch repo...').fill('copy github branch context')
      const copyGitHubBranchAction = page.locator('[cmdk-item]').filter({ hasText: 'Copy GitHub branch context' }).first()
      await copyGitHubBranchAction.waitFor({ timeout: 10_000 })
      if (await copyGitHubBranchAction.getAttribute('aria-disabled') === 'true') {
        throw new Error(`Copy GitHub branch context action was disabled: ${await copyGitHubBranchAction.textContent()}`)
      }
      await copyGitHubBranchAction.click()
      await page.waitForFunction(async () => {
        const text = await navigator.clipboard.readText()
        return text.includes('GitHub context:') && text.includes('Panel: branches') && text.includes('Source: git')
      }, { timeout: 10_000 })
      await openCommandPalette(page)
      await page.getByPlaceholder('Run command or switch repo...').fill('github branch smoke context')
      await page.locator('[cmdk-item]').filter({ hasText: 'Send GitHub branch context: smoke/context' }).first().click()
      await page.waitForFunction(() => {
        return [...document.querySelectorAll('[data-composer-input="true"]')]
          .some((textarea) => (textarea.textContent ?? '').includes('GitHub item context:') && (textarea.textContent ?? '').includes('Kind: branches') && (textarea.textContent ?? '').includes('Title: smoke/context'))
      }, { timeout: 10_000 })
      await page.getByLabel('Send message').click()
      await page.getByText('Fake Codex received: GitHub item context:').waitFor({ timeout: 10_000 })
      const githubContextArticleCount = await page.locator('article').count()
      await openCommandPalette(page)
      await page.getByPlaceholder('Run command or switch repo...').fill('send latest github context')
      const sendLatestGitHubAction = page.locator('[cmdk-item]').filter({ hasText: 'Send latest GitHub context to chat' }).first()
      await sendLatestGitHubAction.waitFor({ timeout: 10_000 })
      if (await sendLatestGitHubAction.getAttribute('aria-disabled') === 'true') {
        throw new Error(`Send latest GitHub context action was disabled: ${await sendLatestGitHubAction.textContent()}`)
      }
      await sendLatestGitHubAction.click()
      await page.waitForFunction(() => {
        return [...document.querySelectorAll('[data-composer-input="true"]')]
          .some((textarea) => (textarea.textContent ?? '').includes('GitHub item context:') && (textarea.textContent ?? '').includes('Kind: branches') && (textarea.textContent ?? '').includes('Title: smoke/context'))
      }, { timeout: 10_000 })
      await page.getByLabel('Send message').click()
      await page.getByText('Fake Codex received: GitHub item context:').last().waitFor({ timeout: 10_000 })
      await page.waitForFunction((count) => document.querySelectorAll('article').length > count, githubContextArticleCount, { timeout: 10_000 })
      await openCommandPalette(page)
      await page.getByPlaceholder('Run command or switch repo...').fill('copy latest github context')
      const copyLatestGitHubAction = page.locator('[cmdk-item]').filter({ hasText: 'Copy latest GitHub context' }).first()
      await copyLatestGitHubAction.waitFor({ timeout: 10_000 })
      if (await copyLatestGitHubAction.getAttribute('aria-disabled') === 'true') {
        throw new Error(`Copy latest GitHub context action was disabled: ${await copyLatestGitHubAction.textContent()}`)
      }
      const copiedGitHubContext = await runClipboardCommand(
        page,
        copyLatestGitHubAction,
        'Copy latest GitHub context',
        ['GitHub item context:', 'Title: smoke/context'],
      )
      if (!copiedGitHubContext.includes('GitHub item context:') || !copiedGitHubContext.includes('Title: smoke/context')) {
        throw new Error(`Latest GitHub context clipboard was wrong:\n${copiedGitHubContext}`)
      }
      smokeStep('app and codex resource contexts')
      await openCommandPalette(page)
      await page.getByPlaceholder('Run command or switch repo...').fill('workspace brief')
      await page.locator('[cmdk-item]').filter({ hasText: 'Send workspace brief' }).first().click()
      await page.waitForFunction(() => {
        return [...document.querySelectorAll('[data-composer-input="true"]')]
          .some((textarea) => (textarea.textContent ?? '').includes('Workspace brief:') && (textarea.textContent ?? '').includes('GitHub: fraction12/Cranberri') && (textarea.textContent ?? '').includes('Selected right rail file: README.md (tracked)') && (textarea.textContent ?? '').includes('- modified: README.md'))
      }, { timeout: 10_000 })
      await page.getByLabel('Send message').click()
      await page.getByText('Fake Codex received: Workspace brief:').waitFor({ timeout: 10_000 })
      await openCommandPalette(page)
      await page.getByPlaceholder('Run command or switch repo...').fill('copy workspace brief')
      const copyWorkspaceBriefAction = page.locator('[cmdk-item]').filter({ hasText: 'Copy workspace brief' }).first()
      await copyWorkspaceBriefAction.waitFor({ timeout: 10_000 })
      if (await copyWorkspaceBriefAction.getAttribute('aria-disabled') === 'true') {
        throw new Error(`Copy workspace brief action was disabled: ${await copyWorkspaceBriefAction.textContent()}`)
      }
      const copiedWorkspaceBrief = await runClipboardCommand(
        page,
        copyWorkspaceBriefAction,
        'Copy workspace brief',
        ['Workspace brief:', 'GitHub: fraction12/Cranberri'],
      )
      if (!copiedWorkspaceBrief.includes('Workspace brief:') || !copiedWorkspaceBrief.includes('GitHub: fraction12/Cranberri')) {
        throw new Error(`Direct workspace brief clipboard was wrong:\n${copiedWorkspaceBrief}`)
      }
      const appContextArticleCount = await page.locator('article').count()
      await openCommandPalette(page)
      await page.getByPlaceholder('Run command or switch repo...').fill('send latest app context')
      const sendLatestAppContextAction = page.locator('[cmdk-item]').filter({ hasText: 'Send latest app context to chat' }).first()
      await sendLatestAppContextAction.waitFor({ timeout: 10_000 })
      if (await sendLatestAppContextAction.getAttribute('aria-disabled') === 'true') {
        throw new Error(`Send latest app context action was disabled: ${await sendLatestAppContextAction.textContent()}`)
      }
      await sendLatestAppContextAction.click()
      await page.waitForFunction(() => {
        return [...document.querySelectorAll('[data-composer-input="true"]')]
          .some((textarea) => (textarea.textContent ?? '').includes('Workspace brief:') && (textarea.textContent ?? '').includes('GitHub: fraction12/Cranberri') && (textarea.textContent ?? '').includes('Selected right rail file: README.md (tracked)'))
      }, { timeout: 10_000 })
      await page.getByLabel('Send message').click()
      await page.getByText('Fake Codex received: Workspace brief:').last().waitFor({ timeout: 10_000 })
      await page.waitForFunction((count) => document.querySelectorAll('article').length > count, appContextArticleCount, { timeout: 10_000 })
      await openCommandPalette(page)
      await page.getByPlaceholder('Run command or switch repo...').fill('copy latest app context')
      const copyLatestAppContextAction = page.locator('[cmdk-item]').filter({ hasText: 'Copy latest app context' }).first()
      await copyLatestAppContextAction.waitFor({ timeout: 10_000 })
      if (await copyLatestAppContextAction.getAttribute('aria-disabled') === 'true') {
        throw new Error(`Copy latest app context action was disabled: ${await copyLatestAppContextAction.textContent()}`)
      }
      const copiedAppContext = await runClipboardCommand(
        page,
        copyLatestAppContextAction,
        'Copy latest app context',
        ['Workspace brief:', 'GitHub: fraction12/Cranberri'],
      )
      if (!copiedAppContext.includes('Workspace brief:') || !copiedAppContext.includes('GitHub: fraction12/Cranberri')) {
        throw new Error(`Latest app context clipboard was wrong:\n${copiedAppContext}`)
      }
      await openCommandPalette(page)
      await page.getByPlaceholder('Run command or switch repo...').fill('diagnostics context')
      await page.locator('[cmdk-item]').filter({ hasText: 'Send diagnostics context' }).first().click()
      await page.waitForFunction(() => {
        return [...document.querySelectorAll('[data-composer-input="true"]')]
          .some((textarea) => (textarea.textContent ?? '').includes('Cranberri diagnostics context:') && (textarea.textContent ?? '').includes('Health checks:'))
      }, { timeout: 20_000 })
      await page.getByLabel('Send message').click()
      await page.getByText('Fake Codex received: Cranberri diagnostics context:').waitFor({ timeout: 10_000 })
      await openCommandPalette(page)
      await page.getByPlaceholder('Run command or switch repo...').fill('usage context')
      await clickCommandItemByText(page, 'Send Codex usage context')
      await page.waitForFunction(() => {
        return [...document.querySelectorAll('[data-composer-input="true"]')]
          .some((textarea) => (textarea.textContent ?? '').includes('Codex usage context:') && (textarea.textContent ?? '').includes('Fake smoke limit') && (textarea.textContent ?? '').includes('Account usage history:') && (textarea.textContent ?? '').includes('1,234,567'))
      }, { timeout: 10_000 })
      await page.getByLabel('Send message').click()
      await page.getByText('Fake Codex received: Codex usage context:').waitFor({ timeout: 10_000 })
      await openCommandPalette(page)
      await page.getByPlaceholder('Run command or switch repo...').fill('fake smoke app context')
      await page.locator('[cmdk-item]').filter({ hasText: 'Send app context: Fake Smoke App' }).first().click()
      await page.waitForFunction(() => {
        return [...document.querySelectorAll('[data-composer-input="true"]')]
          .some((textarea) => (textarea.textContent ?? '').includes('Codex app context:') && (textarea.textContent ?? '').includes('Fake Smoke App') && (textarea.textContent ?? '').includes('Fake Smoke Plugin'))
      }, { timeout: 10_000 })
      await page.getByLabel('Send message').click()
      await page.getByText('Fake Codex received: Codex app context:').waitFor({ timeout: 10_000 })
      await openCommandPalette(page)
      await page.getByPlaceholder('Run command or switch repo...').fill('tool registry context')
      if (await page.locator('[cmdk-item]').filter({ hasText: 'Codex tool registry context' }).count()) {
        throw new Error('Whole-registry context action should not be exposed')
      }
      await page.keyboard.press('Escape')
      await openCommandPalette(page)
      await page.getByPlaceholder('Run command or switch repo...').fill('inspect fake smoke fixture')
      await page.locator('[cmdk-item]').filter({ hasText: 'Send MCP tool context: Inspect fake smoke fixture' }).first().click()
      await page.waitForFunction(() => {
        return [...document.querySelectorAll('[data-composer-input="true"]')]
          .some((textarea) => (textarea.textContent ?? '').includes('MCP tool context:') && (textarea.textContent ?? '').includes('fake-smoke-mcp') && (textarea.textContent ?? '').includes('inspect_fixture'))
      }, { timeout: 10_000 })
      await page.getByLabel('Send message').click()
      await page.getByText('Fake Codex received: MCP tool context:').waitFor({ timeout: 10_000 })
      const codexResourceArticleCount = await page.locator('article').count()
      await openCommandPalette(page)
      await page.getByPlaceholder('Run command or switch repo...').fill('send latest codex resource context')
      const sendLatestCodexResourceAction = page.locator('[cmdk-item]').filter({ hasText: 'Send latest Codex resource context to chat' }).first()
      await sendLatestCodexResourceAction.waitFor({ timeout: 10_000 })
      if (await sendLatestCodexResourceAction.getAttribute('aria-disabled') === 'true') {
        throw new Error(`Send latest Codex resource context action was disabled: ${await sendLatestCodexResourceAction.textContent()}`)
      }
      await sendLatestCodexResourceAction.click()
      await page.waitForFunction(() => {
        return [...document.querySelectorAll('[data-composer-input="true"]')]
          .some((textarea) => (textarea.textContent ?? '').includes('MCP tool context:') && (textarea.textContent ?? '').includes('fake-smoke-mcp') && (textarea.textContent ?? '').includes('inspect_fixture'))
      }, { timeout: 10_000 })
      await page.getByLabel('Send message').click()
      await page.getByText('Fake Codex received: MCP tool context:').last().waitFor({ timeout: 10_000 })
      await page.waitForFunction((count) => document.querySelectorAll('article').length > count, codexResourceArticleCount, { timeout: 10_000 })
      await openCommandPalette(page)
      await page.getByPlaceholder('Run command or switch repo...').fill('copy latest codex resource context')
      const copyLatestCodexResourceAction = page.locator('[cmdk-item]').filter({ hasText: 'Copy latest Codex resource context' }).first()
      await copyLatestCodexResourceAction.waitFor({ timeout: 10_000 })
      if (await copyLatestCodexResourceAction.getAttribute('aria-disabled') === 'true') {
        throw new Error(`Copy latest Codex resource context action was disabled: ${await copyLatestCodexResourceAction.textContent()}`)
      }
      const copiedCodexResourceContext = await runClipboardCommand(
        page,
        copyLatestCodexResourceAction,
        'Copy latest Codex resource context',
        ['MCP tool context:', 'inspect_fixture'],
      )
      if (!copiedCodexResourceContext.includes('MCP tool context:') || !copiedCodexResourceContext.includes('inspect_fixture')) {
        throw new Error(`Latest Codex resource context clipboard was wrong:\n${copiedCodexResourceContext}`)
      }
      smokeStep('rail file and tool panel checks')
      await openCommandPalette(page)
      await page.getByPlaceholder('Run command or switch repo...').fill('README')
      await page.locator('[cmdk-item]').filter({ hasText: 'README.md' }).first().waitFor({ timeout: 10_000 })
      await page.keyboard.press('Escape')
      await openCommandPalette(page)
      await page.getByPlaceholder('Run command or switch repo...').fill('show all repo files')
      await page.locator('[cmdk-item]').filter({ hasText: 'Show all repo files' }).first().click()
      await page.getByText('All files', { exact: true }).waitFor({ timeout: 10_000 })
      await page.getByTitle('README.md').waitFor({ timeout: 10_000 })
      await captureSmokeScreenshot(page, 'files-all-light')
      await openCommandPalette(page)
      await page.getByPlaceholder('Run command or switch repo...').fill('show tools')
      await page.locator('[cmdk-item]').filter({ hasText: 'Show tools' }).first().click()
      await page.getByText('Tools', { exact: true }).waitFor({ timeout: 10_000 })
      await page.getByText('rg', { exact: true }).first().waitFor({ timeout: 10_000 })
      const toolsPanel = page.getByLabel('Manage tools').locator('..').locator('..')
      const toolsPanelText = await toolsPanel.textContent()
      if (toolsPanelText?.includes('observe-only') || toolsPanelText?.includes('apps')) {
        throw new Error(`Tools panel still contains registry noise:\n${toolsPanelText}`)
      }
      const rgRow = page.locator('article').filter({ hasText: /^rg/ }).first()
      await rgRow.getByLabel('Test rg').click()
      await rgRow.getByLabel('Test rg').waitFor({ timeout: 10_000 })
      await rgRow.getByText('Ready', { exact: true }).first().waitFor({ timeout: 10_000 })
      await captureSmokeScreenshot(page, 'tools-panel-light')
      await page.getByLabel('Manage tools').click()
      await page.getByPlaceholder('Search tools').waitFor({ timeout: 10_000 })
      await page.getByLabel('Tool catalog').locator('article').first().waitFor({ timeout: 10_000 })
      await captureSmokeScreenshot(page, 'settings-tools-fake-light')
      await page.getByPlaceholder('Search tools').fill('inspect_fixture')
      const inspectToolRow = page.getByLabel('Tool catalog').locator('article').filter({ hasText: 'inspect_fixture' }).first()
      await inspectToolRow.getByLabel('Show inspect_fixture in Tools rail').click()
      await inspectToolRow.getByLabel('Hide inspect_fixture from Tools rail').waitFor({ timeout: 10_000 })
      await page.getByLabel('Close settings').click()
      await page.getByText('inspect_fixture', { exact: true }).waitFor({ timeout: 10_000 })

      await openCommandPalette(page)
      await page.getByPlaceholder('Run command or switch repo...').fill('terminal')
      smokeStep('terminal and processes')
      await page.getByText('New terminal').click()
      await page.getByText('Terminal 1').waitFor({ timeout: 10_000 })
      await page.locator('.xterm').click({ timeout: 10_000 })
      await page.keyboard.type('printf "cranberri-terminal-context-ready\\n"')
      await page.keyboard.press('Enter')
      await page.getByText('cranberri-terminal-context-ready', { exact: true }).waitFor({ timeout: 10_000 })
      await captureSmokeScreenshot(page, 'terminal-light')
      await page.getByLabel('Send terminal context to chat').click()
      await page.waitForFunction(() => {
        return [...document.querySelectorAll('[data-composer-input="true"]')]
          .some((textarea) => (textarea.textContent ?? '').includes('cranberri-terminal-context-ready'))
      }, { timeout: 10_000 })
      await page.getByLabel('Send message').click()
      await page.getByText('Fake Codex received: Terminal context:').waitFor({ timeout: 10_000 })
      await page.getByLabel('Switch to Terminal 1').click()
      await page.locator('.xterm').waitFor({ state: 'visible', timeout: 10_000 })
      await openCommandPalette(page)
      await page.getByPlaceholder('Run command or switch repo...').fill('copy active terminal context')
      const copyActiveTerminalContextAction = page.locator('[cmdk-item]').filter({ hasText: 'Copy active terminal context' }).first()
      await copyActiveTerminalContextAction.waitFor({ timeout: 10_000 })
      if (await copyActiveTerminalContextAction.getAttribute('aria-disabled') === 'true') {
        throw new Error(`Copy active terminal context action was disabled: ${await copyActiveTerminalContextAction.textContent()}`)
      }
      await copyActiveTerminalContextAction.click()
      await page.waitForFunction(async () => {
        const text = await navigator.clipboard.readText()
        return text.includes('Terminal context:') && text.includes('cranberri-terminal-context-ready')
      }, { timeout: 10_000 })
      await page.getByLabel('Switch to Terminal 1').click()
      await openCommandPalette(page)
      await page.getByPlaceholder('Run command or switch repo...').fill('active terminal context')
      const activeTerminalContextAction = page.locator('[cmdk-item]').filter({ hasText: 'Send active terminal context' }).first()
      await activeTerminalContextAction.waitFor({ timeout: 10_000 })
      if (await activeTerminalContextAction.getAttribute('aria-disabled') === 'true') {
        throw new Error(`Active terminal context action was disabled: ${await activeTerminalContextAction.textContent()}`)
      }
      await activeTerminalContextAction.click()
      await page.waitForFunction(() => {
        return [...document.querySelectorAll('[data-composer-input="true"]')]
          .some((textarea) => (textarea.textContent ?? '').includes('Terminal context:') && (textarea.textContent ?? '').includes('cranberri-terminal-context-ready'))
      }, { timeout: 10_000 })
      await page.getByLabel('Send message').click()
      await page.getByText('Fake Codex received: Terminal context:').last().waitFor({ timeout: 10_000 })
      await openCommandPalette(page)
      await page.getByPlaceholder('Run command or switch repo...').fill('send latest terminal context')
      const sendLatestTerminalContextAction = page.locator('[cmdk-item]').filter({ hasText: 'Send latest terminal context to chat' }).first()
      await sendLatestTerminalContextAction.waitFor({ timeout: 10_000 })
      if (await sendLatestTerminalContextAction.getAttribute('aria-disabled') === 'true') {
        throw new Error(`Send latest terminal context action was disabled: ${await sendLatestTerminalContextAction.textContent()}`)
      }
      await sendLatestTerminalContextAction.click()
      await page.waitForFunction(() => {
        return [...document.querySelectorAll('[data-composer-input="true"]')]
          .some((textarea) => (textarea.textContent ?? '').includes('Terminal context:') && (textarea.textContent ?? '').includes('cranberri-terminal-context-ready'))
      }, { timeout: 10_000 })
      await page.getByLabel('Send message').click()
      await page.waitForFunction(() => {
        return [...document.querySelectorAll('article')]
          .filter((article) => article.textContent?.includes('Fake Codex received: Terminal context:')).length >= 3
      }, { timeout: 10_000 })
      await openCommandPalette(page)
      await page.getByPlaceholder('Run command or switch repo...').fill('copy latest terminal context')
      const copyLatestTerminalContextAction = page.locator('[cmdk-item]').filter({ hasText: 'Copy latest terminal context' }).first()
      await copyLatestTerminalContextAction.waitFor({ timeout: 10_000 })
      if (await copyLatestTerminalContextAction.getAttribute('aria-disabled') === 'true') {
        throw new Error(`Copy latest terminal context action was disabled: ${await copyLatestTerminalContextAction.textContent()}`)
      }
      await copyLatestTerminalContextAction.click()
      await page.waitForFunction(async () => {
        const text = await navigator.clipboard.readText()
        return text.includes('Terminal context:') && text.includes('cranberri-terminal-context-ready')
      }, { timeout: 10_000 })
      await page.getByLabel('Switch to Terminal 1').click()
      await openCommandPalette(page)
      await page.getByPlaceholder('Run command or switch repo...').fill('search active terminal')
      const searchActiveTerminalAction = page.locator('[cmdk-item]').filter({ hasText: 'Search active terminal' }).first()
      await searchActiveTerminalAction.waitFor({ timeout: 10_000 })
      if (await searchActiveTerminalAction.getAttribute('aria-disabled') === 'true') {
        throw new Error(`Search active terminal action was disabled: ${await searchActiveTerminalAction.textContent()}`)
      }
      await searchActiveTerminalAction.click()
      const terminalSearchInput = page.getByPlaceholder('Search terminal')
      await terminalSearchInput.waitFor({ timeout: 10_000 })
      await terminalSearchInput.fill('cranberri-terminal-context-ready')
      await page.getByLabel('Next terminal search result').click()
      await page.getByLabel('Previous terminal search result').click()
      await openCommandPalette(page)
      await page.getByPlaceholder('Run command or switch repo...').fill('find next active terminal')
      await page.locator('[cmdk-item]').filter({ hasText: 'Find next in active terminal' }).first().click()
      await openCommandPalette(page)
      await page.getByPlaceholder('Run command or switch repo...').fill('find previous active terminal')
      await page.locator('[cmdk-item]').filter({ hasText: 'Find previous in active terminal' }).first().click()
      await openCommandPalette(page)
      await page.getByPlaceholder('Run command or switch repo...').fill('close active terminal search')
      await page.locator('[cmdk-item]').filter({ hasText: 'Close active terminal search' }).first().click()
      await terminalSearchInput.waitFor({ state: 'hidden', timeout: 10_000 })
      smokeStep('terminal close confirmation')
      await page.getByLabel('Close Terminal 1').click()
      const closeTerminalDialog = page.getByRole('dialog', { name: 'Close terminal' })
      await closeTerminalDialog.waitFor({ timeout: 10_000 })
      await captureSmokeScreenshot(page, 'terminal-close-dialog-light')
      await closeTerminalDialog.getByRole('button', { name: 'Cancel' }).click()
      await closeTerminalDialog.waitFor({ state: 'detached', timeout: 10_000 })
      await page.getByLabel('Switch to Terminal 1').waitFor({ timeout: 10_000 })
      await openCommandPalette(page)
      await page.getByPlaceholder('Run command or switch repo...').fill('copy active terminal buffer')
      const copyActiveTerminalBufferAction = page.locator('[cmdk-item]').filter({ hasText: 'Copy active terminal buffer' }).first()
      await copyActiveTerminalBufferAction.waitFor({ timeout: 10_000 })
      if (await copyActiveTerminalBufferAction.getAttribute('aria-disabled') === 'true') {
        throw new Error(`Copy active terminal buffer action was disabled: ${await copyActiveTerminalBufferAction.textContent()}`)
      }
      await copyActiveTerminalBufferAction.click()
      const copiedTerminalBuffer = await page.evaluate(() => navigator.clipboard.readText())
      if (!copiedTerminalBuffer.includes('cranberri-terminal-context-ready')) {
        throw new Error(`Active terminal buffer clipboard was wrong:\n${copiedTerminalBuffer}`)
      }
      await openCommandPalette(page)
      await page.getByPlaceholder('Run command or switch repo...').fill('clear active terminal')
      const clearActiveTerminalAction = page.locator('[cmdk-item]').filter({ hasText: 'Clear active terminal' }).first()
      await clearActiveTerminalAction.waitFor({ timeout: 10_000 })
      if (await clearActiveTerminalAction.getAttribute('aria-disabled') === 'true') {
        throw new Error(`Clear active terminal action was disabled: ${await clearActiveTerminalAction.textContent()}`)
      }
      await clearActiveTerminalAction.click()
      await page.waitForFunction(() => {
        return !document.querySelector('.xterm')?.textContent?.includes('cranberri-terminal-context-ready')
      }, { timeout: 10_000 })
      await page.getByTitle('Repo processes').click()
      await page.getByText('Processes', { exact: true }).waitFor({ timeout: 10_000 })
      await page.getByText('terminal', { exact: true }).first().waitFor({ timeout: 10_000 }).catch(async (error) => {
        const diagnostics = await page.evaluate(async () => {
          const tasks = await window.cranberri.tasks.snapshot()
          const activeTask = [...tasks.tasks].reverse().find((task) => task.threadId)
          return {
            tasks,
            processes: activeTask ? await window.cranberri.processes.listForTask(activeTask.id) : null,
            appState: await window.cranberri.appState.read(),
            panel: document.body.textContent?.slice(-3000),
          }
        })
        throw new Error(`${error instanceof Error ? error.message : String(error)}\nTask terminal diagnostics:\n${JSON.stringify(diagnostics, null, 2)}`)
      })
      await page.getByText(/pid \d+/).first().waitFor({ timeout: 10_000 })
      await page.getByText(/running \d/).first().waitFor({ timeout: 10_000 })
      await page.getByLabel('Focus process terminal').first().click()
      await page.locator('.xterm').waitFor({ state: 'visible', timeout: 10_000 })
      await openCommandPalette(page)
      await page.getByPlaceholder('Run command or switch repo...').fill('show repo processes')
      await page.locator('[cmdk-item]').filter({ hasText: 'Show repo processes' }).first().click()
      await page.getByText('Processes', { exact: true }).waitFor({ timeout: 10_000 })
      await page.getByLabel('Send process context to chat').first().click()
      await page.waitForFunction(() => {
        return [...document.querySelectorAll('[data-composer-input="true"]')]
          .some((textarea) => (textarea.textContent ?? '').includes('Repo process context:') && (textarea.textContent ?? '').includes('Status: running'))
      }, { timeout: 10_000 })
      await page.getByLabel('Send message').click()
      await page.getByText('Fake Codex received: Repo process context:').waitFor({ timeout: 10_000 })
      await openCommandPalette(page)
      await page.getByPlaceholder('Run command or switch repo...').fill('send latest process context')
      const sendLatestProcessAction = page.locator('[cmdk-item]').filter({ hasText: 'Send latest process context to chat' }).first()
      await sendLatestProcessAction.waitFor({ timeout: 10_000 })
      if (await sendLatestProcessAction.getAttribute('aria-disabled') === 'true') {
        throw new Error(`Send latest process context action was disabled: ${await sendLatestProcessAction.textContent()}`)
      }
      await sendLatestProcessAction.click()
      await page.waitForFunction(() => {
        return [...document.querySelectorAll('[data-composer-input="true"]')]
          .some((textarea) => (textarea.textContent ?? '').includes('Repo process context:') && (textarea.textContent ?? '').includes('Status: running'))
      }, { timeout: 10_000 })
      const processContextCountBefore = await page.locator('article').filter({ hasText: 'Fake Codex received: Repo process context:' }).count()
      await page.getByLabel('Send message').click()
      await page.waitForFunction((countBefore) => {
        return [...document.querySelectorAll('article')]
          .filter((article) => article.textContent?.includes('Fake Codex received: Repo process context:')).length >= countBefore + 1
      }, processContextCountBefore, { timeout: 10_000 })
      await openCommandPalette(page)
      await page.getByPlaceholder('Run command or switch repo...').fill('copy latest process context')
      const copyLatestProcessAction = page.locator('[cmdk-item]').filter({ hasText: 'Copy latest process context' }).first()
      await copyLatestProcessAction.waitFor({ timeout: 10_000 })
      if (await copyLatestProcessAction.getAttribute('aria-disabled') === 'true') {
        throw new Error(`Copy latest process context action was disabled: ${await copyLatestProcessAction.textContent()}`)
      }
      await copyLatestProcessAction.click()
      await page.waitForFunction(async () => {
        const text = await navigator.clipboard.readText()
        return text.includes('Repo process context:') && text.includes('Status: running')
      }, { timeout: 10_000 })
      await openCommandPalette(page)
      await page.getByPlaceholder('Run command or switch repo...').fill('process context')
      await page.locator('[cmdk-item]').filter({ hasText: 'Send process context:' }).first().click()
      await page.waitForFunction(() => {
        return [...document.querySelectorAll('[data-composer-input="true"]')]
          .some((textarea) => (textarea.textContent ?? '').includes('Repo process context:') && (textarea.textContent ?? '').includes('Status: running'))
      }, { timeout: 10_000 })
      await page.getByLabel('Send message').click()
      await page.getByText('Fake Codex received: Repo process context:').last().waitFor({ timeout: 10_000 })

      smokeStep('browser')
      await openCommandPalette(page)
      await page.getByPlaceholder('Run command or switch repo...').fill('browser')
      await page.locator('[cmdk-item]').filter({ hasText: 'New browser' }).first().click()
      const browserAddress = page.getByPlaceholder('https://localhost:5173')
      await browserAddress.waitFor({ timeout: 10_000 })
      await browserAddress.fill(browserUrl)
      await page.getByLabel('Navigate').click()
      await page.waitForFunction((url) => {
        const input = document.querySelector('input[name="browser-address"]')
        return input instanceof HTMLInputElement && input.value === url
      }, browserUrl, { timeout: 10_000 })
      const browserActions = page.getByLabel('Browser actions')
      await browserActions.click()
      await page.keyboard.press('Escape')
      await page.waitForFunction(() => document.querySelector('button[aria-label="Browser actions"]')?.getAttribute('aria-busy') !== 'true')
      await page.waitForTimeout(500)
      if (await page.getByTitle('Copy browser URL').count()) {
        throw new Error('Canceled Browser actions opened after its preview capture completed')
      }
      await browserActions.click()
      await page.getByTitle('Copy browser URL').click()
      await page.waitForFunction(async (url) => {
        return await navigator.clipboard.readText() === url
      }, browserUrl, { timeout: 10_000 })

      let snapshotReady = false
      for (let attempt = 0; attempt < 15; attempt += 1) {
        await page.waitForTimeout(attempt === 0 ? 750 : 1_000)
        await page.getByLabel('Browser actions').click()
        await page.getByTitle('Capture page text').click()
        snapshotReady = await page.getByText('cranberri-browser-smoke-ready').waitFor({ timeout: 3_000 })
          .then(() => true)
          .catch(() => false)
        if (snapshotReady) break
      }
      if (!snapshotReady) {
        throw new Error('Browser snapshot did not include cranberri-browser-smoke-ready')
      }
      await clickButtonByAccessibleName(page, 'Copy page context')
      await page.waitForFunction(async () => {
        const text = await navigator.clipboard.readText()
        return text.includes('Browser page context:') && text.includes('cranberri-browser-smoke-ready')
      }, { timeout: 10_000 })
      const attachedBrowserChildViews = await mainWindowChildViewCount(electronApp)
      if (attachedBrowserChildViews < 1) throw new Error('Active browser did not attach a native child view')
      await captureNativeSmokeScreenshot(electronApp, 'browser-native-light')
      await openCommandPalette(page)
      await page.waitForFunction(() => Boolean(document.querySelector('[data-browser-surface-obscured="true"]')))
      await waitForMainWindowChildViewCount(electronApp, attachedBrowserChildViews - 1, 'Quick Search did not detach the browser surface')
      await captureSmokeScreenshot(page, 'browser-quick-search')
      await page.getByPlaceholder('Run command or switch repo...').fill('copy latest browser page context')
      const toolbarCopyLatestBrowserPageAction = page.locator('[cmdk-item]').filter({ hasText: 'Copy latest browser page context' }).first()
      await toolbarCopyLatestBrowserPageAction.waitFor({ timeout: 10_000 })
      if (await toolbarCopyLatestBrowserPageAction.getAttribute('aria-disabled') === 'true') {
        throw new Error(`Toolbar-captured latest browser page context action was disabled: ${await toolbarCopyLatestBrowserPageAction.textContent()}`)
      }
      await toolbarCopyLatestBrowserPageAction.click()
      await page.waitForFunction(() => !document.querySelector('[data-browser-surface-obscured="true"]'))
      await waitForMainWindowChildViewCount(electronApp, attachedBrowserChildViews, 'Closing Quick Search did not reattach the browser surface')
      await page.waitForFunction(async () => {
        const text = await navigator.clipboard.readText()
        return text.includes('Browser page context:') && text.includes('cranberri-browser-smoke-ready')
      }, { timeout: 10_000 })

      await setAttachedBrowserBackground(electronApp, 'rgb(215, 38, 61)')
      await page.getByLabel('Browser actions').click()
      await waitForMainWindowChildViewCount(electronApp, attachedBrowserChildViews - 1, 'Browser actions did not freeze the red browser surface')
      await page.keyboard.press('Escape')
      await waitForMainWindowChildViewCount(electronApp, attachedBrowserChildViews, 'Closing Browser actions did not restore the browser surface')
      await page.waitForTimeout(500)
      await setAttachedBrowserBackground(electronApp, 'rgb(34, 197, 94)')

      const repoOptionsLabel = `Options for ${path.basename(repoPath)}`
      await page.getByLabel(repoOptionsLabel).click()
      await page.getByRole('menuitem', { name: 'Remove repository' }).waitFor({ timeout: 10_000 })
      await captureSmokeScreenshot(page, 'dropdown-repo-options-light-standard')
      await page.getByRole('menuitem', { name: 'Remove repository' }).click()
      const removeRepoDialog = page.getByRole('dialog', { name: 'Remove repository' })
      await removeRepoDialog.waitFor({ timeout: 10_000 })
      await page.waitForFunction(() => Boolean(document.querySelector('[data-browser-surface-obscured="true"]')))
      const frozenBrowserImage = page.locator('[data-browser-surface-frozen="true"] img')
      await frozenBrowserImage.waitFor({ timeout: 10_000 })
      await waitForMainWindowChildViewCount(electronApp, attachedBrowserChildViews - 1, 'Repository confirmation did not detach the browser surface')
      const frozenBrowserPixel = await frozenBrowserImage.evaluate(async (image) => {
        if (!(image instanceof HTMLImageElement)) return null
        await image.decode()
        const canvas = document.createElement('canvas')
        canvas.width = image.naturalWidth
        canvas.height = image.naturalHeight
        const context = canvas.getContext('2d')
        if (!context) return null
        context.drawImage(image, 0, 0)
        const x = Math.max(0, Math.floor(canvas.width * 0.9) - 1)
        const y = Math.max(0, Math.floor(canvas.height * 0.9) - 1)
        return [...context.getImageData(x, y, 1, 1).data]
      })
      if (!frozenBrowserPixel || frozenBrowserPixel[1] < frozenBrowserPixel[0] + 60 || frozenBrowserPixel[1] < frozenBrowserPixel[2] + 60) {
        throw new Error(`Frozen browser surface did not capture the latest scripted DOM state: ${JSON.stringify(frozenBrowserPixel)}`)
      }
      await page.waitForFunction(() => {
        const dialog = document.querySelector('[role="dialog"]')
        return dialog instanceof HTMLElement && dialog.contains(document.activeElement)
      })
      await page.keyboard.press('Tab')
      await page.keyboard.press('Shift+Tab')
      await page.waitForFunction(() => {
        const dialog = document.querySelector('[role="dialog"]')
        return dialog instanceof HTMLElement && dialog.contains(document.activeElement)
      })
      await captureSmokeScreenshot(page, 'browser-remove-repo-dialog-light')
      await page.keyboard.press('Escape')
      await removeRepoDialog.waitFor({ state: 'detached', timeout: 10_000 })
      await page.waitForFunction(() => !document.querySelector('[data-browser-surface-obscured="true"]'))
      await waitForMainWindowChildViewCount(electronApp, attachedBrowserChildViews, 'Closing repository confirmation did not reattach the browser surface')
      await page.waitForFunction((label) => document.activeElement?.getAttribute('aria-label') === label, repoOptionsLabel, { timeout: 10_000 })

      await page.getByLabel('Open settings').click()
      await page.getByLabel('Close settings').waitFor({ timeout: 10_000 })
      await page.waitForFunction(() => Boolean(document.querySelector('[data-browser-surface-obscured="true"]')))
      await waitForMainWindowChildViewCount(electronApp, attachedBrowserChildViews - 1, 'Settings did not detach the browser surface')
      await page.getByLabel('Close settings').click()
      await page.waitForFunction(() => !document.querySelector('[data-browser-surface-obscured="true"]'))
      await waitForMainWindowChildViewCount(electronApp, attachedBrowserChildViews, 'Closing Settings did not reattach the browser surface')
      await openCommandPalette(page)
      await page.getByPlaceholder('Run command or switch repo...').fill('reload active browser')
      await page.locator('[cmdk-item]').filter({ hasText: 'Reload active browser' }).first().click()
      snapshotReady = false
      for (let attempt = 0; attempt < 10; attempt += 1) {
        await page.waitForTimeout(attempt === 0 ? 750 : 1_000)
        await page.getByLabel('Browser actions').click()
        await page.getByTitle('Capture page text').click()
        snapshotReady = await page.getByText('cranberri-browser-smoke-ready').waitFor({ timeout: 3_000 })
          .then(() => true)
          .catch(() => false)
        if (snapshotReady) break
      }
      if (!snapshotReady) {
        throw new Error('Browser snapshot did not include cranberri-browser-smoke-ready after reload')
      }
      await openCommandPalette(page)
      await page.getByPlaceholder('Run command or switch repo...').fill('mobile browser viewport')
      const mobileBrowserViewportAction = page.locator('[cmdk-item]').filter({ hasText: 'Mobile browser viewport' }).first()
      await mobileBrowserViewportAction.waitFor({ timeout: 10_000 })
      if (await mobileBrowserViewportAction.getAttribute('aria-disabled') === 'true') {
        throw new Error(`Mobile browser viewport action was disabled: ${await mobileBrowserViewportAction.textContent()}`)
      }
      await mobileBrowserViewportAction.click()
      await page.getByText('Mobile 390x844').waitFor({ timeout: 10_000 })
      await openCommandPalette(page)
      await page.getByPlaceholder('Run command or switch repo...').fill('responsive browser viewport')
      const responsiveBrowserViewportAction = page.locator('[cmdk-item]').filter({ hasText: 'Responsive browser viewport' }).first()
      await responsiveBrowserViewportAction.waitFor({ timeout: 10_000 })
      if (await responsiveBrowserViewportAction.getAttribute('aria-disabled') === 'true') {
        throw new Error(`Responsive browser viewport action was disabled: ${await responsiveBrowserViewportAction.textContent()}`)
      }
      await responsiveBrowserViewportAction.click()
      await page.getByText('Mobile 390x844').waitFor({ state: 'detached', timeout: 10_000 })
      await openCommandPalette(page)
      await page.getByPlaceholder('Run command or switch repo...').fill('active browser page context')
      await page.locator('[cmdk-item]').filter({ hasText: 'Send active browser page context' }).first().click()
      await page.waitForFunction(() => {
        return [...document.querySelectorAll('[data-composer-input="true"]')]
          .some((textarea) => (textarea.textContent ?? '').includes('cranberri-browser-smoke-ready'))
      }, { timeout: 10_000 })
      await page.getByLabel('Send message').click()
      await page.getByText('Fake Codex received: Browser page context:').waitFor({ timeout: 10_000 })
      await page.getByLabel(/Switch to (Browser|Smoke Browser Page)/).click()
      await openCommandPalette(page)
      await page.getByPlaceholder('Run command or switch repo...').fill('copy active browser page context')
      const copyBrowserPageContextAction = page.locator('[cmdk-item]').filter({ hasText: 'Copy active browser page context' }).first()
      await copyBrowserPageContextAction.waitFor({ timeout: 10_000 })
      if (await copyBrowserPageContextAction.getAttribute('aria-disabled') === 'true') {
        throw new Error(`Copy active browser page context action was disabled: ${await copyBrowserPageContextAction.textContent()}`)
      }
      await copyBrowserPageContextAction.click()
      await page.getByText('Copy active browser page context').waitFor({ timeout: 10_000 })
      await page.waitForFunction(async () => {
        const text = await navigator.clipboard.readText()
        return text.includes('Browser page context:') && text.includes('cranberri-browser-smoke-ready')
      }, { timeout: 10_000 })
      await openCommandPalette(page)
      await page.getByPlaceholder('Run command or switch repo...').fill('send latest browser page context')
      const sendLatestBrowserPageAction = page.locator('[cmdk-item]').filter({ hasText: 'Send latest browser page context to chat' }).first()
      await sendLatestBrowserPageAction.waitFor({ timeout: 10_000 })
      if (await sendLatestBrowserPageAction.getAttribute('aria-disabled') === 'true') {
        throw new Error(`Send latest browser page context action was disabled: ${await sendLatestBrowserPageAction.textContent()}`)
      }
      await sendLatestBrowserPageAction.click()
      await page.waitForFunction(() => {
        return [...document.querySelectorAll('[data-composer-input="true"]')]
          .some((textarea) => (textarea.textContent ?? '').includes('Browser page context:') && (textarea.textContent ?? '').includes('cranberri-browser-smoke-ready'))
      }, { timeout: 10_000 })
      await page.getByLabel('Send message').click()
      await page.waitForFunction(() => {
        return [...document.querySelectorAll('article')]
          .filter((article) => article.textContent?.includes('Fake Codex received: Browser page context:')).length >= 2
      }, { timeout: 10_000 })
      await openCommandPalette(page)
      await page.getByPlaceholder('Run command or switch repo...').fill('copy latest browser page context')
      const copyLatestBrowserPageAction = page.locator('[cmdk-item]').filter({ hasText: 'Copy latest browser page context' }).first()
      await copyLatestBrowserPageAction.waitFor({ timeout: 10_000 })
      if (await copyLatestBrowserPageAction.getAttribute('aria-disabled') === 'true') {
        throw new Error(`Copy latest browser page context action was disabled: ${await copyLatestBrowserPageAction.textContent()}`)
      }
      await copyLatestBrowserPageAction.click()
      await page.waitForFunction(async () => {
        const text = await navigator.clipboard.readText()
        return text.includes('Browser page context:') && text.includes('cranberri-browser-smoke-ready')
      }, { timeout: 10_000 })

      await page.getByLabel(/Switch to (Browser|Smoke Browser Page)/).click()
      await openCommandPalette(page)
      await page.getByPlaceholder('Run command or switch repo...').fill('inspect active browser element')
      const inspectBrowserAction = page.locator('[cmdk-item]').filter({ hasText: 'Inspect active browser element' }).first()
      await inspectBrowserAction.waitFor({ timeout: 10_000 })
      if (await inspectBrowserAction.getAttribute('aria-disabled') === 'true') {
        throw new Error(`Inspect active browser action was disabled: ${await inspectBrowserAction.textContent()}`)
      }
      await inspectBrowserAction.click()
      await page.getByLabel(/Switch to (Browser|Smoke Browser Page)/).click()
      await openCommandPalette(page)
      await page.getByPlaceholder('Run command or switch repo...').fill('active browser element context')
      const sendBrowserElementContextAction = page.locator('[cmdk-item]').filter({ hasText: 'Send active browser element context' }).first()
      await sendBrowserElementContextAction.waitFor({ timeout: 10_000 })
      if (await sendBrowserElementContextAction.getAttribute('aria-disabled') === 'true') {
        throw new Error(`Send active browser element context action was disabled: ${await sendBrowserElementContextAction.textContent()}`)
      }
      await sendBrowserElementContextAction.click()
      await page.waitForFunction(() => {
        return [...document.querySelectorAll('[data-composer-input="true"]')]
          .some((textarea) => (textarea.textContent ?? '').includes('Browser element context:') && (textarea.textContent ?? '').includes('Smoke Browser Page'))
      }, { timeout: 10_000 })
      await page.getByLabel('Send message').click()
      await page.getByText('Fake Codex received: Browser element context:').waitFor({ timeout: 10_000 })
      await page.getByLabel(/Switch to (Browser|Smoke Browser Page)/).click()
      await openCommandPalette(page)
      await page.getByPlaceholder('Run command or switch repo...').fill('copy active browser element context')
      const copyActiveBrowserElementAction = page.locator('[cmdk-item]').filter({ hasText: 'Copy active browser element context' }).first()
      await copyActiveBrowserElementAction.waitFor({ timeout: 10_000 })
      if (await copyActiveBrowserElementAction.getAttribute('aria-disabled') === 'true') {
        throw new Error(`Copy active browser element context action was disabled: ${await copyActiveBrowserElementAction.textContent()}`)
      }
      await copyActiveBrowserElementAction.click()
      await page.waitForFunction(async () => {
        const text = await navigator.clipboard.readText()
        return text.includes('Browser element context:') && text.includes('Smoke Browser Page')
      }, { timeout: 10_000 })
      await page.getByLabel(/Switch to (Browser|Smoke Browser Page)/).click()
      await clickButtonByAccessibleName(page, 'Copy element selector')
      await page.waitForFunction(async () => {
        const text = await navigator.clipboard.readText()
        return text.length > 0 && !text.includes('Browser element context:')
      }, { timeout: 10_000 })
      await clickButtonByAccessibleName(page, 'Copy element text')
      await page.waitForFunction(async () => {
        const text = await navigator.clipboard.readText()
        return text.includes('Smoke Browser Page') || text.includes('cranberri-browser-smoke-ready')
      }, { timeout: 10_000 })
      await openCommandPalette(page)
      await page.getByPlaceholder('Run command or switch repo...').fill('send latest browser element context')
      const sendLatestBrowserElementAction = page.locator('[cmdk-item]').filter({ hasText: 'Send latest browser element context to chat' }).first()
      await sendLatestBrowserElementAction.waitFor({ timeout: 10_000 })
      if (await sendLatestBrowserElementAction.getAttribute('aria-disabled') === 'true') {
        throw new Error(`Send latest browser element context action was disabled: ${await sendLatestBrowserElementAction.textContent()}`)
      }
      await sendLatestBrowserElementAction.click()
      await page.waitForFunction(() => {
        return [...document.querySelectorAll('[data-composer-input="true"]')]
          .some((textarea) => (textarea.textContent ?? '').includes('Browser element context:') && (textarea.textContent ?? '').includes('Smoke Browser Page'))
      }, { timeout: 10_000 })
      await page.getByLabel('Send message').click()
      await page.waitForFunction(() => {
        return [...document.querySelectorAll('article')]
          .filter((article) => article.textContent?.includes('Fake Codex received: Browser element context:')).length >= 2
      }, { timeout: 10_000 })
      await openCommandPalette(page)
      await page.getByPlaceholder('Run command or switch repo...').fill('copy latest browser element context')
      const copyLatestBrowserElementAction = page.locator('[cmdk-item]').filter({ hasText: 'Copy latest browser element context' }).first()
      await copyLatestBrowserElementAction.waitFor({ timeout: 10_000 })
      if (await copyLatestBrowserElementAction.getAttribute('aria-disabled') === 'true') {
        throw new Error(`Copy latest browser element context action was disabled: ${await copyLatestBrowserElementAction.textContent()}`)
      }
      await copyLatestBrowserElementAction.click()
      await page.waitForFunction(async () => {
        const text = await navigator.clipboard.readText()
        return text.includes('Browser element context:') && text.includes('Smoke Browser Page')
      }, { timeout: 10_000 })
      await page.getByLabel(/Switch to (Browser|Smoke Browser Page)/).click()
      await openCommandPalette(page)
      await page.getByPlaceholder('Run command or switch repo...').fill('stop browser inspection')
      await page.locator('[cmdk-item]').filter({ hasText: 'Stop active browser inspection' }).first().click()
      await page.getByLabel(/Switch to (Browser|Smoke Browser Page)/).click()
      await page.getByLabel('Browser actions').click()
      await page.locator('[data-browser-surface-frozen="true"] img').waitFor({ timeout: 10_000 })
      await waitForMainWindowChildViewCount(electronApp, attachedBrowserChildViews - 1, 'Browser actions menu did not detach the browser surface')
      await captureSmokeScreenshot(page, 'browser-actions-menu-light')
      await page.getByTitle('Capture screenshot').click()
      await page.getByAltText('Captured browser screenshot').waitFor({ timeout: 10_000 })
      await waitForMainWindowChildViewCount(electronApp, attachedBrowserChildViews, 'Browser capture did not reattach the browser surface')
      await captureSmokeScreenshot(page, 'browser-captures-light')
      await clickButtonByAccessibleName(page, 'Copy screenshot path')
      await page.waitForFunction(async () => {
        const text = await navigator.clipboard.readText()
        return text.includes('browser-captures') && text.endsWith('.png')
      }, { timeout: 10_000 })
      await openCommandPalette(page)
      await page.getByPlaceholder('Run command or switch repo...').fill('copy latest browser screenshot path')
      const toolbarCopyLatestBrowserScreenshotPathAction = page.locator('[cmdk-item]').filter({ hasText: 'Copy latest browser screenshot path' }).first()
      await toolbarCopyLatestBrowserScreenshotPathAction.waitFor({ timeout: 10_000 })
      if (await toolbarCopyLatestBrowserScreenshotPathAction.getAttribute('aria-disabled') === 'true') {
        throw new Error(`Toolbar-captured latest browser screenshot path action was disabled: ${await toolbarCopyLatestBrowserScreenshotPathAction.textContent()}`)
      }
      await toolbarCopyLatestBrowserScreenshotPathAction.click()
      await page.waitForFunction(async () => {
        const text = await navigator.clipboard.readText()
        return text.includes('browser-captures') && text.endsWith('.png')
      }, { timeout: 10_000 })
      await page.getByLabel(/Switch to (Browser|Smoke Browser Page)/).click()
      await openCommandPalette(page)
      await page.getByPlaceholder('Run command or switch repo...').fill('active browser screenshot')
      await page.locator('[cmdk-item]').filter({ hasText: 'Send active browser screenshot' }).first().click()
      await page.waitForFunction(() => {
        return [...document.querySelectorAll('[data-composer-input="true"]')]
          .some((textarea) => (textarea.textContent ?? '').includes('Browser screenshot context:'))
      }, { timeout: 10_000 })
      await page.getByLabel('Send message').click()
      await page.waitForFunction(() => {
        return [...document.querySelectorAll('article')]
          .some((article) => article.textContent?.includes('Fake Codex received: Browser screenshot context:')
            && article.textContent.includes('local-images:1'))
      }, { timeout: 10_000 })
      await openCommandPalette(page)
      await page.getByPlaceholder('Run command or switch repo...').fill('send latest browser screenshot')
      const sendLatestBrowserScreenshotAction = page.locator('[cmdk-item]').filter({ hasText: 'Send latest browser screenshot to chat' }).first()
      await sendLatestBrowserScreenshotAction.waitFor({ timeout: 10_000 })
      if (await sendLatestBrowserScreenshotAction.getAttribute('aria-disabled') === 'true') {
        throw new Error(`Send latest browser screenshot action was disabled: ${await sendLatestBrowserScreenshotAction.textContent()}`)
      }
      await sendLatestBrowserScreenshotAction.click()
      await page.waitForFunction(() => {
        return [...document.querySelectorAll('[data-composer-input="true"]')]
          .some((textarea) => (textarea.textContent ?? '').includes('Browser screenshot context:'))
      }, { timeout: 10_000 })
      await page.getByLabel('Send message').click()
      await page.waitForFunction(() => {
        return [...document.querySelectorAll('article')]
          .filter((article) => article.textContent?.includes('Fake Codex received: Browser screenshot context:')
            && article.textContent.includes('local-images:1')).length >= 2
      }, { timeout: 10_000 })
      await openCommandPalette(page)
      await page.getByPlaceholder('Run command or switch repo...').fill('open latest browser screenshot')
      const openLatestBrowserScreenshotAction = page.locator('[cmdk-item]').filter({ hasText: 'Open latest browser screenshot' }).first()
      await openLatestBrowserScreenshotAction.waitFor({ timeout: 10_000 })
      if (await openLatestBrowserScreenshotAction.getAttribute('aria-disabled') === 'true') {
        throw new Error(`Open latest browser screenshot action was disabled: ${await openLatestBrowserScreenshotAction.textContent()}`)
      }
      await page.keyboard.press('Escape')
      await openCommandPalette(page)
      await page.getByPlaceholder('Run command or switch repo...').fill('reveal latest browser screenshot')
      const revealLatestBrowserScreenshotAction = page.locator('[cmdk-item]').filter({ hasText: 'Reveal latest browser screenshot in Finder' }).first()
      await revealLatestBrowserScreenshotAction.waitFor({ timeout: 10_000 })
      if (await revealLatestBrowserScreenshotAction.getAttribute('aria-disabled') === 'true') {
        throw new Error(`Reveal latest browser screenshot action was disabled: ${await revealLatestBrowserScreenshotAction.textContent()}`)
      }
      await page.keyboard.press('Escape')
      await openCommandPalette(page)
      await page.getByPlaceholder('Run command or switch repo...').fill('copy latest browser screenshot path')
      const copyLatestBrowserScreenshotPathAction = page.locator('[cmdk-item]').filter({ hasText: 'Copy latest browser screenshot path' }).first()
      await copyLatestBrowserScreenshotPathAction.waitFor({ timeout: 10_000 })
      if (await copyLatestBrowserScreenshotPathAction.getAttribute('aria-disabled') === 'true') {
        throw new Error(`Copy latest browser screenshot path action was disabled: ${await copyLatestBrowserScreenshotPathAction.textContent()}`)
      }
      await copyLatestBrowserScreenshotPathAction.click()
      await page.waitForFunction(async () => {
        const text = await navigator.clipboard.readText()
        return text.includes('browser-captures') && text.endsWith('.png')
      }, { timeout: 10_000 })

      smokeStep('visual theme and window matrix')
      await waitForVisibleToastsToClear(page)
      await page.getByLabel('Switch to Smoke Codex Thread').click()
      if (typographyUat) {
        const typographyComposer = page.getByRole('textbox', { name: 'Chat message' })
        await typographyComposer.fill('Mermaid typography smoke:\n```mermaid\ngraph LR\n  A[Plan] --> B[Build]\n```')
        await page.getByLabel('Send message').click()
        await page.waitForFunction(() => (
          [...document.querySelectorAll('[data-mermaid-diagram="true"]')]
            .some((diagram) => diagram.getAttribute('data-mermaid-render-key') !== 'loading' && diagram.querySelector('svg'))
        ), undefined, { timeout: 20_000 })
      }
      const captureAppearance = async (theme, preset) => {
        await page.getByLabel('Open settings').click()
        await page.getByRole('button', { name: 'Appearance', exact: true }).click()
        await page.getByRole('group', { name: 'Theme' }).getByRole('button', { name: theme }).click()
        await page.getByRole('group', { name: 'Interface text size' }).getByRole('button', { name: preset }).click()
        await page.waitForFunction(({ expectedTheme, expectedPreset }) => (
          document.documentElement.dataset.theme === expectedTheme
          && document.documentElement.dataset.typePreset === expectedPreset
        ), { expectedTheme: theme.toLowerCase(), expectedPreset: preset.toLowerCase() })
        await page.getByLabel('Close settings').click()
        await page.getByLabel('Close settings').waitFor({ state: 'detached', timeout: 10_000 })
        if (typographyUat) {
          const expectedFontSize = { Compact: '12px', Standard: '13px', Large: '14px' }[preset]
          const expectedRenderKey = `${theme.toLowerCase()}:${preset.toLowerCase()}:${expectedFontSize}`
          await page.waitForFunction((renderKey) => {
            const diagrams = [...document.querySelectorAll('[data-mermaid-diagram="true"]')]
            return diagrams.length > 0 && diagrams.every((diagram) => (
              diagram.getAttribute('data-mermaid-render-key') === renderKey && diagram.querySelector('svg')
            ))
          }, expectedRenderKey, { timeout: 20_000 })
          await assertRenderedTypography(page, preset.toLowerCase())
        }
        await captureSmokeScreenshot(page, `workspace-chat-${theme.toLowerCase()}-${preset.toLowerCase()}`)
      }
      for (const theme of ['Light', 'Dark']) {
        for (const preset of ['Compact', 'Standard', 'Large']) {
          await captureAppearance(theme, preset)
        }
      }
      await page.getByLabel('Add context').click()
      await page.getByText('Add to chat', { exact: true }).waitFor({ timeout: 10_000 })
      await captureSmokeScreenshot(page, 'dropdown-add-context-dark-large')
      await scrollOpenSurface(page, page.locator('[data-add-menu="true"]'), 'add-menu-dark-large')
      await captureSmokeScreenshot(page, 'dropdown-add-context-dark-large-scrolled')
      await page.keyboard.press('Escape')
      await page.getByRole('button', { name: /Approval policy:/ }).click()
      await page.getByText('Approval policy', { exact: true }).last().waitFor({ timeout: 10_000 })
      await captureSmokeScreenshot(page, 'dropdown-approval-dark-large')
      await page.keyboard.press('Escape')
      await page.getByRole('button', { name: 'Configure model, reasoning, and speed' }).click()
      await page.getByRole('menuitem', { name: /GPT-5\.4-Mini/ }).hover()
      const darkLargeModelMenu = page.locator('[data-model-selector-submenu="model"]')
      await darkLargeModelMenu.waitFor({ timeout: 10_000 })
      await captureSmokeScreenshot(page, 'dropdown-model-dark-large')
      await scrollOpenSurface(page, darkLargeModelMenu, 'model-menu-dark-large')
      await captureSmokeScreenshot(page, 'dropdown-model-dark-large-scrolled')
      await page.keyboard.press('Escape')
      await page.keyboard.press('Escape')
      await openCommandPalette(page)
      await captureSmokeScreenshot(page, 'command-palette-dark')
      await page.keyboard.press('Escape')
      await page.getByPlaceholder('Run command or switch repo...').waitFor({ state: 'detached', timeout: 10_000 })
      await page.getByRole('tab', { name: /Agents/ }).click()
      await captureSmokeScreenshot(page, 'agents-dark')
      await page.getByTitle('GitHub').click()
      await page.getByText('fraction12/Cranberri', { exact: true }).waitFor({ timeout: 10_000 })
      await page.getByText('Loading repo', { exact: true }).waitFor({ state: 'detached', timeout: 15_000 })
      await captureSmokeScreenshot(page, 'github-panel-dark')
      await page.getByTitle('Repo processes').click()
      await page.getByText('Cranberri terminal', { exact: true }).waitFor({ timeout: 10_000 })
      await captureSmokeScreenshot(page, 'processes-panel-dark')

      await resizeMainWindow(electronApp, 900, 600, 900, 600)
      await page.waitForFunction(() => window.innerWidth <= 920 && window.innerHeight <= 620)
      await page.waitForFunction(() => document.documentElement.scrollWidth <= window.innerWidth + 1)
      await page.waitForFunction(() => (
        [...document.querySelectorAll('button')]
          .some((button) => button.getAttribute('aria-label')?.startsWith('Scroll tabs ') && button.getClientRects().length > 0)
      ))
      await page.locator('[data-chat-transcript-scroll="true"]').evaluate((element) => {
        element.scrollTop = element.scrollHeight
      })
      await page.waitForFunction(() => {
        const composer = document.querySelector('[data-chat-composer="true"]')
        const transcriptEnd = document.querySelector('[data-chat-transcript-end="true"]')
        if (!composer || !transcriptEnd) return false
        return transcriptEnd.getBoundingClientRect().bottom <= composer.getBoundingClientRect().top
      })
      await captureSmokeScreenshot(page, 'workspace-narrow-dark')
      const narrowComposer = page.getByRole('textbox', { name: 'Chat message' })
      const narrowComposerInitialHeight = await page.locator('[data-chat-composer="true"]').evaluate((element) => (
        element.getBoundingClientRect().height
      ))
      await narrowComposer.fill(Array.from({ length: 40 }, (_, index) => `Pinned transcript line ${index + 1}`).join('\n'))
      await page.waitForFunction((initialHeight) => {
        const composerRoot = document.querySelector('[data-chat-composer="true"]')
        const transcriptEnd = document.querySelector('[data-chat-transcript-end="true"]')
        if (!(composerRoot instanceof HTMLElement) || !(transcriptEnd instanceof HTMLElement)) return false
        return composerRoot.getBoundingClientRect().height >= initialHeight + 80
          && transcriptEnd.getBoundingClientRect().bottom <= composerRoot.getBoundingClientRect().top
      }, narrowComposerInitialHeight, { timeout: 10_000 })
      await captureSmokeScreenshot(page, 'workspace-narrow-long-composer-dark')
      await narrowComposer.fill('')
      const wideSize = await electronApp.evaluate(({ BrowserWindow, screen }) => {
        const window = BrowserWindow.getAllWindows()[0]
        if (!window) throw new Error('Main window not found')
        const workArea = screen.getDisplayMatching(window.getBounds()).workAreaSize
        return {
          width: Math.max(900, Math.min(1800, workArea.width)),
          height: Math.max(600, Math.min(1100, workArea.height)),
        }
      })
      await resizeMainWindow(electronApp, wideSize.width, wideSize.height, 900, 600)
      await page.waitForFunction(({ width, height }) => (
        window.innerWidth >= width - 80 && window.innerHeight >= height - 100
      ), wideSize)
      await captureSmokeScreenshot(page, 'workspace-wide-dark')
      await resizeMainWindow(electronApp, 1400, 900, 900, 600)
      await page.waitForFunction(() => window.innerWidth > 1300 && window.innerHeight > 800)

      smokeStep('session management')
      await openCommandPalette(page)
      await page.getByPlaceholder('Run command or switch repo...').fill('pin active chat')
      const pinActiveChatAction = page.locator('[cmdk-item]').filter({ hasText: 'Pin active chat' }).first()
      await pinActiveChatAction.waitFor({ timeout: 10_000 })
      if (await pinActiveChatAction.getAttribute('aria-disabled') === 'true') {
        throw new Error(`Pin active chat action was disabled: ${await pinActiveChatAction.textContent()}`)
      }
      await pinActiveChatAction.click()
      await page.waitForFunction(async (projectId) => {
        const state = await window.cranberri.appState.read()
        return (state.pinnedCodexSessionsByProjectId[projectId] ?? []).length > 0
      }, 'smoke-repo', { timeout: 10_000 })

      await openCommandPalette(page)
      await page.getByPlaceholder('Run command or switch repo...').fill('unpin active chat')
      const unpinActiveChatAction = page.locator('[cmdk-item]').filter({ hasText: 'Unpin active chat' }).first()
      await unpinActiveChatAction.waitFor({ timeout: 10_000 })
      if (await unpinActiveChatAction.getAttribute('aria-disabled') === 'true') {
        throw new Error(`Unpin active chat action was disabled: ${await unpinActiveChatAction.textContent()}`)
      }
      await unpinActiveChatAction.click()
      await page.waitForFunction(async (projectId) => {
        const state = await window.cranberri.appState.read()
        return (state.pinnedCodexSessionsByProjectId[projectId] ?? []).length === 0
      }, 'smoke-repo', { timeout: 10_000 })

      await openCommandPalette(page)
      await page.getByPlaceholder('Run command or switch repo...').fill('rename active chat')
      const renameActiveChatAction = page.locator('[cmdk-item]').filter({ hasText: 'Rename active chat' }).first()
      await renameActiveChatAction.waitFor({ timeout: 10_000 })
      if (await renameActiveChatAction.getAttribute('aria-disabled') === 'true') {
        throw new Error(`Rename active chat action was disabled: ${await renameActiveChatAction.textContent()}`)
      }
      await renameActiveChatAction.click()
      const renameDialog = page.getByRole('dialog', { name: 'Rename session' })
      await renameDialog.waitFor({ timeout: 10_000 })
      await captureSmokeScreenshot(page, 'rename-session-dialog-dark')
      await renameDialog.getByRole('textbox', { name: 'Name' }).fill('Renamed Smoke Codex Thread')
      await renameDialog.getByRole('button', { name: 'Rename' }).click()
      await page.waitForFunction(async (targetRepoPath) => {
        const result = await window.cranberri.codex.listThreads(targetRepoPath, { archived: false, limit: 20 })
        return result.sessions.some((session) => session.title === 'Renamed Smoke Codex Thread')
      }, repoPath, { timeout: 10_000 })

      await openCommandPalette(page)
      await page.getByPlaceholder('Run command or switch repo...').fill('archive active chat')
      const archiveActiveChatAction = page.locator('[cmdk-item]').filter({ hasText: 'Archive active chat' }).first()
      await archiveActiveChatAction.waitFor({ timeout: 10_000 })
      if (await archiveActiveChatAction.getAttribute('aria-disabled') === 'true') {
        throw new Error(`Archive active chat action was disabled: ${await archiveActiveChatAction.textContent()}`)
      }
      await archiveActiveChatAction.click()
      await page.waitForFunction(async (targetRepoPath) => {
        const result = await window.cranberri.codex.listThreads(targetRepoPath, { archived: true, limit: 20 })
        return result.sessions.some((session) => session.archived)
      }, repoPath, { timeout: 10_000 })

      smokeStep('cross-repo session management')
      const secondaryRepoName = path.basename(secondaryRepoPath)
      const secondaryRepo = page.locator('[data-repo-id="smoke-repo-secondary"]')
      await secondaryRepo.hover()
      await secondaryRepo.getByRole('button', { name: `New session in ${secondaryRepoName}` }).click()
      await page.getByRole('menuitem', { name: /New Local session/ }).click()
      await page.waitForFunction(async () => (await window.cranberri.repos.list()).activeRepoId === 'smoke-repo-secondary', undefined, { timeout: 10_000 })
      await page.getByRole('tab', { name: 'Switch to New local session' }).waitFor({ timeout: 10_000 })
      const secondaryComposer = page.getByRole('textbox', { name: 'Chat message' })
      await secondaryComposer.fill('cranberri local promotion smoke')
      await page.getByLabel('Send message').click()
      await page.getByText('Fake Codex received: cranberri local promotion smoke').waitFor({ timeout: 20_000 })
      await page.getByText('cranberri-fake-codex-stream-complete').last().waitFor({ timeout: 20_000 })
      await page.getByRole('button', { name: 'Task actions' }).click()
      await page.getByRole('menuitem', { name: 'Continue in worktree' }).click()
      await page.getByText('Worktree · from main', { exact: true }).waitFor({ timeout: 20_000 })
      await page.waitForFunction(async () => {
        const snapshot = await window.cranberri.tasks.snapshot()
        return snapshot.tasks.some((task) => task.projectId === 'smoke-repo-secondary'
          && task.location === 'worktree'
          && task.threadId)
      }, undefined, { timeout: 20_000 })
      await captureSmokeScreenshot(page, 'local-session-continued-in-worktree')
      const handoffIdentity = await page.evaluate(async () => {
        const snapshot = await window.cranberri.tasks.snapshot()
        const task = snapshot.tasks.find((candidate) => candidate.projectId === 'smoke-repo-secondary'
          && candidate.location === 'worktree'
          && candidate.threadId)
        if (!task) throw new Error('Continued worktree task was not found')
        const worktree = snapshot.managedWorktrees.find((candidate) => candidate.id === task.worktreeId)
        if (!worktree) throw new Error('Continued worktree record was not found')
        return { taskId: task.id, worktreePath: worktree.path, proposedBranch: `codex/task-${task.id.slice(0, 8)}` }
      })
      await page.getByRole('button', { name: 'Task actions' }).click()
      await page.getByRole('menuitem', { name: 'Test in Local' }).click()
      const localHandoffDialog = page.getByRole('dialog', { name: 'Test branch in Local?' })
      await localHandoffDialog.getByRole('textbox', { name: 'Branch' }).waitFor({ timeout: 10_000 })
      if (await localHandoffDialog.getByRole('textbox', { name: 'Branch' }).inputValue() !== handoffIdentity.proposedBranch) {
        throw new Error('Detached worktree did not propose a new task branch')
      }
      await localHandoffDialog.getByRole('button', { name: 'Continue' }).click()
      await page.getByText(`Local · ${handoffIdentity.proposedBranch}`, { exact: true }).waitFor({ timeout: 20_000 })
      await page.waitForFunction(async ({ taskId, proposedBranch }) => {
        const status = await window.cranberri.tasks.status(taskId)
        const repos = await window.cranberri.repos.list()
        const project = repos.projects.find((candidate) => candidate.id === status.task.projectId)
        return status.task.location === 'local'
          && status.task.checkoutId === project?.localCheckoutId
          && status.worktree?.branch === proposedBranch
      }, handoffIdentity, { timeout: 20_000 })
      await page.getByRole('button', { name: 'Task actions' }).click()
      await page.getByRole('menuitem', { name: 'Return to worktree' }).click()
      const worktreeHandoffDialog = page.getByRole('dialog', { name: 'Move branch to a worktree?' })
      await worktreeHandoffDialog.getByRole('textbox', { name: 'Branch' }).waitFor({ timeout: 10_000 })
      await worktreeHandoffDialog.getByRole('button', { name: 'Continue' }).click()
      await page.getByText(`Worktree · ${handoffIdentity.proposedBranch}`, { exact: true }).waitFor({ timeout: 20_000 })
      await page.waitForFunction(async ({ taskId, worktreePath }) => {
        const status = await window.cranberri.tasks.status(taskId)
        return status.task.location === 'worktree' && status.worktree?.path === worktreePath
      }, handoffIdentity, { timeout: 20_000 })
      if (handoffUatOnly) return
      await page.evaluate(async () => {
        const created = await window.cranberri.tasks.createWorktreeDraft({
          projectId: 'smoke-repo-secondary',
          title: 'Renamed Smoke Codex Thread',
          baseRef: 'refs/heads/main',
          environmentId: null,
          environmentRevision: null,
          input: [{ type: 'text', text: 'secondary repo smoke task' }],
        })
        await window.cranberri.tasks.provision({ taskId: created.task.id, includeLocalChanges: false })
        await window.cranberri.tasks.send({
          taskId: created.task.id,
          input: [{ type: 'text', text: 'secondary repo smoke task' }],
        })
        const snapshot = await window.cranberri.tasks.snapshot()
        const task = snapshot.tasks.find((candidate) => candidate.id === created.task.id)
        if (!task?.threadId) throw new Error('Secondary smoke task did not create a thread')
        await window.cranberri.codex.renameThread('', task.threadId, 'Renamed Smoke Codex Thread')
        await window.cranberri.tasks.archive(task.id)
      })
      await secondaryRepo.getByRole('button', { name: `Expand sessions for ${secondaryRepoName}` }).click()
      await secondaryRepo.getByRole('button', { name: /Show archived/ }).click()

      let inactiveSession = secondaryRepo.locator('[data-session-id]').filter({ hasText: 'Renamed Smoke Codex Thread' }).first()
      await inactiveSession.waitFor({ timeout: 10_000 })
      await inactiveSession.getByRole('button', { name: 'Options for Renamed Smoke Codex Thread' }).click()
      await page.getByRole('menuitem', { name: 'Unarchive' }).click()

      inactiveSession = secondaryRepo.locator('[data-session-id]').filter({ hasText: 'Renamed Smoke Codex Thread' }).first()
      await inactiveSession.waitFor({ timeout: 10_000 })
      await inactiveSession.getByRole('button', { name: 'Options for Renamed Smoke Codex Thread' }).click()
      await page.getByRole('menuitem', { name: 'Rename' }).click()
      const inactiveRenameDialog = page.getByRole('dialog', { name: 'Rename session' })
      await inactiveRenameDialog.getByRole('textbox', { name: 'Session name' }).fill('Inactive Repo Managed Session')
      await inactiveRenameDialog.getByRole('button', { name: 'Rename' }).click()

      inactiveSession = secondaryRepo.locator('[data-session-id]').filter({ hasText: 'Inactive Repo Managed Session' }).first()
      await inactiveSession.waitFor({ timeout: 10_000 })
      await inactiveSession.getByRole('button', { name: 'Options for Inactive Repo Managed Session' }).click()
      await page.getByRole('menuitem', { name: 'Archive' }).click()

      inactiveSession = secondaryRepo.locator('[data-session-id]').filter({ hasText: 'Inactive Repo Managed Session' }).first()
      await inactiveSession.waitFor({ timeout: 10_000 })
      const inactiveSessionOptionsLabel = 'Options for Inactive Repo Managed Session'
      await inactiveSession.getByRole('button', { name: inactiveSessionOptionsLabel }).click()
      await page.getByRole('menuitem', { name: 'Delete' }).waitFor({ timeout: 10_000 })
      await page.waitForFunction(() => {
        const toasts = [...document.querySelectorAll('[data-sonner-toast][data-visible="true"]')]
          .filter((toast) => getComputedStyle(toast).opacity !== '0')
        if (toasts.length === 0) return false
        const expectedTitleSize = getComputedStyle(document.documentElement).getPropertyValue('--app-type-control-size').trim()
        const frontToasts = toasts.filter((toast) => toast.getAttribute('data-front') === 'true')
        const titleMetricsMatch = frontToasts.every((toast) => {
          const title = toast.querySelector('[data-title]')
          return !title || getComputedStyle(title).fontSize === expectedTitleSize
        })
        const backgroundContentHidden = toasts
          .filter((toast) => toast.getAttribute('data-front') !== 'true')
          .every((toast) => [...toast.children].every((child) => getComputedStyle(child).opacity === '0'))
        return frontToasts.length === 1 && titleMetricsMatch && backgroundContentHidden
      }, undefined, { timeout: 10_000 })
      await captureSmokeScreenshot(page, 'dropdown-session-options-dark-large')
      await page.getByRole('menuitem', { name: 'Delete' }).click()
      let inactiveDeleteDialog = page.getByRole('dialog', { name: 'Delete session' })
      await inactiveDeleteDialog.waitFor({ timeout: 10_000 })
      await page.keyboard.press('Escape')
      await inactiveDeleteDialog.waitFor({ state: 'detached', timeout: 10_000 })
      await page.waitForFunction((label) => document.activeElement?.getAttribute('aria-label') === label, inactiveSessionOptionsLabel, { timeout: 10_000 })
      await inactiveSession.getByRole('button', { name: inactiveSessionOptionsLabel }).click()
      await page.getByRole('menuitem', { name: 'Delete' }).click()
      inactiveDeleteDialog = page.getByRole('dialog', { name: 'Delete session' })
      await inactiveDeleteDialog.getByRole('button', { name: 'Delete' }).click()
      await inactiveSession.waitFor({ state: 'detached', timeout: 10_000 })
      smokeStep('repo workspace assertions complete')
    })
  } finally {
    smokeStep('repo workspace cleanup')
    await closeElectronApp(electronApp)
    fs.rmSync(userDataDir, { recursive: true, force: true })
    fs.rmSync(fixtureRoot, { recursive: true, force: true })
  }
}

const smokeOnly = process.env.CRANBERRI_SMOKE_ONLY
const validSmokeModes = new Set(['fresh', 'idle', 'repo', 'sessions', 'real'])
if (smokeOnly && !validSmokeModes.has(smokeOnly)) {
  throw new Error(`Unknown CRANBERRI_SMOKE_ONLY mode: ${smokeOnly}`)
}
if (typographyUat && smokeOnly !== 'repo') {
  throw new Error('Typography UAT must run with CRANBERRI_SMOKE_ONLY=repo.')
}
if (dropdownUat && smokeOnly !== 'repo') {
  throw new Error('Dropdown UAT must run with CRANBERRI_SMOKE_ONLY=repo.')
}
if (!smokeOnly || smokeOnly === 'fresh') await runFreshStartupSmoke()
if (!smokeOnly || smokeOnly === 'fresh' || smokeOnly === 'idle') await runIdleToolCatalogSmoke()
if (!smokeOnly || smokeOnly === 'repo') await runRepoWorkspaceSmoke()
if (!smokeOnly || smokeOnly === 'sessions') await runSessionWorkspaceSmoke()
if (smokeOnly === 'real') await runRealCodexSmoke()

if (typographyUat) {
  const missing = REQUIRED_TYPOGRAPHY_UAT_CAPTURES.filter((name) => (
    !capturedSmokeScreenshots.has(name)
    || !fs.existsSync(path.join(smokeScreenshotDir, `${name}.png`))
  ))
  fs.writeFileSync(path.join(smokeScreenshotDir, 'typography-uat-manifest.json'), JSON.stringify({
    expected: REQUIRED_TYPOGRAPHY_UAT_CAPTURES,
    captured: [...capturedSmokeScreenshots].sort(),
    missing,
  }, null, 2))
  if (missing.length > 0) throw new Error(`Typography UAT captures missing: ${missing.join(', ')}`)
}

console.log('Electron smoke passed')
