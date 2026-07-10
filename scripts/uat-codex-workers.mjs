import { _electron as electron } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const appExecutable = process.platform === 'darwin'
  ? path.resolve('dist/mac-arm64/Cranberri.app/Contents/MacOS/Cranberri')
  : process.platform === 'win32'
    ? path.resolve('dist/win-unpacked/Cranberri.exe')
    : path.resolve('dist/linux-unpacked/cranberri')

const screenshotPath = process.env.CRANBERRI_WORKER_UAT_SCREENSHOT
  ?? path.join(os.tmpdir(), 'cranberri-real-worker-uat.png')

if (!fs.existsSync(appExecutable)) {
  throw new Error(`Packaged app not found at ${appExecutable}. Run npm run package:dir first.`)
}

function createFixtureRepo(rootDir) {
  const repoPath = path.join(rootDir, 'cranberri-real-worker-uat')
  fs.mkdirSync(repoPath, { recursive: true })
  fs.writeFileSync(path.join(repoPath, 'README.md'), [
    '# Cranberri real worker UAT',
    '',
    'Exact marker: CRANBERRI_REAL_WORKER_UAT',
    '',
  ].join('\n'))
  execFileSync('git', ['init', '--quiet'], { cwd: repoPath, stdio: 'ignore' })
  execFileSync('git', ['add', 'README.md'], { cwd: repoPath, stdio: 'ignore' })
  execFileSync('git', [
    '-c', 'user.name=Cranberri UAT',
    '-c', 'user.email=uat@example.invalid',
    'commit', '--quiet', '-m', 'Initial worker UAT fixture',
  ], { cwd: repoPath, stdio: 'ignore' })
  return repoPath
}

function seedRegisteredRepo(userDataDir, repoPath) {
  fs.writeFileSync(path.join(userDataDir, 'repos.json'), JSON.stringify({
    repos: [{
      id: 'real-worker-uat-repo',
      name: path.basename(repoPath),
      path: repoPath,
    }],
    activeRepoId: 'real-worker-uat-repo',
  }, null, 2))
}

function step(label) {
  console.log(`[worker-uat] ${label}`)
}

async function closeElectronApp(electronApp) {
  if (!electronApp) return
  const appProcess = electronApp.process()
  await Promise.race([
    electronApp.close().catch(() => undefined),
    new Promise((resolve) => setTimeout(resolve, 5_000)),
  ])
  if (!appProcess.killed) appProcess.kill('SIGTERM')
}

async function waitForWorkerStatus(page, workerId, expected, timeout = 240_000) {
  await page.waitForFunction(({ id, statuses }) => {
    const worker = document.querySelector(`[data-worker-id="${CSS.escape(id)}"]`)
    return worker instanceof HTMLElement && statuses.includes(worker.dataset.workerStatus ?? '')
  }, { id: workerId, statuses: Array.isArray(expected) ? expected : [expected] }, { timeout })
  return page.locator(`[data-worker-id="${workerId}"]`).first().getAttribute('data-worker-status')
}

async function selectWorker(page, workerId) {
  const worker = page.locator(`[data-worker-id="${workerId}"]`).first()
  if (await worker.getAttribute('aria-pressed') !== 'true') await worker.click()
}

async function waitForAuthoritativeWorkerEvent(page, workerId, eventOffset, statuses, timeout = 180_000) {
  await page.waitForFunction(({ id, offset, expected }) => {
    return window.__cranberriWorkerUatEvents.slice(offset).some((event) => (
      event.type === 'worker_updated'
        && event.worker.threadId === id
        && expected.includes(event.worker.status)
    ))
  }, { id: workerId, offset: eventOffset, expected: statuses }, { timeout })
}

async function workerControl(page, verb, workerId) {
  const title = {
    Steer: 'Steer worker',
    Resume: 'Resume worker',
    Stop: 'Stop worker',
    Open: 'Open worker task',
  }[verb]
  if (!title) throw new Error(`Unknown worker control: ${verb}`)
  const control = page.locator(`[data-worker-detail="${workerId}"] button[title="${title}"]:visible`)
  await control.waitFor({ timeout: 15_000 })
  return control
}

