import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const EVIDENCE_PREFIX = 'cranberri-daily-driver-evidence-'
const ROOT_MARKER = '.cranberri-uat-root.json'
const RESULTS = new Set(['pass', 'fail', 'blocked'])
const SEVERITIES = new Set(['none', 'P0', 'P1', 'P2'])

function realTempRoot() {
  return fs.realpathSync(os.tmpdir())
}

function assertTempPath(candidate, label) {
  const resolved = fs.realpathSync(candidate)
  const temp = realTempRoot()
  if (resolved !== temp && !resolved.startsWith(`${temp}${path.sep}`)) {
    throw new Error(`${label} must be under the OS temp root: ${temp}`)
  }
  return resolved
}

function readBundleValue(appPath, key) {
  return execFileSync('/usr/bin/plutil', [
    '-extract', key, 'raw', '-o', '-', path.join(appPath, 'Contents', 'Info.plist'),
  ], { encoding: 'utf8' }).trim()
}

export function collectInstalledAppMetadata(appPath = '/Applications/Cranberri.app') {
  const resolvedPath = path.resolve(appPath)
  if (!fs.existsSync(resolvedPath)) throw new Error(`Installed Cranberri app not found: ${resolvedPath}`)
  return {
    version: readBundleValue(resolvedPath, 'CFBundleShortVersionString'),
    build: readBundleValue(resolvedPath, 'CFBundleVersion'),
    bundleId: readBundleValue(resolvedPath, 'CFBundleIdentifier'),
    path: resolvedPath,
  }
}

export function collectMachineMetadata() {
  const cpus = os.cpus()
  return {
    platform: process.platform,
    release: os.release(),
    arch: process.arch,
    cpuModel: cpus[0]?.model ?? 'unknown',
    cpuCount: cpus.length,
    totalMemoryBytes: os.totalmem(),
  }
}

function readFixtureManifest(manifestPath) {
  const resolved = path.resolve(manifestPath)
  const manifest = JSON.parse(fs.readFileSync(resolved, 'utf8'))
  if (manifest.schemaVersion !== 1 || !/^[a-f0-9]{64}$/.test(manifest.fixtureSha ?? '')) {
    throw new Error(`Invalid daily-driver fixture manifest: ${resolved}`)
  }
  return manifest
}

export function startEvidenceRecord(options) {
  if (!/^DD-[0-9]{2}$/.test(options?.scenarioId ?? '')) {
    throw new Error('scenarioId must use the versioned DD-01 form')
  }
  if (!options?.fixtureManifestPath) throw new Error('fixtureManifestPath is required')

  const fixture = readFixtureManifest(options.fixtureManifestPath)
  const app = options.appMetadata ?? collectInstalledAppMetadata(options.appPath)
  for (const key of ['version', 'build', 'bundleId', 'path']) {
    if (typeof app[key] !== 'string' || !app[key]) throw new Error(`App metadata requires ${key}`)
  }
  const tempBase = assertTempPath(options.tempRoot ?? os.tmpdir(), 'Evidence root')
  const artifactRoot = fs.mkdtempSync(path.join(tempBase, EVIDENCE_PREFIX))
  fs.writeFileSync(path.join(artifactRoot, ROOT_MARKER), JSON.stringify({
    kind: 'daily-driver-evidence',
    root: artifactRoot,
  }, null, 2))
  const startedAt = new Date().toISOString()
  const record = {
    schemaVersion: 1,
    scenarioId: options.scenarioId,
    startedAt,
    updatedAt: startedAt,
    app,
    machine: collectMachineMetadata(),
    fixtureSha: fixture.fixtureSha,
    fixtureManifestPath: path.resolve(options.fixtureManifestPath),
    timings: {},
    stateAssertions: [],
    severity: 'none',
    result: 'pending',
    evidencePaths: [],
  }
  const recordPath = path.join(artifactRoot, `${options.scenarioId}.json`)
  fs.writeFileSync(recordPath, `${JSON.stringify(record, null, 2)}\n`)
  return { artifactRoot, recordPath, record }
}

function validateTimings(timings) {
  for (const [name, value] of Object.entries(timings)) {
    if (!name || !Number.isFinite(value) || value < 0) {
      throw new Error(`Invalid timing ${name || '<empty>'}: ${value}`)
    }
  }
}

function validateEvidencePaths(evidencePaths) {
  for (const evidence of evidencePaths) {
    if (!evidence.kind || !path.isAbsolute(evidence.path)) {
      throw new Error('Evidence entries require a kind and absolute path')
    }
    if (!fs.existsSync(evidence.path)) throw new Error(`Evidence artifact not found: ${evidence.path}`)
    assertTempPath(evidence.path, 'Raw evidence artifact')
  }
}

