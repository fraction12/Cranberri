#!/usr/bin/env node
import { _electron as electron } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { compareRuntimePerformance, summarizeSamples } from './runtime-performance-contract.mjs'

const appExecutable = process.platform === 'darwin'
  ? path.resolve('dist/mac-arm64/Cranberri.app/Contents/MacOS/Cranberri')
  : process.platform === 'win32'
    ? path.resolve('dist/win-unpacked/Cranberri.exe')
    : path.resolve('dist/linux-unpacked/cranberri')
const contract = JSON.parse(fs.readFileSync(new URL('./runtime-performance-budgets.json', import.meta.url), 'utf8'))
const launchLoops = Math.max(1, Number(process.env.CRANBERRI_PERF_LAUNCH_LOOPS ?? 3))
const switchLoops = Math.max(10, Number(process.env.CRANBERRI_PERF_SWITCH_LOOPS ?? 50))
const outputPath = path.resolve(process.env.CRANBERRI_PERF_OUTPUT ?? 'artifacts/runtime-performance.json')

if (!fs.existsSync(appExecutable)) {
  throw new Error(`Packaged app not found at ${appExecutable}. Run npm run package:dir first.`)
}

const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cranberri-runtime-perf-'))
const repoPath = createFixtureRepo(fixtureRoot)
const launchToUsableMs = []
const workspaceCoherentMs = []
let interaction = null
let appVersion = null

