import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const appExecutable = process.platform === 'darwin'
  ? path.resolve('dist/mac-arm64/Cranberri.app/Contents/MacOS/Cranberri')
  : process.platform === 'win32'
    ? path.resolve('dist/win-unpacked/Cranberri.exe')
    : path.resolve('dist/linux-unpacked/cranberri')

function createFixtureRepo(root: string): string {
  const repoPath = path.join(root, 'cranberri-chat-parity-repo')
  fs.mkdirSync(repoPath, { recursive: true })
  fs.writeFileSync(path.join(repoPath, 'README.md'), '# Synthetic chat parity fixture\n')
  execFileSync('git', ['init', '--quiet', '-b', 'main'], { cwd: repoPath })
  execFileSync('git', ['add', 'README.md'], { cwd: repoPath })
  execFileSync('git', ['-c', 'user.name=Cranberri UAT', '-c', 'user.email=uat@example.invalid', 'commit', '--quiet', '-m', 'Initial fixture'], { cwd: repoPath })
  return repoPath
}

function seedRepo(userDataDir: string, repoPath: string): void {
  fs.writeFileSync(path.join(userDataDir, 'repos.json'), JSON.stringify({
    repos: [{ id: 'chat-parity-repo', name: path.basename(repoPath), path: repoPath }],
    activeRepoId: 'chat-parity-repo',
  }, null, 2))
}

async function resizeApp(app: ElectronApplication, width: number, height: number): Promise<void> {
  await app.evaluate(({ BrowserWindow }, size) => {
    const window = BrowserWindow.getAllWindows()[0]
    if (!window) throw new Error('Cranberri window was not created')
    window.setMinimumSize(800, 560)
    window.setSize(size.width, size.height)
  }, { width, height })
}

async function assertChatGeometry(page: Page): Promise<void> {
  const violations = await page.evaluate(() => {
    const viewport = { width: window.innerWidth, height: window.innerHeight }
    const candidates = [...document.querySelectorAll('[data-turn-activity], [data-activity-disclosure], [data-chat-composer="true"]')]
      .filter((element): element is HTMLElement => element instanceof HTMLElement && getComputedStyle(element).visibility !== 'hidden')
    return candidates.flatMap((element) => {
      const bounds = element.getBoundingClientRect()
      const isComposer = element.dataset.chatComposer === 'true'
      const outside = bounds.left < -1
        || bounds.right > viewport.width + 1
        || (isComposer && (bounds.top < -1 || bounds.bottom > viewport.height + 1))
      const invalid = bounds.width <= 0 || bounds.height <= 0
      return outside || invalid ? [{ tag: element.tagName, text: element.textContent?.slice(0, 80), bounds, viewport }] : []
    })
  })
  expect(violations).toEqual([])
}

