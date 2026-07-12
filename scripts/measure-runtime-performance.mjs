#!/usr/bin/env node
import { _electron as electron } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import {
  compareRuntimePerformance,
  RUNTIME_MINIMUM_SAMPLE_COUNTS,
  summarizeSamples,
} from './runtime-performance-contract.mjs'

const appExecutable = process.platform === 'darwin'
  ? path.resolve('dist/mac-arm64/Cranberri.app/Contents/MacOS/Cranberri')
  : process.platform === 'win32'
    ? path.resolve('dist/win-unpacked/Cranberri.exe')
    : path.resolve('dist/linux-unpacked/cranberri')
const contract = JSON.parse(fs.readFileSync(new URL('./runtime-performance-budgets.json', import.meta.url), 'utf8'))
const launchLoops = Math.max(RUNTIME_MINIMUM_SAMPLE_COUNTS.launchToUsableMs, Number(process.env.CRANBERRI_PERF_LAUNCH_LOOPS ?? 3))
const switchLoops = Math.max(RUNTIME_MINIMUM_SAMPLE_COUNTS.windowSwitchCoherentMs, Number(process.env.CRANBERRI_PERF_SWITCH_LOOPS ?? 50))
const outputPath = path.resolve(process.env.CRANBERRI_PERF_OUTPUT ?? 'artifacts/runtime-performance.json')

if (!fs.existsSync(appExecutable)) {
  throw new Error(`Packaged app not found at ${appExecutable}. Run npm run package:dir first.`)
}

const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cranberri-runtime-perf-'))
const fixtureProjects = createFixtureRepos(fixtureRoot, 3)
const launchToUsableMs = []
const workspaceCoherentMs = []
let interaction = null
let appVersion = null