try {
  for (let index = 0; index < launchLoops; index += 1) {
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cranberri-runtime-profile-'))
    seedRegisteredRepo(userDataDir, repoPath)
    const launchedAt = performance.now()
    const electronApp = await launchApp(userDataDir)
    try {
      appVersion = await electronApp.evaluate(({ app }) => app.getVersion())
      const page = await electronApp.firstWindow({ timeout: 20_000 })
      const windowVisibleAt = performance.now()
      await Promise.all([
        page.getByText(repoPath).waitFor({ timeout: 10_000 }),
        page.getByText('Local · main', { exact: true }).waitFor({ timeout: 10_000 }),
        page.getByRole('textbox', { name: 'Chat message' }).waitFor({ timeout: 10_000 }),
        page.getByRole('tab', { name: 'Files' }).waitFor({ timeout: 10_000 }),
      ])
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
      launchToUsableMs.push(performance.now() - launchedAt)
      workspaceCoherentMs.push(performance.now() - windowVisibleAt)
      if (index === launchLoops - 1) interaction = await measureInteractions(electronApp, page, repoPath)
    } finally {
      await electronApp.close().catch(() => undefined)
      fs.rmSync(userDataDir, { recursive: true, force: true })
    }
  }

  if (!interaction) throw new Error('Runtime interaction measurements were not captured')
  const samples = { launchToUsableMs, workspaceCoherentMs, ...interaction }
  const metrics = Object.fromEntries(Object.entries(samples).map(([name, values]) => [name, summarizeSamples(values)]))
  const report = {
    version: 1,
    capturedAt: new Date().toISOString(),
    app: { version: appVersion, executable: appExecutable },
    machine: {
      platform: process.platform,
      arch: process.arch,
      cpuCount: os.cpus().length,
      cpuModel: os.cpus()[0]?.model ?? 'unknown',
      totalMemoryBytes: os.totalmem(),
    },
    fixture: { launchLoops, switchLoops, projectCount: 1, chatWindowCount: 3 },
    samples,
    metrics,
  }
  const comparison = compareRuntimePerformance(report, contract)
  const output = { ...report, comparison }
  fs.mkdirSync(path.dirname(outputPath), { recursive: true })
  fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`)
  process.stdout.write(`${JSON.stringify(output)}\n`)
  if (!comparison.passed) process.exitCode = 1
} finally {
  fs.rmSync(fixtureRoot, { recursive: true, force: true })
}

async function measureInteractions(electronApp, page, fixturePath) {
  await installRendererObservers(page)
  const primaryRepo = page.locator('[data-repo-id="perf-repo"]')
  const prompts = ['perf session one', 'perf session two', 'perf session three']
  const firstTurn = await sendNewSessionPrompt(page, prompts[0])
  for (const prompt of prompts.slice(1)) {
    await primaryRepo.hover()
    await primaryRepo.getByRole('button', { name: `New session in ${path.basename(fixturePath)}` }).click()
    await page.getByRole('menuitem', { name: /New Local session/ }).click()
    await page.getByRole('textbox', { name: 'Chat message' }).waitFor({ timeout: 10_000 })
    await sendNewSessionPrompt(page, prompt)
  }

  const workspaceTabs = page.locator('[role="tab"][aria-label^="Switch to "]')
  if (await workspaceTabs.count() < 3) throw new Error('Expected three chat windows for the switch loop')
  const memoryBefore = await rendererWorkingSetBytes(electronApp)
  const windowSwitchCoherentMs = []
  for (let index = 0; index < switchLoops; index += 1) {
    const tab = workspaceTabs.nth(index % 3)
    const label = await tab.getAttribute('aria-label')
    if (!label) throw new Error('Workspace tab did not have an accessible label')
    const startedAt = performance.now()
    await tab.click()
    await page.waitForFunction((expectedLabel) => (
      [...document.querySelectorAll('[role="tab"]')]
        .some((tabElement) => tabElement.getAttribute('aria-label') === expectedLabel && tabElement.getAttribute('aria-selected') === 'true')
      && document.querySelector('[data-chat-composer="true"]') instanceof HTMLElement
      && document.querySelector('[role="tab"][aria-label="Files"]') instanceof HTMLElement
    ), label, { timeout: 5_000 })
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    windowSwitchCoherentMs.push(performance.now() - startedAt)
  }
  const memoryAfter = await rendererWorkingSetBytes(electronApp)
  const retainedMemoryGrowthPercent = [memoryBefore > 0 ? ((memoryAfter - memoryBefore) / memoryBefore) * 100 : 0]

  const composer = page.getByRole('textbox', { name: 'Chat message' })
  await composer.click()
  await page.keyboard.type('cranberri-key-paint-sample', { delay: 20 })
  const composerKeyToPaintMs = await page.evaluate(() => window.__cranberriRuntimePerf?.keyToPaint ?? [])

  await page.getByRole('tab', { name: 'Files' }).click()
  await page.getByText('No changed files.').waitFor({ timeout: 10_000 })
  const railStartedAt = performance.now()
  fs.appendFileSync(path.join(fixturePath, 'README.md'), '\nRuntime rail refresh marker.\n')
  await page.getByText('README.md', { exact: true }).waitFor({ timeout: 10_000 })
  const rightRailRefreshMs = [performance.now() - railStartedAt]

  const largeDiff = Array.from({ length: 2_000 }, (_, index) => `Runtime diff line ${index + 1}`).join('\n')
  fs.appendFileSync(path.join(fixturePath, 'README.md'), `\n${largeDiff}\n`)
  await page.getByText('README.md', { exact: true }).click()
  const largeDiffStartedAt = performance.now()
  await page.getByRole('tab', { name: 'Diff' }).click()
  await page.locator('.cranberri-diff-viewer').waitFor({ timeout: 10_000 })
  await page.getByText('Runtime diff line 2000', { exact: true }).waitFor({ timeout: 10_000 })
  const largeDiffRenderMs = [performance.now() - largeDiffStartedAt]

  const terminalStartedAt = performance.now()
  await page.getByLabel('New terminal').click()
  await page.locator('.xterm').waitFor({ timeout: 10_000 })
  const terminalReadyMs = [performance.now() - terminalStartedAt]

  const browserStartedAt = performance.now()
  await page.getByLabel('New browser').click()
  await page.getByPlaceholder('https://localhost:5173').waitFor({ timeout: 10_000 })
  const browserReadyMs = [performance.now() - browserStartedAt]

  await page.waitForTimeout(5_000)
  const idleCpuPercent = []
  for (let index = 0; index < 10; index += 1) {
    idleCpuPercent.push(await electronApp.evaluate(({ app }) => (
      app.getAppMetrics().reduce((total, metric) => total + metric.cpu.percentCPUUsage, 0)
    )))
    await page.waitForTimeout(500)
  }
  const longTaskMs = await page.evaluate(() => {
    const values = window.__cranberriRuntimePerf?.longTasks ?? []
    return values.length > 0 ? values : [0]
  })

  return {
    windowSwitchCoherentMs,
    firstCodexEventMs: [firstTurn.firstEventMs],
    transcriptCommitMs: [firstTurn.transcriptCommitMs],
    rightRailRefreshMs,
    largeDiffRenderMs,
    terminalReadyMs,
    browserReadyMs,
    composerKeyToPaintMs,
    longTaskMs,
    idleCpuPercent,
    retainedMemoryGrowthPercent,
  }
}

async function sendNewSessionPrompt(page, prompt) {
  const composer = page.getByRole('textbox', { name: 'Chat message' })
  await composer.fill(prompt)
  const startedAt = performance.now()
  await page.locator('button[aria-label="Send message"]:visible').click()
  await page.locator('[data-turn-activity]:visible').last().waitFor({ timeout: 10_000 })
  const firstEventMs = performance.now() - startedAt
  await page.getByText(`Fake Codex received: ${prompt}`).waitFor({ timeout: 10_000 })
  await page.getByText('cranberri-fake-codex-stream-complete').last().waitFor({ timeout: 10_000 })
  return { firstEventMs, transcriptCommitMs: performance.now() - startedAt }
}

async function installRendererObservers(page) {
  await page.evaluate(() => {
    const state = { keyToPaint: [], longTasks: [] }
    window.__cranberriRuntimePerf = state
    document.addEventListener('keydown', (event) => {
      if (!(event.target instanceof Node) || ![...document.querySelectorAll('[data-composer-input="true"]')]
        .some((composer) => composer.contains(event.target))) return
      const startedAt = performance.now()
      requestAnimationFrame(() => state.keyToPaint.push(performance.now() - startedAt))
    }, true)
    if (typeof PerformanceObserver !== 'undefined') {
      const observer = new PerformanceObserver((list) => {
        state.longTasks.push(...list.getEntries().map((entry) => entry.duration))
      })
      try { observer.observe({ type: 'longtask', buffered: true }) } catch { /* unsupported Chromium build */ }
    }
  })
}

async function rendererWorkingSetBytes(electronApp) {
  return electronApp.evaluate(({ app }) => app.getAppMetrics()
    .filter((metric) => metric.type === 'Tab' || metric.type === 'Browser')
    .reduce((total, metric) => total + metric.memory.workingSetSize * 1024, 0))
}

function createFixtureRepo(rootDir) {
  const fixturePath = path.join(rootDir, 'cranberri-runtime-repo')
  fs.mkdirSync(fixturePath, { recursive: true })
  fs.writeFileSync(path.join(fixturePath, 'README.md'), '# Cranberri runtime fixture\n')
  execFileSync('git', ['init', '--quiet'], { cwd: fixturePath })
  execFileSync('git', ['add', 'README.md'], { cwd: fixturePath })
  execFileSync('git', ['-c', 'user.name=Cranberri Runtime', '-c', 'user.email=runtime@example.invalid', 'commit', '--quiet', '-m', 'Initial fixture'], { cwd: fixturePath })
  return fixturePath
}

function seedRegisteredRepo(userDataDir, fixturePath) {
  fs.writeFileSync(path.join(userDataDir, 'repos.json'), JSON.stringify({
    repos: [{ id: 'perf-repo', name: path.basename(fixturePath), path: fixturePath }],
    activeRepoId: 'perf-repo',
  }))
}

function launchApp(userDataDir) {
  return electron.launch({
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
}
