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

if (!fs.existsSync(appExecutable)) {
  throw new Error(`Packaged app not found at ${appExecutable}. Run npm run package:dir first.`)
}

function createFixtureRepo(rootDir) {
  const repoPath = path.join(rootDir, 'cranberri-smoke-repo')
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
  fs.appendFileSync(path.join(repoPath, 'README.md'), 'Modified marker: cranberri-diff-smoke-ready.\n')
  return repoPath
}

function seedRegisteredRepo(userDataDir, repoPath) {
  fs.writeFileSync(path.join(userDataDir, 'repos.json'), JSON.stringify({
    repos: [{
      id: 'smoke-repo',
      name: path.basename(repoPath),
      path: repoPath,
    }],
    activeRepoId: 'smoke-repo',
  }, null, 2))
}

function smokeStep(label) {
  console.log(`[smoke] ${label}`)
}

async function captureSmokeScreenshot(page, name) {
  if (!smokeScreenshotDir) return
  fs.mkdirSync(smokeScreenshotDir, { recursive: true })
  await page.screenshot({ path: path.join(smokeScreenshotDir, `${name}.png`) })
}

async function launchApp(userDataDir, extraEnv = {}) {
  return electron.launch({
    executablePath: appExecutable,
    env: {
      ...process.env,
      CRANBERRI_USER_DATA_DIR: userDataDir,
      ...extraEnv,
    },
  })
}