test('rich activity remains inspectable, accessible, and stable in the packaged app', async ({ browserName }, testInfo) => {
  void browserName
  expect(fs.existsSync(appExecutable), `Packaged app missing at ${appExecutable}; run npm run package:dir`).toBe(true)
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cranberri-chat-parity-user-'))
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cranberri-chat-parity-repo-'))
  const repoPath = createFixtureRepo(fixtureRoot)
  seedRepo(userDataDir, repoPath)

  const app = await electron.launch({
    executablePath: appExecutable,
    env: {
      ...process.env,
      CRANBERRI_USER_DATA_DIR: userDataDir,
      CRANBERRI_HOME: path.join(userDataDir, 'cranberri-home'),
      CRANBERRI_FAKE_CODEX: '1',
      GITHUB_TOKEN: '',
      GH_TOKEN: '',
    },
  })
  const pageErrors: string[] = []
  const consoleErrors: string[] = []

  try {
    const page = await app.firstWindow()
    page.on('pageerror', (error) => pageErrors.push(error.message))
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text())
    })
    await page.getByText(repoPath).waitFor()
    await page.getByText('Local · main', { exact: true }).waitFor()

    const composer = page.getByRole('textbox', { name: 'Chat message' })
    await composer.fill('cranberri-rich-activity-fixture')
    await page.getByLabel('Send message').click()
    await page.getByText('cranberri-fake-codex-stream-complete').last().waitFor()

    const turn = page.locator('[data-turn-activity]').last()
    const turnToggle = turn.locator('button[aria-expanded]').first()
    await expect(turnToggle).toHaveAttribute('aria-expanded', 'false')
    await turnToggle.click()
    await expect(turnToggle).toHaveAttribute('aria-expanded', 'true')

    const command = turn.locator('[data-activity-disclosure]').filter({ hasText: 'Command failed' }).first()
    const patch = turn.locator('[data-activity-disclosure]').filter({ hasText: 'Changed 1 file' }).first()
    const toolResult = turn.locator('[data-activity-disclosure]').filter({ hasText: 'fake-fixture-server.inspect_fixture' }).first()
    const toolError = turn.locator('[data-activity-disclosure]').filter({ hasText: 'fake-fixture-server.read_missing_fixture' }).first()
    const search = turn.locator('[data-activity-disclosure]').filter({ hasText: 'Searched the web' }).first()
    const image = turn.locator('[data-activity-disclosure]').filter({ hasText: 'Generated image' }).first()
    const collaboration = turn.locator('[data-activity-disclosure]').filter({ hasText: 'Updated 1 collaborator' }).first()

    for (const disclosure of [command, patch, toolResult, toolError, search, image, collaboration]) {
      await expect(disclosure).toBeVisible()
      await disclosure.locator('summary').press('Enter')
      await expect(disclosure).toHaveAttribute('open', '')
    }

    await expect(command).toContainText('synthetic match one')
    await expect(command).toContainText('Exit 2')
    await expect(patch).toContainText('-old fixture')
    await expect(patch).toContainText('+new fixture')
    await expect(toolResult).toContainText('Synthetic fixture inspected')
    await expect(toolError).toContainText('Synthetic fixture unavailable')
    await expect(search).toContainText('deterministic Cranberri fixture')
    await expect(collaboration).toContainText('synthetic-worker-thread')

    const generatedImage = image.locator('img')
    await expect(generatedImage).toBeVisible()
    await expect.poll(() => generatedImage.evaluate((element) => (
      element instanceof HTMLImageElement && element.complete ? element.naturalWidth : 0
    ))).toBeGreaterThan(0)

    await composer.press('ArrowUp')
    await expect(composer).toContainText('cranberri-rich-activity-fixture')
    await composer.press('ArrowDown')
    await expect(composer).toHaveText('')

    await composer.fill('cranberri-human-request-fixture')
    await page.getByLabel('Send message').click()
    const humanRequest = page.locator('[data-human-request]').last()
    await expect(humanRequest).toContainText('Run this command?')
    await humanRequest.getByRole('button', { name: 'Allow once' }).click()
    await expect(page.locator('[data-human-request-outcome]').last()).toContainText('Allowed once')
    await page.getByText('cranberri-fake-codex-stream-complete').last().waitFor()

    await composer.fill('$')
    const skillSuggestions = page.getByRole('listbox', { name: 'Skills' })
    await expect(skillSuggestions).toBeVisible()
    await expect(composer).toHaveAttribute('aria-expanded', 'true')
    await expect(composer).toHaveAttribute('aria-controls', await skillSuggestions.getAttribute('id') ?? '')
    await expect(composer).toHaveAttribute('aria-activedescendant', /.+/)
    await skillSuggestions.getByRole('option').first().click()
    await expect(page.locator('[data-composer-mention="skill"]')).toHaveCount(1)
    await composer.press('Meta+A')
    const copiedMention = await page.evaluate(() => {
      const editor = document.querySelector('[data-composer-input="true"]')
      if (!(editor instanceof HTMLElement)) throw new Error('Composer editor missing')
      const clipboardData = new DataTransfer()
      editor.dispatchEvent(new ClipboardEvent('copy', { bubbles: true, cancelable: true, clipboardData }))
      return {
        structured: clipboardData.getData('application/x-cranberri-composer+json'),
        plain: clipboardData.getData('text/plain'),
      }
    })
    expect(copiedMention.structured).toContain('skill')
    expect(copiedMention.plain.trim()).not.toBe('')
    await page.evaluate(() => {
      const editor = document.querySelector('[data-composer-input="true"]')
      if (!(editor instanceof HTMLElement)) throw new Error('Composer editor missing')
      editor.dispatchEvent(new ClipboardEvent('cut', {
        bubbles: true,
        cancelable: true,
        clipboardData: new DataTransfer(),
      }))
    })
    await expect(page.locator('[data-composer-mention="skill"]')).toHaveCount(0)
    await page.evaluate(({ structured, plain }) => {
      const editor = document.querySelector('[data-composer-input="true"]')
      if (!(editor instanceof HTMLElement)) throw new Error('Composer editor missing')
      const clipboardData = new DataTransfer()
      clipboardData.setData('application/x-cranberri-composer+json', structured)
      clipboardData.setData('text/plain', plain)
      editor.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData }))
    }, copiedMention)
    await expect(page.locator('[data-composer-mention="skill"]')).toHaveCount(1)
    await composer.fill('')

    for (const state of [
      { width: 1400, height: 900, theme: 'dark' },
      { width: 900, height: 600, theme: 'light' },
    ] as const) {
      await resizeApp(app, state.width, state.height)
      await page.evaluate((theme) => { document.documentElement.dataset.theme = theme }, state.theme)
      await page.waitForTimeout(100)
      await assertChatGeometry(page)
      await page.screenshot({ path: testInfo.outputPath(`rich-turn-${state.theme}-${state.width}x${state.height}.png`) })
    }

    expect(pageErrors).toEqual([])
    expect(consoleErrors.filter((line) => !/Failed to check Codex connection/i.test(line))).toEqual([])
  } finally {
    await app.close().catch(() => undefined)
    fs.rmSync(userDataDir, { recursive: true, force: true })
    fs.rmSync(fixtureRoot, { recursive: true, force: true })
  }
})