export function finishEvidenceRecord(recordPath, update) {
  const resolvedRecordPath = path.resolve(recordPath)
  assertTempPath(resolvedRecordPath, 'Evidence record')
  const record = JSON.parse(fs.readFileSync(resolvedRecordPath, 'utf8'))
  if (!RESULTS.has(update?.result)) throw new Error(`Invalid evidence result: ${update?.result}`)
  if (!SEVERITIES.has(update?.severity)) throw new Error(`Invalid evidence severity: ${update?.severity}`)
  if (update.result === 'pass' && update.severity !== 'none') {
    throw new Error('Passing evidence must use severity none')
  }
  if (update.result === 'fail' && update.severity === 'none') {
    throw new Error('Failing evidence must identify P0, P1, or P2 severity')
  }

  const timings = update.timings ?? {}
  const stateAssertions = update.stateAssertions ?? []
  const evidencePaths = update.evidencePaths ?? []
  validateTimings(timings)
  validateEvidencePaths(evidencePaths)
  if (update.result === 'pass' && stateAssertions.some((assertion) => assertion.passed !== true)) {
    throw new Error('Passing evidence cannot contain a failed state assertion')
  }

  const next = {
    ...record,
    updatedAt: new Date().toISOString(),
    timings,
    stateAssertions,
    severity: update.severity,
    result: update.result,
    evidencePaths,
  }
  fs.writeFileSync(resolvedRecordPath, `${JSON.stringify(next, null, 2)}\n`)
  return next
}

export function trashEvidenceArtifacts(root, options = {}) {
  const resolved = assertTempPath(root, 'Evidence root')
  const markerPath = path.join(resolved, ROOT_MARKER)
  if (!fs.existsSync(markerPath)) throw new Error(`Refusing to clean an unmarked evidence root: ${resolved}`)
  const marker = JSON.parse(fs.readFileSync(markerPath, 'utf8'))
  if (marker.kind !== 'daily-driver-evidence' || marker.root !== resolved) {
    throw new Error(`Refusing to clean an evidence root with an invalid marker: ${resolved}`)
  }
  const execFile = options.execFile ?? execFileSync
  execFile('/usr/bin/trash', [resolved], { encoding: 'utf8' })
}

function optionValues(args, name) {
  return args.flatMap((value, index) => value === name && args[index + 1] ? [args[index + 1]] : [])
}

function requiredOption(args, name) {
  const value = optionValues(args, name)[0]
  if (!value) throw new Error(`Missing required option ${name}`)
  return value
}

function parsePair(value, label) {
  const separator = value.indexOf('=')
  if (separator < 1) throw new Error(`${label} must use name=value`)
  return [value.slice(0, separator), value.slice(separator + 1)]
}

function runCli() {
  const [command, ...args] = process.argv.slice(2)
  if (command === 'start') {
    const started = startEvidenceRecord({
      scenarioId: requiredOption(args, '--scenario'),
      fixtureManifestPath: requiredOption(args, '--fixture'),
      appPath: optionValues(args, '--app')[0],
      tempRoot: optionValues(args, '--temp-root')[0],
    })
    process.stdout.write(`${JSON.stringify(started, null, 2)}\n`)
    return
  }
  if (command === 'finish') {
    const timings = Object.fromEntries(optionValues(args, '--timing').map((value) => {
      const [name, raw] = parsePair(value, '--timing')
      return [name, Number(raw)]
    }))
    const stateAssertions = optionValues(args, '--assertion').map((value) => {
      const [id, raw] = parsePair(value, '--assertion')
      const [status, ...actual] = raw.split(':')
      if (!['pass', 'fail'].includes(status)) throw new Error('--assertion status must be pass or fail')
      return { id, passed: status === 'pass', actual: actual.join(':') || undefined }
    })
    const evidencePaths = optionValues(args, '--evidence').map((value) => {
      const [kind, evidencePath] = parsePair(value, '--evidence')
      return { kind, path: path.resolve(evidencePath) }
    })
    const record = finishEvidenceRecord(requiredOption(args, '--record'), {
      result: requiredOption(args, '--result'),
      severity: requiredOption(args, '--severity'),
      timings,
      stateAssertions,
      evidencePaths,
    })
    process.stdout.write(`${JSON.stringify(record, null, 2)}\n`)
    return
  }
  if (command === 'cleanup') {
    const root = requiredOption(args, '--root')
    trashEvidenceArtifacts(root)
    process.stdout.write(`Moved evidence root to Trash: ${root}\n`)
    return
  }
  throw new Error('Usage: daily-driver-evidence.mjs <start|finish|cleanup> [options]')
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) runCli()