async function mainWindowChildViewCount(electronApp) {
  return electronApp.evaluate(({ BrowserWindow }) => (
    BrowserWindow.getAllWindows()[0]?.contentView.children.length ?? -1
  ))
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

  try {
    await run(page)
  } catch (error) {
    const diagnostics = [
      pageErrors.length > 0 ? `Renderer page errors:\n${pageErrors.join('\n')}` : null,
      consoleErrors.length > 0 ? `Renderer console errors:\n${consoleErrors.join('\n')}` : null,
    ].filter(Boolean).join('\n')
    if (diagnostics) throw new Error(`${error instanceof Error ? error.message : String(error)}\n${diagnostics}`, { cause: error })
    throw error
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

async function clickButtonByTitle(page, title, timeout = 10_000) {
  await page.waitForFunction((expectedTitle) => {
    return [...document.querySelectorAll('button')]
      .some((button) => button.getAttribute('title') === expectedTitle)
  }, title, { timeout })
  await page.evaluate((expectedTitle) => {
    const button = [...document.querySelectorAll('button')]
      .find((node) => node.getAttribute('title') === expectedTitle)
    if (!button) throw new Error(`Button not found: ${expectedTitle}`)
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  }, title)
}

async function waitForAssistantArticleText(page, text, minimumCount = 1, timeout = 10_000) {
  await page.waitForFunction(({ expectedText, count }) => {
    return [...document.querySelectorAll('article')]
      .filter((article) => article.textContent?.includes(expectedText))
      .length >= count
  }, { expectedText: text, count: minimumCount }, { timeout })
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
      const pendingResultDeadline = Date.now() + 10_000
      while (fs.existsSync(pendingUpdateResultPath) && Date.now() < pendingResultDeadline) {
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
      if (fs.existsSync(pendingUpdateResultPath)) throw new Error('Pending update result was not cleared after its toast')
      await page.getByText('No repo selected').waitFor({ timeout: 10_000 })

      await page.getByLabel('Open settings').click()
      await page.getByText('Settings').waitFor({ timeout: 10_000 })
      const defaultModel = page.getByLabel('Default model')
      const defaultEffort = page.getByLabel('Default reasoning effort')
      const defaultSpeed = page.getByLabel('Default speed')
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
      await page.getByRole('button', { name: 'Increase Interface font size' }).click()
      await page.waitForFunction(() => (
        document.documentElement.style.getPropertyValue('--app-ui-font-size') === '15px'
        && getComputedStyle(document.documentElement).fontSize === '16px'
      ))
      await captureSmokeScreenshot(page, 'appearance-light')
      if (smokeScreenshotDir) {
        await page.getByRole('group', { name: 'Theme' }).getByRole('button', { name: 'Dark' }).click()
        await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark')
        await captureSmokeScreenshot(page, 'appearance-dark')
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
      await page.getByRole('button', { name: 'Extensions' }).click()
      await page.getByRole('heading', { name: 'Extensions' }).waitFor({ timeout: 10_000 })
      await page.getByRole('button', { name: 'Installed' }).waitFor({ timeout: 10_000 })
      const settingsContent = page.locator('main[aria-live="polite"]')
      await settingsContent.evaluate((element) => { element.scrollTop = element.scrollHeight })
      await page.getByRole('button', { name: 'Updates' }).click()
      await page.getByRole('heading', { name: 'Updates' }).waitFor({ timeout: 10_000 })
      await page.waitForFunction(() => document.querySelector('main[aria-live="polite"]')?.scrollTop === 0)
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
      await page.getByPlaceholder('Run command or switch repo...').fill('settings')
      await page.getByText('Open settings').waitFor({ timeout: 10_000 })
      await page.keyboard.press('Escape')
      await page.getByPlaceholder('Run command or switch repo...').waitFor({ state: 'detached', timeout: 10_000 })
    })
  } finally {
    await closeElectronApp(electronApp)
    fs.rmSync(userDataDir, { recursive: true, force: true })
  }
}

async function runRepoWorkspaceSmoke() {
  smokeStep('repo workspace setup')
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cranberri-smoke-repo-'))
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cranberri-smoke-fixture-'))
  const repoPath = createFixtureRepo(fixtureRoot)
  seedRegisteredRepo(userDataDir, repoPath)
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
      await resizeMainWindow(electronApp, 900, 280, 800, 240)
      await page.waitForFunction(() => window.innerHeight < 320)
      const modelSelector = page.getByRole('button', { name: 'Configure model, reasoning, and speed' })
      await modelSelector.click()
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
      if (submenuMetrics.overflowY !== 'auto' || submenuMetrics.scrollHeight <= submenuMetrics.clientHeight) {
        throw new Error(`Model submenu is not scrollable in a constrained window: ${JSON.stringify(submenuMetrics)}`)
      }
      await modelSubmenu.hover()
      await page.mouse.wheel(0, 240)
      await page.waitForFunction(() => {
        const submenu = document.querySelector('[data-model-selector-submenu="model"]')
        return submenu instanceof HTMLElement && submenu.scrollTop > 0
      })
      await modelSubmenu.waitFor({ state: 'visible', timeout: 2_000 })
      await captureSmokeScreenshot(page, 'model-selector')
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
      await modelSelector.click()
      await page.getByRole('menuitemradio', { name: 'Ultra', exact: true }).click()
      await modelSelector.click()
      await page.getByRole('menuitem', { name: 'Speed', exact: true }).hover()
      await page.getByRole('menuitemradio', { name: /Fast 1\.5x speed/ }).click()
      await modelSelector.click()
      await page.getByRole('menuitem', { name: /GPT-5\.6-Sol/ }).hover()
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
      await composer.fill(Array.from({ length: 40 }, (_, index) => `Long composer line ${index + 1}`).join('\n'))
      await page.waitForFunction(() => {
        const textarea = document.querySelector('textarea[aria-label="Chat message"]')
        if (!(textarea instanceof HTMLTextAreaElement)) return false
        return textarea.clientHeight <= 160
          && textarea.scrollHeight > textarea.clientHeight
          && getComputedStyle(textarea).overflowY === 'auto'
      }, undefined, { timeout: 10_000 })
      await composer.evaluate((textarea) => {
        textarea.scrollTop = textarea.scrollHeight
        textarea.dispatchEvent(new Event('scroll'))
      })
      await page.waitForFunction(() => {
        const viewport = document.querySelector('[data-composer-viewport="true"]')
        const ghost = document.querySelector('[data-composer-ghost="true"]')
        const textarea = document.querySelector('textarea[aria-label="Chat message"]')
        if (!(viewport instanceof HTMLElement) || !(ghost instanceof HTMLElement) || !(textarea instanceof HTMLTextAreaElement)) return false
        return viewport.getBoundingClientRect().height <= 160
          && ghost.style.transform.includes(`${-textarea.scrollTop}px`)
      }, undefined, { timeout: 10_000 })
      await captureSmokeScreenshot(page, 'composer-long-message')
      await composer.fill('')
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
      await page.getByText('Stages all current changes and commits them.').waitFor({ timeout: 10_000 })
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
        return [...document.querySelectorAll('textarea')]
          .some((textarea) => textarea.value.includes('Repo file context:') && textarea.value.includes('cranberri-diff-smoke-ready'))
      }, { timeout: 10_000 })
      await page.getByLabel('Send message').click()
      await page.getByText('Fake Codex received: Repo file context:').waitFor({ timeout: 10_000 })
      await page.getByRole('button', { name: 'Files' }).click()

      await page.getByPlaceholder('Ask for follow-up changes').fill('cranberri-model-settings-smoke')
      await page.getByLabel('Send message').click()
      await page.getByText('settings:gpt-5.4-mini|medium|standard').waitFor({ timeout: 10_000 })

      await page.getByPlaceholder('Ask for follow-up changes').waitFor({ timeout: 10_000 })
      await page.getByPlaceholder('Ask for follow-up changes').fill('cranberri fake codex smoke')
      await page.getByLabel('Send message').click()
      await page.getByText('Fake Codex received: cranberri fake codex smoke').waitFor({ timeout: 10_000 })
      await page.getByText('cranberri-fake-codex-stream-complete').last().waitFor({ timeout: 10_000 })
      await page.getByPlaceholder('Ask for follow-up changes').fill('cranberri-smoke-reject-turn')
      await page.getByLabel('Send message').click()
      await page.getByText('Error: Fake Codex rejected turn').waitFor({ timeout: 10_000 })
      await page.getByPlaceholder('Ask for follow-up changes').fill('cranberri fake codex smoke')
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
        return [...document.querySelectorAll('textarea')]
          .some((textarea) => textarea.value.includes('User prompt context:')
            && textarea.value.includes('cranberri fake codex smoke'))
      }, { timeout: 10_000 })
      await page.getByLabel('Send message').click()
      await waitForAssistantArticleText(page, 'Fake Codex received: User prompt context:')
      await openCommandPalette(page)
      await page.getByPlaceholder('Run command or switch repo...').fill('send latest response to chat')
      await page.locator('[cmdk-item]').filter({ hasText: 'Send latest response to chat' }).first().click()
      await page.waitForFunction(() => {
        return [...document.querySelectorAll('textarea')]
          .some((textarea) => textarea.value.includes('Assistant response context:')
            && textarea.value.includes('cranberri fake codex smoke'))
      }, { timeout: 10_000 })
      await page.getByLabel('Send message').click()
      await waitForAssistantArticleText(page, 'Fake Codex received: Assistant response context:')
      await openCommandPalette(page)
      await page.getByPlaceholder('Run command or switch repo...').fill('copy latest response')
      await page.locator('[cmdk-item]').filter({ hasText: 'Copy latest response' }).first().click()
      await page.getByText('Copy latest response').waitFor({ timeout: 10_000 })
      await page.getByLabel('Send response to chat').last().click()
      await page.waitForFunction(() => {
        return [...document.querySelectorAll('textarea')]
          .some((textarea) => textarea.value.includes('Assistant response context:')
            && textarea.value.includes('cranberri fake codex smoke'))
      }, { timeout: 10_000 })
      await page.getByLabel('Send message').click()
      await waitForAssistantArticleText(page, 'Fake Codex received: Assistant response context:', 2)
      await openCommandPalette(page)
      await page.getByPlaceholder('Run command or switch repo...').fill('transcript cranberri fake codex smoke')
      const transcriptMessageAction = page.locator('[cmdk-item]').filter({ hasText: 'Send transcript message to chat:' }).first()
      await transcriptMessageAction.waitFor({ timeout: 10_000 })
      await transcriptMessageAction.click()
      await page.waitForFunction(() => {
        return [...document.querySelectorAll('textarea')]
          .some((textarea) => (textarea.value.includes('Assistant response context:')
            || textarea.value.includes('User prompt context:'))
            && textarea.value.includes('cranberri fake codex smoke'))
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
      await page.getByPlaceholder('Ask for follow-up changes').fill([
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
      await page.getByPlaceholder('Ask for follow-up changes').fill([
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
      await page.getByPlaceholder('Ask for follow-up changes').fill([
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
        return [...document.querySelectorAll('textarea')]
          .some((textarea) => textarea.value.includes('Image from assistant markdown:') && textarea.value.includes('smoke-image.png'))
      }, { timeout: 10_000 })
      await page.getByLabel('Send message').click()
      await page.waitForFunction(() => {
        return [...document.querySelectorAll('article')]
          .some((article) => article.textContent?.includes('Fake Codex received: Image from assistant markdown:')
            && article.textContent.includes('local-images:1'))
      }, { timeout: 10_000 })
      await page.getByPlaceholder('Ask for follow-up changes').fill([
        'Remote image smoke:',
        '',
        '![Cranberri remote image](https://example.com/cranberri-remote-smoke.png)',
      ].join('\n'))
      await page.getByLabel('Send message').click()
      const remoteImagePreview = page.locator('[data-markdown-media="image"]').filter({ hasText: 'Cranberri remote image' }).last()
      await remoteImagePreview.waitFor({ timeout: 10_000 })
      await remoteImagePreview.getByLabel('Send image to chat').click()
      await page.waitForFunction(() => {
        return [...document.querySelectorAll('textarea')]
          .some((textarea) => textarea.value.includes('Image from assistant markdown:') && textarea.value.includes('Cranberri remote image'))
      }, { timeout: 10_000 })
      await page.getByLabel('Send message').click()
      await page.waitForFunction(() => {
        return [...document.querySelectorAll('article')]
          .some((article) => article.textContent?.includes('Fake Codex received: Image from assistant markdown:')
            && article.textContent.includes('Cranberri remote image')
            && article.textContent.includes('local-images:1'))
      }, { timeout: 10_000 })
      smokeStep('attachments and voice')
      await page.getByPlaceholder('Ask for follow-up changes').click()
      await page.evaluate(() => {
        const textarea = [...document.querySelectorAll('textarea')]
          .find((node) => node instanceof HTMLTextAreaElement && node.placeholder.includes('Ask for follow-up changes'))
        if (!(textarea instanceof HTMLTextAreaElement)) throw new Error('Composer textarea not found')
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
        return [...document.querySelectorAll('textarea')]
          .some((textarea) => textarea.value.includes('Please inspect this pasted image.'))
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
      await page.getByPlaceholder('Ask for follow-up changes').click()
      await page.evaluate((pastedPath) => {
        const textarea = [...document.querySelectorAll('textarea')]
          .find((node) => node instanceof HTMLTextAreaElement && node.placeholder.includes('Ask for follow-up changes'))
        if (!(textarea instanceof HTMLTextAreaElement)) throw new Error('Composer textarea not found')
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
        return [...document.querySelectorAll('textarea')]
          .some((textarea) => textarea.value.includes('Please inspect this pasted local file.'))
      }, { timeout: 10_000 })
      await page.getByLabel('Remove attached file README.md').waitFor({ timeout: 10_000 })
      await page.getByLabel('Send message').click()
      await page.waitForFunction((pastedPath) => {
        return [...document.querySelectorAll('article')]
          .some((article) => article.textContent?.includes('Fake Codex received: Attached local paths:')
            && article.textContent.includes(pastedPath))
      }, path.join(repoPath, 'README.md'), { timeout: 10_000 })
      await page.getByPlaceholder('Ask for follow-up changes').click()
      await page.evaluate(() => {
        const textarea = [...document.querySelectorAll('textarea')]
          .find((node) => node instanceof HTMLTextAreaElement && node.placeholder.includes('Ask for follow-up changes'))
        if (!(textarea instanceof HTMLTextAreaElement)) throw new Error('Composer textarea not found')
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
        return [...document.querySelectorAll('textarea')]
          .some((textarea) => textarea.value.includes('Please inspect this pasted screenshot.'))
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
      await page.getByPlaceholder('Ask for follow-up changes').click()
      await page.evaluate(() => {
        const textarea = [...document.querySelectorAll('textarea')]
          .find((node) => node instanceof HTMLTextAreaElement && node.placeholder.includes('Ask for follow-up changes'))
        if (!(textarea instanceof HTMLTextAreaElement)) throw new Error('Composer textarea not found')
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
        return [...document.querySelectorAll('textarea')]
          .some((textarea) => textarea.value.includes('Please inspect this dropped screenshot.'))
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
      await page.getByPlaceholder('Ask for follow-up changes').click()
      await page.evaluate((droppedPath) => {
        const textarea = [...document.querySelectorAll('textarea')]
          .find((node) => node instanceof HTMLTextAreaElement && node.placeholder.includes('Ask for follow-up changes'))
        if (!(textarea instanceof HTMLTextAreaElement)) throw new Error('Composer textarea not found')
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
        return [...document.querySelectorAll('textarea')]
          .some((textarea) => textarea.value.includes('Please inspect this dropped local file.'))
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
      await page.getByLabel('Start voice dictation').click()
      await page.waitForFunction(() => {
        return [...document.querySelectorAll('textarea')]
          .some((textarea) => textarea.value.includes('cranberri dictated smoke text'))
      }, { timeout: 10_000 })
      await page.getByLabel('Send message').click()
      await page.getByText('Fake Codex received: cranberri dictated smoke text').waitFor({ timeout: 10_000 })
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
      await openCommandPalette(page)
      await page.getByPlaceholder('Run command or switch repo...').fill('active chat context')
      const activeChatContextAction = page.locator('[cmdk-item]').filter({ hasText: 'Send active chat context' }).first()
      await activeChatContextAction.waitFor({ timeout: 10_000 })
      if (await activeChatContextAction.getAttribute('aria-disabled') === 'true') {
        throw new Error(`Active chat context action was disabled: ${await activeChatContextAction.textContent()}`)
      }
      await activeChatContextAction.click()
      await page.waitForTimeout(500)
      const activeChatTextareas = await page.locator('textarea').evaluateAll((nodes) => nodes.map((node) => node.value))
      if (!activeChatTextareas.some((value) => value.includes('Active chat context:') && value.includes('Smoke Codex Thread') && value.includes('128 / 258,400 tokens'))) {
        throw new Error(`Active chat context did not reach composer. Textareas:\n${activeChatTextareas.join('\n---\n')}`)
      }
      await page.getByLabel('Send message').click()
      await page.getByText('Fake Codex received: Active chat context:').waitFor({ timeout: 10_000 })
      await openCommandPalette(page)
      await page.getByPlaceholder('Run command or switch repo...').fill('fake codex smoke')
      await page.locator('[cmdk-item]').filter({ hasText: 'Send session match: Smoke Codex Thread' }).first().click()
      await page.waitForFunction(() => {
        return [...document.querySelectorAll('textarea')]
          .some((textarea) => textarea.value.includes('Codex session context:') && textarea.value.includes('cranberri fake codex smoke'))
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
        return [...document.querySelectorAll('textarea')]
          .some((textarea) => textarea.value.includes('Codex session context:') && textarea.value.includes('cranberri fake codex smoke'))
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
      await page.getByPlaceholder('Ask for follow-up changes').fill('cranberri-worker-smoke')
      await page.getByLabel('Send message').click()
      const workerRow = page.locator('[data-worker-id^="fake-worker-"]').first()
      await workerRow.waitFor({ timeout: 10_000 })
      await workerRow.getByText('Euclid', { exact: true }).waitFor({ timeout: 10_000 })
      await page.waitForFunction(() => {
        const worker = document.querySelector('[data-worker-id^="fake-worker-"]')
        return worker?.getAttribute('data-worker-status') === 'running'
      }, undefined, { timeout: 10_000 })
      await page.getByLabel('View Euclid').click()
      await page.getByLabel('Steer Euclid').click()
      await page.getByPlaceholder('Steer this worker...').fill('Focus on the renderer worker shelf.')
      await page.getByLabel('Send worker instruction').click()
      await page.locator('[data-worker-detail]').getByText(/Direction sent through parent|Steered:/).waitFor({ timeout: 10_000 })

      await page.getByLabel('Open Euclid').click()
      await page.getByLabel('Open parent task').waitFor({ timeout: 10_000 })
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
      await page.locator('button[aria-label="Send worker instruction"]:visible').click()
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
      const restoredWorkerTree = await page.evaluate(async (targetRepoPath) => {
        const listed = await window.cranberri.codex.listThreads(targetRepoPath, { archived: false, limit: 20 })
        const parent = listed.sessions.find((session) => session.workers?.some((worker) => worker.nickname === 'Euclid'))
        if (!parent) return null
        const restored = await window.cranberri.codex.readThread(targetRepoPath, parent.id, false)
        return {
          parentId: parent.id,
          listedStatus: parent.workers?.[0]?.status,
          restoredStatus: restored.thread.workers?.[0]?.status,
          hasHistoricalSpawn: restored.thread.turns.some((turn) => turn.items?.some((item) => item.type === 'collabAgentToolCall')),
        }
      }, repoPath)
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
      await page.getByPlaceholder('Ask for follow-up changes').fill('cranberri-approval-smoke-request')
      await page.getByLabel('Send message').click()
      await page.getByText('Install fake smoke dependency').waitFor({ timeout: 10_000 })
      await openCommandPalette(page)
      await page.getByPlaceholder('Run command or switch repo...').fill('approve fake smoke dependency')
      await page.locator('[cmdk-item]').filter({ hasText: 'Approve pending Codex action' }).first().click()
      await page.getByText('Install fake smoke dependency').waitFor({ state: 'detached', timeout: 10_000 })
      await page.getByPlaceholder('Ask for follow-up changes').fill('cranberri-approval-smoke-request')
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
      await page.getByLabel('Copy selected file absolute path').click()
      await page.waitForFunction(async (expectedPath) => {
        return await navigator.clipboard.readText() === expectedPath
      }, path.join(repoPath, 'README.md'), { timeout: 10_000 })
      if (await page.getByLabel('Open selected file').isDisabled()) {
        throw new Error('Right-rail open selected file button was disabled')
      }
      if (await page.getByLabel('Reveal selected file in Finder').isDisabled()) {
        throw new Error('Right-rail reveal selected file button was disabled')
      }
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
        return [...document.querySelectorAll('textarea')]
          .some((textarea) => textarea.value.includes('Repo file context:') && textarea.value.includes('Search marker: cranberri-electron-smoke-search.'))
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
        return [...document.querySelectorAll('textarea')]
          .some((textarea) => textarea.value.includes('Repo file context:') && textarea.value.includes('Search marker: cranberri-electron-smoke-search.'))
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
      await page.getByText('File content copied').waitFor({ timeout: 10_000 })
      await openCommandPalette(page)
      await page.getByPlaceholder('Run command or switch repo...').fill('copy selected file absolute path')
      const copySelectedFileAbsolutePathAction = page.locator('[cmdk-item]').filter({ hasText: 'Copy selected file absolute path' }).first()
      await copySelectedFileAbsolutePathAction.waitFor({ timeout: 10_000 })
      if (await copySelectedFileAbsolutePathAction.getAttribute('aria-disabled') === 'true') {
        throw new Error(`Copy selected file absolute path action was disabled: ${await copySelectedFileAbsolutePathAction.textContent()}`)
      }
      await copySelectedFileAbsolutePathAction.click()
      await page.getByText('Copy selected file absolute path').waitFor({ timeout: 10_000 })
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
        return [...document.querySelectorAll('textarea')]
          .some((textarea) => textarea.value.includes('Repo file context:') && textarea.value.includes('Search marker: cranberri-electron-smoke-search.'))
      }, { timeout: 10_000 })
      await page.getByLabel('Send message').click()
      await page.getByText('Fake Codex received: Repo file context:').last().waitFor({ timeout: 10_000 })
      await openCommandPalette(page)
      await page.getByPlaceholder('Run command or switch repo...').fill('git status context')
      await page.locator('[cmdk-item]').filter({ hasText: 'Send git status context' }).first().click()
      await page.waitForFunction(() => {
        return [...document.querySelectorAll('textarea')]
          .some((textarea) => textarea.value.includes('Repo status context:') && textarea.value.includes('- modified: README.md'))
      }, { timeout: 10_000 })
      await page.getByLabel('Send message').click()
      await page.getByText('Fake Codex received: Repo status context:').waitFor({ timeout: 10_000 })
      smokeStep('repo diff context')
      await openCommandPalette(page)
      await page.getByPlaceholder('Run command or switch repo...').fill('repo diff context')
      await page.locator('[cmdk-item]').filter({ hasText: 'Send repo diff context' }).first().click()
      await page.waitForFunction(() => {
        return [...document.querySelectorAll('textarea')]
          .some((textarea) => textarea.value.includes('Repo diff context:') && textarea.value.includes('cranberri-diff-smoke-ready'))
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
        return [...document.querySelectorAll('textarea')]
          .some((textarea) => textarea.value.includes('Review these repo changes.')
            && textarea.value.includes('Prioritize correctness bugs')
            && textarea.value.includes('cranberri-diff-smoke-ready'))
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
        return [...document.querySelectorAll('textarea')]
          .some((textarea) => textarea.value.includes('Explain these repo changes.')
            && textarea.value.includes('Summarize what changed, why it likely matters')
            && textarea.value.includes('cranberri-diff-smoke-ready'))
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
        return [...document.querySelectorAll('textarea')]
          .some((textarea) => textarea.value.includes('Write or update tests for these repo changes.')
            && textarea.value.includes('Start by identifying the behavior changed by the diff')
            && textarea.value.includes('cranberri-diff-smoke-ready'))
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
        return [...document.querySelectorAll('textarea')]
          .some((textarea) => textarea.value.includes('Draft a pull request description for these repo changes.')
            && textarea.value.includes('Include Summary, Testing, and Risks sections')
            && textarea.value.includes('cranberri-diff-smoke-ready'))
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
        return [...document.querySelectorAll('textarea')]
          .some((textarea) => textarea.value.includes('Repo diff context:') && textarea.value.includes('cranberri-diff-smoke-ready'))
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
        return [...document.querySelectorAll('textarea')]
          .some((textarea) => textarea.value.includes('GitHub context:') && textarea.value.includes('fraction12/Cranberri'))
      }, { timeout: 10_000 })
      await page.getByLabel('Send message').click()
      await page.getByText('Fake Codex received: GitHub context:').waitFor({ timeout: 10_000 })
      await openCommandPalette(page)
      await page.getByPlaceholder('Run command or switch repo...').fill('github branch context')
      await page.locator('[cmdk-item]').filter({ hasText: 'Send GitHub branch context' }).first().click()
      await page.waitForFunction(() => {
        return [...document.querySelectorAll('textarea')]
          .some((textarea) => textarea.value.includes('GitHub context:') && textarea.value.includes('Panel: branches') && textarea.value.includes('Source: git'))
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
        return [...document.querySelectorAll('textarea')]
          .some((textarea) => textarea.value.includes('GitHub item context:') && textarea.value.includes('Kind: branches') && textarea.value.includes('Title: smoke/context'))
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
        return [...document.querySelectorAll('textarea')]
          .some((textarea) => textarea.value.includes('GitHub item context:') && textarea.value.includes('Kind: branches') && textarea.value.includes('Title: smoke/context'))
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
        return [...document.querySelectorAll('textarea')]
          .some((textarea) => textarea.value.includes('Workspace brief:') && textarea.value.includes('GitHub: fraction12/Cranberri') && textarea.value.includes('Selected right rail file: README.md (tracked)') && textarea.value.includes('- modified: README.md'))
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
        return [...document.querySelectorAll('textarea')]
          .some((textarea) => textarea.value.includes('Workspace brief:') && textarea.value.includes('GitHub: fraction12/Cranberri') && textarea.value.includes('Selected right rail file: README.md (tracked)'))
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
        return [...document.querySelectorAll('textarea')]
          .some((textarea) => textarea.value.includes('Cranberri diagnostics context:') && textarea.value.includes('Health checks:'))
      }, { timeout: 20_000 })
      await page.getByLabel('Send message').click()
      await page.getByText('Fake Codex received: Cranberri diagnostics context:').waitFor({ timeout: 10_000 })
      await openCommandPalette(page)
      await page.getByPlaceholder('Run command or switch repo...').fill('usage context')
      await clickCommandItemByText(page, 'Send Codex usage context')
      await page.waitForFunction(() => {
        return [...document.querySelectorAll('textarea')]
          .some((textarea) => textarea.value.includes('Codex usage context:') && textarea.value.includes('Fake smoke limit') && textarea.value.includes('Account usage history:') && textarea.value.includes('1,234,567'))
      }, { timeout: 10_000 })
      await page.getByLabel('Send message').click()
      await page.getByText('Fake Codex received: Codex usage context:').waitFor({ timeout: 10_000 })
      await openCommandPalette(page)
      await page.getByPlaceholder('Run command or switch repo...').fill('fake smoke app context')
      await page.locator('[cmdk-item]').filter({ hasText: 'Send app context: Fake Smoke App' }).first().click()
      await page.waitForFunction(() => {
        return [...document.querySelectorAll('textarea')]
          .some((textarea) => textarea.value.includes('Connected app context:') && textarea.value.includes('Fake Smoke App') && textarea.value.includes('Fake Smoke Plugin'))
      }, { timeout: 10_000 })
      await page.getByLabel('Send message').click()
      await page.getByText('Fake Codex received: Connected app context:').waitFor({ timeout: 10_000 })
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
        return [...document.querySelectorAll('textarea')]
          .some((textarea) => textarea.value.includes('MCP tool context:') && textarea.value.includes('fake-smoke-mcp') && textarea.value.includes('inspect_fixture'))
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
        return [...document.querySelectorAll('textarea')]
          .some((textarea) => textarea.value.includes('MCP tool context:') && textarea.value.includes('fake-smoke-mcp') && textarea.value.includes('inspect_fixture'))
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
      await page.getByText('All Files', { exact: true }).waitFor({ timeout: 10_000 })
      await page.getByTitle('README.md').waitFor({ timeout: 10_000 })
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
      await page.getByLabel('Manage tools').click()
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
      await page.getByLabel('Send terminal context to chat').click()
      await page.waitForFunction(() => {
        return [...document.querySelectorAll('textarea')]
          .some((textarea) => textarea.value.includes('cranberri-terminal-context-ready'))
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
        return [...document.querySelectorAll('textarea')]
          .some((textarea) => textarea.value.includes('Terminal context:') && textarea.value.includes('cranberri-terminal-context-ready'))
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
        return [...document.querySelectorAll('textarea')]
          .some((textarea) => textarea.value.includes('Terminal context:') && textarea.value.includes('cranberri-terminal-context-ready'))
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
      const terminalTab = page.getByLabel('Switch to Terminal 1')
      await terminalTab.locator('button').click()
      const closeTerminalDialog = page.getByRole('dialog', { name: 'Close terminal' })
      await closeTerminalDialog.waitFor({ timeout: 10_000 })
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
      await page.getByText('terminal', { exact: true }).first().waitFor({ timeout: 10_000 })
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
        return [...document.querySelectorAll('textarea')]
          .some((textarea) => textarea.value.includes('Repo process context:') && textarea.value.includes('Status: running'))
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
        return [...document.querySelectorAll('textarea')]
          .some((textarea) => textarea.value.includes('Repo process context:') && textarea.value.includes('Status: running'))
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
        return [...document.querySelectorAll('textarea')]
          .some((textarea) => textarea.value.includes('Repo process context:') && textarea.value.includes('Status: running'))
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
      await page.getByTitle('Navigate').click()
      await page.waitForFunction((url) => {
        const input = document.querySelector('input[name="browser-address"]')
        return input instanceof HTMLInputElement && input.value === url
      }, browserUrl, { timeout: 10_000 })
      await clickButtonByTitle(page, 'Copy browser URL')
      await page.waitForFunction(async (url) => {
        return await navigator.clipboard.readText() === url
      }, browserUrl, { timeout: 10_000 })

      let snapshotReady = false
      for (let attempt = 0; attempt < 15; attempt += 1) {
        await page.waitForTimeout(attempt === 0 ? 750 : 1_000)
        await page.getByTitle('Capture page text').click()
        snapshotReady = await page.getByText('cranberri-browser-smoke-ready').waitFor({ timeout: 3_000 })
          .then(() => true)
          .catch(() => false)
        if (snapshotReady) break
      }
      if (!snapshotReady) {
        throw new Error('Browser snapshot did not include cranberri-browser-smoke-ready')
      }
      await clickButtonByTitle(page, 'Copy page context')
      await page.waitForFunction(async () => {
        const text = await navigator.clipboard.readText()
        return text.includes('Browser page context:') && text.includes('cranberri-browser-smoke-ready')
      }, { timeout: 10_000 })
      const attachedBrowserChildViews = await mainWindowChildViewCount(electronApp)
      if (attachedBrowserChildViews < 1) throw new Error('Active browser did not attach a native child view')
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
        return [...document.querySelectorAll('textarea')]
          .some((textarea) => textarea.value.includes('cranberri-browser-smoke-ready'))
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
        return [...document.querySelectorAll('textarea')]
          .some((textarea) => textarea.value.includes('Browser page context:') && textarea.value.includes('cranberri-browser-smoke-ready'))
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
        return [...document.querySelectorAll('textarea')]
          .some((textarea) => textarea.value.includes('Browser element context:') && textarea.value.includes('Smoke Browser Page'))
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
      await clickButtonByTitle(page, 'Copy element selector')
      await page.waitForFunction(async () => {
        const text = await navigator.clipboard.readText()
        return text.length > 0 && !text.includes('Browser element context:')
      }, { timeout: 10_000 })
      await clickButtonByTitle(page, 'Copy element text')
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
        return [...document.querySelectorAll('textarea')]
          .some((textarea) => textarea.value.includes('Browser element context:') && textarea.value.includes('Smoke Browser Page'))
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
      await page.getByTitle('Capture screenshot').click()
      await page.getByAltText('Captured browser screenshot').waitFor({ timeout: 10_000 })
      await clickButtonByTitle(page, 'Copy screenshot path')
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
        return [...document.querySelectorAll('textarea')]
          .some((textarea) => textarea.value.includes('Browser screenshot context:'))
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
        return [...document.querySelectorAll('textarea')]
          .some((textarea) => textarea.value.includes('Browser screenshot context:'))
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

      smokeStep('session management')
      await openCommandPalette(page)
      await page.getByPlaceholder('Run command or switch repo...').fill('pin active chat')
      const pinActiveChatAction = page.locator('[cmdk-item]').filter({ hasText: 'Pin active chat' }).first()
      await pinActiveChatAction.waitFor({ timeout: 10_000 })
      if (await pinActiveChatAction.getAttribute('aria-disabled') === 'true') {
        throw new Error(`Pin active chat action was disabled: ${await pinActiveChatAction.textContent()}`)
      }
      await pinActiveChatAction.click()
      await page.waitForFunction(async (targetRepoPath) => {
        const state = await window.cranberri.appState.read()
        return (state.pinnedCodexSessionIdsByRepoPath[targetRepoPath] ?? []).length > 0
      }, repoPath, { timeout: 10_000 })

      await openCommandPalette(page)
      await page.getByPlaceholder('Run command or switch repo...').fill('unpin active chat')
      const unpinActiveChatAction = page.locator('[cmdk-item]').filter({ hasText: 'Unpin active chat' }).first()
      await unpinActiveChatAction.waitFor({ timeout: 10_000 })
      if (await unpinActiveChatAction.getAttribute('aria-disabled') === 'true') {
        throw new Error(`Unpin active chat action was disabled: ${await unpinActiveChatAction.textContent()}`)
      }
      await unpinActiveChatAction.click()
      await page.waitForFunction(async (targetRepoPath) => {
        const state = await window.cranberri.appState.read()
        return (state.pinnedCodexSessionIdsByRepoPath[targetRepoPath] ?? []).length === 0
      }, repoPath, { timeout: 10_000 })

      await openCommandPalette(page)
      await page.getByPlaceholder('Run command or switch repo...').fill('rename active chat')
      const renameActiveChatAction = page.locator('[cmdk-item]').filter({ hasText: 'Rename active chat' }).first()
      await renameActiveChatAction.waitFor({ timeout: 10_000 })
      if (await renameActiveChatAction.getAttribute('aria-disabled') === 'true') {
        throw new Error(`Rename active chat action was disabled: ${await renameActiveChatAction.textContent()}`)
      }
      await renameActiveChatAction.click()
      const renameDialog = page.getByRole('dialog', { name: 'Rename Codex session' })
      await renameDialog.waitFor({ timeout: 10_000 })
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
      smokeStep('repo workspace assertions complete')
    })
  } finally {
    smokeStep('repo workspace cleanup')
    await closeElectronApp(electronApp)
    fs.rmSync(userDataDir, { recursive: true, force: true })
    fs.rmSync(fixtureRoot, { recursive: true, force: true })
  }
}

await runFreshStartupSmoke()
await runRepoWorkspaceSmoke()

console.log('Electron smoke passed')