async function main() {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cranberri-real-worker-user-'))
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cranberri-real-worker-repo-'))
  const repoPath = createFixtureRepo(fixtureRoot)
  seedRegisteredRepo(userDataDir, repoPath)

  let electronApp
  let page
  let parentThreadId
  let workerThreadId
  try {
    step('launch packaged app with the real Codex runtime')
    electronApp = await electron.launch({
      executablePath: appExecutable,
      env: {
        ...process.env,
        CRANBERRI_USER_DATA_DIR: userDataDir,
      },
    })
    page = await electronApp.firstWindow({ timeout: 30_000 })
    const pageErrors = []
    const consoleErrors = []
    page.on('pageerror', (error) => pageErrors.push(error.message))
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text())
    })

    await page.waitForLoadState('domcontentloaded')
    await page.locator('header').getByText('Cranberri', { exact: true }).waitFor({ timeout: 20_000 })
    await page.getByText(repoPath).waitFor({ timeout: 20_000 })
    const connection = await page.evaluate(() => window.cranberri.codex.getConnectionStatus())
    if (!connection.installed || !connection.authenticated) {
      throw new Error(`Codex is not ready for UAT: ${connection.detail}`)
    }
    step(`connected to Codex ${connection.version ?? 'unknown version'}`)

    step('configure GPT-5.6-Sol with Ultra reasoning')
    const modelSelector = page.getByRole('button', { name: 'Configure model, reasoning, and speed' })
    await modelSelector.click()
    await page.getByRole('menuitem', { name: /GPT-5\.5/ }).hover()
    await page.getByRole('menuitemradio', { name: /GPT-5\.6-Sol Most capable/ }).click()
    await modelSelector.click()
    await page.getByRole('menuitemradio', { name: 'Ultra', exact: true }).click()
    await page.waitForFunction(() => {
      const trigger = document.querySelector('button[aria-label="Configure model, reasoning, and speed"]')
      return trigger?.textContent?.includes('5.6-Sol') && trigger.textContent.includes('Ultra')
    }, undefined, { timeout: 15_000 })

    await page.evaluate(() => {
      window.__cranberriWorkerUatEvents = []
      window.cranberri.codex.onEvent((event) => window.__cranberriWorkerUatEvents.push(event))
    })

    step('spawn one real Codex worker')
    const prompt = [
      'This is a read-only Cranberri worker UAT.',
      'Spawn exactly one subagent and wait for it to finish.',
      'The subagent must run `sleep 45`, then read README.md and report the exact marker it finds.',
      'Do not edit any files.',
    ].join(' ')
    await page.getByRole('textbox', { name: 'Chat message' }).fill(prompt)
    await page.getByRole('button', { name: 'Send message' }).click()

    const workerRow = page.locator('[data-worker-id]').first()
    await workerRow.waitFor({ timeout: 180_000 })
    workerThreadId = await workerRow.getAttribute('data-worker-id')
    const workerId = workerThreadId
    const workerLabel = await workerRow.getAttribute('aria-label')
    if (!workerId || !workerLabel?.startsWith('View ')) throw new Error('Worker shelf did not expose a real worker identity.')
    const workerName = workerLabel.slice('View '.length)
    await waitForWorkerStatus(page, workerId, ['pendingInit', 'running', 'idle'], 30_000)
    parentThreadId = await page.evaluate((id) => {
      const event = window.__cranberriWorkerUatEvents.find((candidate) => (
        candidate.type === 'worker_updated' && candidate.worker.threadId === id
      ))
      return event?.threadId ?? null
    }, workerId)
    if (!parentThreadId) throw new Error('The worker event was not routed to its parent task.')
    step(`spawned ${workerName} (${workerId}) under ${parentThreadId}`)

    step('steer the running worker from the parent task')
    await selectWorker(page, workerId)
    const steerEventOffset = await page.evaluate(() => window.__cranberriWorkerUatEvents.length)
    const steer = await workerControl(page, 'Steer', workerId)
    await steer.click()
    await page.locator('input[placeholder="Steer this worker..."]:visible').fill(
      'Also include the literal text CRANBERRI_STEERED in your final report.',
    )
    await page.locator('button[aria-label="Send worker instruction"]:visible').click()
    await waitForAuthoritativeWorkerEvent(page, workerId, steerEventOffset, ['pendingInit', 'running'])

    step('open the worker task and return through its parent breadcrumb')
    await (await workerControl(page, 'Open', workerId)).click()
    await page.getByRole('button', { name: 'Open parent task' }).waitFor({ timeout: 30_000 })
    const childComposerEventOffset = await page.evaluate(() => window.__cranberriWorkerUatEvents.length)
    await page.getByRole('textbox', { name: 'Chat message' }).fill(
      'Also include the literal text CRANBERRI_CHILD_COMPOSER in your final report.',
    )
    await page.getByRole('button', { name: 'Send message' }).click()
    await waitForAuthoritativeWorkerEvent(page, workerId, childComposerEventOffset, ['pendingInit', 'running'])
    await page.getByRole('button', { name: 'Open parent task' }).click()
    await page.locator(`[data-worker-id="${workerId}"]`).first().waitFor({ timeout: 30_000 })

    step('wait for the worker to complete and verify its persisted output')
    await waitForWorkerStatus(page, workerId, 'completed')
    const completedTree = await page.evaluate(async ({ repo, parentId, childId }) => {
      const listed = await window.cranberri.codex.listThreads(repo, { archived: false, limit: 20 })
      const parent = listed.sessions.find((session) => session.id === parentId)
      const restored = await window.cranberri.codex.readThread(repo, parentId, false)
      const child = await window.cranberri.codex.readThread(repo, childId, false)
      const output = child.thread.turns.flatMap((turn) => turn.items ?? [])
        .filter((item) => item.type === 'agentMessage')
        .map((item) => item.text ?? item.content?.map((part) => part.text ?? '').join('') ?? '')
        .join('\n')
      return {
        listedStatus: parent?.workers?.find((worker) => worker.threadId === childId)?.status,
        restoredStatus: restored.thread.workers?.find((worker) => worker.threadId === childId)?.status,
        output,
      }
    }, { repo: repoPath, parentId: parentThreadId, childId: workerId })
    if (completedTree.listedStatus !== 'completed' || completedTree.restoredStatus !== 'completed') {
      throw new Error(`Worker completion did not restore from Codex: ${JSON.stringify(completedTree)}`)
    }
    if (!completedTree.output.includes('CRANBERRI_REAL_WORKER_UAT')) {
      throw new Error(`Worker output did not contain the fixture marker: ${completedTree.output}`)
    }
    if (!completedTree.output.includes('CRANBERRI_STEERED')) {
      throw new Error(`Worker output did not contain the steered instruction marker: ${completedTree.output}`)
    }
    if (!completedTree.output.includes('CRANBERRI_CHILD_COMPOSER')) {
      throw new Error(`Worker output did not contain the opened-worker composer marker: ${completedTree.output}`)
    }

    step('resume the completed worker, then interrupt it authoritatively')
    await selectWorker(page, workerId)
    const resumeEventOffset = await page.evaluate(() => window.__cranberriWorkerUatEvents.length)
    await (await workerControl(page, 'Resume', workerId)).click()
    await page.locator('input[placeholder="Resume with a new instruction..."]:visible').fill(
      'Run `sleep 30`, then report CRANBERRI_RESUME_UAT. Do not edit files.',
    )
    await page.locator('button[aria-label="Send worker instruction"]:visible').click()
    await waitForAuthoritativeWorkerEvent(page, workerId, resumeEventOffset, ['pendingInit', 'running'])
    await waitForWorkerStatus(page, workerId, ['pendingInit', 'running'], 60_000)
    await selectWorker(page, workerId)
    await (await workerControl(page, 'Stop', workerId)).click()
    await waitForWorkerStatus(page, workerId, 'interrupted', 60_000)

    step('verify the real UAT left the fixture repository unchanged')
    const gitStatus = execFileSync('git', ['status', '--porcelain'], { cwd: repoPath, encoding: 'utf8' })
    if (gitStatus.trim()) throw new Error(`Worker UAT modified the fixture repo:\n${gitStatus}`)
    await page.screenshot({ path: screenshotPath })

    if (pageErrors.length > 0) throw new Error(`Renderer page errors:\n${pageErrors.join('\n')}`)
    const unexpectedConsoleErrors = consoleErrors.filter((line) => !/Failed to check Codex connection/i.test(line))
    if (unexpectedConsoleErrors.length > 0) {
      throw new Error(`Renderer console errors:\n${unexpectedConsoleErrors.join('\n')}`)
    }
    step(`passed; screenshot: ${screenshotPath}`)
  } catch (error) {
    if (page) {
      const failureScreenshot = screenshotPath.replace(/\.png$/i, '-failure.png')
      await page.screenshot({ path: failureScreenshot }).catch(() => undefined)
      const workerDiagnostics = await page.locator('[data-worker-detail], [data-worker-id]')
        .allTextContents()
        .catch(() => [])
      console.error(`[worker-uat] worker UI at failure: ${JSON.stringify(workerDiagnostics)}`)
      console.error(`[worker-uat] failure screenshot: ${failureScreenshot}`)
    }
    throw error
  } finally {
    if (page) {
      await page.evaluate(async ({ repo, childId, parentId }) => {
        if (childId) {
          await window.cranberri.codex.interrupt(repo, childId).catch(() => undefined)
          await window.cranberri.codex.deleteThread(repo, childId).catch(() => undefined)
        }
        if (parentId) {
          await window.cranberri.codex.interrupt(repo, parentId).catch(() => undefined)
          await window.cranberri.codex.deleteThread(repo, parentId).catch(() => undefined)
        }
      }, { repo: repoPath, childId: workerThreadId, parentId: parentThreadId }).catch(() => undefined)
    }
    await closeElectronApp(electronApp)
    fs.rmSync(userDataDir, { recursive: true, force: true })
    fs.rmSync(fixtureRoot, { recursive: true, force: true })
  }
}

await main()