try {
  for (let index = 0; index < launchLoops; index += 1) {
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cranberri-runtime-profile-'))
    seedRegisteredRepos(userDataDir, fixtureProjects)
    const launchedAt = performance.now()
    const electronApp = await launchApp(userDataDir)
    try {
      appVersion = await electronApp.evaluate(({ app }) => app.getVersion())
      const page = await electronApp.firstWindow({ timeout: 20_000 })
      const windowVisibleAt = performance.now()
      await Promise.all([
        page.getByRole('button', { name: `Open ${fixtureProjects[0].name}` }).waitFor({ timeout: 10_000 }),
        page.getByText('Local · main', { exact: true }).waitFor({ timeout: 10_000 }),
        page.getByRole('textbox', { name: 'Chat message' }).waitFor({ timeout: 10_000 }),
        page.getByRole('tab', { name: 'Files' }).waitFor({ timeout: 10_000 }),
      ])
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
      launchToUsableMs.push(performance.now() - launchedAt)
      workspaceCoherentMs.push(performance.now() - windowVisibleAt)
      if (index === launchLoops - 1) interaction = await measureInteractions(electronApp, page, fixtureProjects)
    } finally {
      await electronApp.close().catch(() => undefined)
      fs.rmSync(userDataDir, { recursive: true, force: true })
    }
  }

  if (!interaction) throw new Error('Runtime interaction measurements were not captured')
  const samples = { launchToUsableMs, workspaceCoherentMs, ...interaction.samples }
  const metrics = Object.fromEntries(Object.entries(samples).map(([name, values]) => [name, summarizeSamples(values)]))
  metrics.longTaskMs.maximum = interaction.instrumentation.longTasks.maximumObservedMs
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
    fixture: { launchLoops, switchLoops, projectCount: fixtureProjects.length, checkoutCount: fixtureProjects.length, chatWindowCount: fixtureProjects.length },
    samples,
    metrics,
    instrumentation: interaction.instrumentation,
    endurance: interaction.endurance,
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

async function measureInteractions(electronApp, page, projects) {
  await installRendererObservers(page)
  const prompts = projects.map((_, index) => `perf project ${index + 1}`)
  const firstTurn = await sendNewSessionPrompt(page, prompts[0])
  for (let index = 1; index < projects.length; index += 1) {
    const project = projects[index]
    const repo = page.locator(`[data-repo-id="${project.id}"]`)
    await repo.hover()
    await repo.getByRole('button', { name: `New session in ${project.name}` }).click()
    await page.getByRole('menuitem', { name: /New Local session/ }).click()
    await page.getByRole('textbox', { name: 'Chat message' }).waitFor({ timeout: 10_000 })
    await sendNewSessionPrompt(page, prompts[index])
  }

  const memoryBefore = await rendererWorkingSetBytes(electronApp)
  const windowSwitchCoherentMs = []
  const identityMismatches = []
  const projectIds = new Set()
  const checkoutIds = new Set()
  let identityChecks = 0
  let activeFixturePath = projects[projects.length - 1].path
  for (let index = 0; index < switchLoops; index += 1) {
    const project = projects[index % projects.length]
    const startedAt = performance.now()
    await page.getByRole('button', { name: `Open ${project.name}` }).click()
    const identityResult = await waitForExpectedIdentity(page, project)
    identityChecks += 1
    if (!identityResult.matched) {
      identityMismatches.push({
        expectedProjectId: project.id,
        actualProjectId: identityResult.identity.projectId,
        windowProjectId: identityResult.identity.windowProjectId,
        taskProjectId: identityResult.identity.taskProjectId,
        checkoutProjectId: identityResult.identity.checkoutProjectId,
        checkoutKind: identityResult.identity.checkoutKind,
        checkoutPathMatched: identityResult.identity.checkoutPath === project.path,
      })
      break
    }
    projectIds.add(identityResult.identity.projectId)
    checkoutIds.add(identityResult.identity.checkoutId)
    activeFixturePath = identityResult.identity.checkoutPath
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
  fs.appendFileSync(path.join(activeFixturePath, 'README.md'), '\nRuntime rail refresh marker.\n')
  await page.getByText('README.md', { exact: true }).waitFor({ timeout: 10_000 })
  const rightRailRefreshMs = [performance.now() - railStartedAt]

  const largeDiff = Array.from({ length: 2_000 }, (_, index) => `Runtime diff line ${index + 1}`).join('\n')
  fs.appendFileSync(path.join(activeFixturePath, 'README.md'), `\n${largeDiff}\n`)
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
  const longTaskObservation = await page.evaluate(() => {
    const values = window.__cranberriRuntimePerf?.longTasks ?? []
    return {
      available: window.__cranberriRuntimePerf?.longTasksAvailable === true,
      observationWindowMs: performance.now() - (window.__cranberriRuntimePerf?.longTaskObservationStartedAt ?? performance.now()),
      entryCount: values.length,
      maximumObservedMs: values.length > 0 ? Math.max(...values) : 0,
      values,
    }
  })

  return {
    samples: {
      windowSwitchCoherentMs,
      firstCodexEventMs: [firstTurn.firstEventMs],
      transcriptCommitMs: [firstTurn.transcriptCommitMs],
      rightRailRefreshMs,
      largeDiffRenderMs,
      terminalReadyMs,
      browserReadyMs,
      composerKeyToPaintMs,
      longTaskMs: longTaskObservation.values,
      idleCpuPercent,
      retainedMemoryGrowthPercent,
    },
    instrumentation: {
      longTasks: {
        available: longTaskObservation.available,
        observationWindowMs: longTaskObservation.observationWindowMs,
        entryCount: longTaskObservation.entryCount,
        maximumObservedMs: longTaskObservation.maximumObservedMs,
      },
    },
    endurance: {
      identityChecks,
      identityMismatches,
      projectIds: [...projectIds],
      checkoutIds: [...checkoutIds],
    },
  }
}

async function waitForExpectedIdentity(page, project) {
  try {
    await page.waitForFunction(async (expected) => {
      const [state, registry, snapshot] = await Promise.all([
        window.cranberri.appState.read(),
        window.cranberri.repos.list(),
        window.cranberri.tasks.snapshot(),
      ])
      const projectId = registry.activeProjectId
      const workspace = projectId ? state.workspacesByProjectId[projectId] : undefined
      const activeWindow = workspace?.windows.find((windowState) => windowState.id === workspace.activeWindowId)
      const task = snapshot.tasks.find((candidate) => candidate.id === activeWindow?.taskId)
      const checkout = snapshot.checkouts.find((candidate) => candidate.id === activeWindow?.checkoutId)
      return projectId === expected.id
        && activeWindow?.projectId === expected.id
        && task?.projectId === expected.id
        && checkout?.projectId === expected.id
        && checkout.kind === 'local'
        && checkout.canonicalPath === expected.path
        && document.querySelector('[data-chat-composer="true"]') instanceof HTMLElement
        && document.querySelector('[role="tab"][aria-label="Files"]') instanceof HTMLElement
    }, { id: project.id, path: project.path }, { timeout: 5_000 })
  } catch {
    return { matched: false, identity: await readActiveIdentity(page) }
  }
  return { matched: true, identity: await readActiveIdentity(page) }
}

async function readActiveIdentity(page) {
  return page.evaluate(async () => {
    const [state, registry, snapshot] = await Promise.all([
      window.cranberri.appState.read(),
      window.cranberri.repos.list(),
      window.cranberri.tasks.snapshot(),
    ])
    const projectId = registry.activeProjectId
    const workspace = projectId ? state.workspacesByProjectId[projectId] : undefined
    const activeWindow = workspace?.windows.find((windowState) => windowState.id === workspace.activeWindowId)
    const task = snapshot.tasks.find((candidate) => candidate.id === activeWindow?.taskId)
    const checkout = snapshot.checkouts.find((candidate) => candidate.id === activeWindow?.checkoutId)
    return {
      projectId,
      windowProjectId: activeWindow?.projectId ?? null,
      taskProjectId: task?.projectId ?? null,
      checkoutProjectId: checkout?.projectId ?? null,
      checkoutId: checkout?.id ?? null,
      checkoutKind: checkout?.kind ?? null,
      checkoutPath: checkout?.canonicalPath ?? null,
    }
  })
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
    const state = {
      keyToPaint: [],
      longTasks: [],
      longTasksAvailable: false,
      longTaskObservationStartedAt: performance.now(),
    }
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
      try {
        observer.observe({ type: 'longtask', buffered: true })
        state.longTasksAvailable = true
      } catch { /* unsupported Chromium build */ }
    }
  })
}

async function rendererWorkingSetBytes(electronApp) {
  return electronApp.evaluate(({ app }) => app.getAppMetrics()
    .filter((metric) => metric.type === 'Tab' || metric.type === 'Browser')
    .reduce((total, metric) => total + metric.memory.workingSetSize * 1024, 0))
}

function createFixtureRepos(rootDir, count) {
  return Array.from({ length: count }, (_, index) => createFixtureRepo(rootDir, index + 1))
}

function createFixtureRepo(rootDir, index) {
  const name = `cranberri-runtime-repo-${index}`
  const fixturePath = path.join(rootDir, name)
  fs.mkdirSync(fixturePath, { recursive: true })
  fs.writeFileSync(path.join(fixturePath, 'README.md'), `# Cranberri runtime fixture ${index}\n`)
  execFileSync('git', ['init', '--quiet'], { cwd: fixturePath })
  execFileSync('git', ['add', 'README.md'], { cwd: fixturePath })
  execFileSync('git', ['-c', 'user.name=Cranberri Runtime', '-c', 'user.email=runtime@example.invalid', 'commit', '--quiet', '-m', 'Initial fixture'], { cwd: fixturePath })
  return { id: `perf-repo-${index}`, name, path: fixturePath }
}

function seedRegisteredRepos(userDataDir, projects) {
  fs.writeFileSync(path.join(userDataDir, 'repos.json'), JSON.stringify({
    repos: projects,
    activeRepoId: projects[0].id,
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
