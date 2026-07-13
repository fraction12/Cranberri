#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
export const REFERENCE_ROOT = path.resolve(SCRIPT_DIR, '../../docs/references/codex-chat-parity')
export const DEFAULT_MANIFEST_PATH = path.join(REFERENCE_ROOT, 'reference-states.json')

export const REQUIRED_STATE_IDS = [
  'empty',
  'drafted',
  'menu-open',
  'active',
  'approval-waiting',
  'request-resolved',
  'failed',
  'validation-error',
  'completed-collapsed',
  'completed-expanded',
  'long-output',
  'attachment',
  'restored-session',
  'hover',
  'keyboard-focus',
  'disabled-control',
]

const REQUIRED_THEMES = ['dark', 'light']
const REQUIRED_VIEWPORTS = [
  { id: 'desktop-1400x900', width: 1400, height: 900 },
  { id: 'compact-900x600', width: 900, height: 600 },
]
const BASELINE_PINS = {
  nativeApp: {
    path: '/Applications/ChatGPT.app',
    bundleId: 'com.openai.codex',
    desktopVersion: '26.707.62119',
    bundleVersion: '5211',
  },
  cli: {
    nativeBundledVersion: 'codex-cli 0.144.2',
    cranberriRuntimeVersion: 'codex-cli 0.144.0',
  },
  schema: {
    generatedFileCount: 671,
    files: {
      'v2/ThreadItem.ts': '7f911d8aa4046653274d3709afffcdfd4093d9d6c87395287f58c4a754ac4cd2',
      'ServerRequest.ts': '1c5837adbfbdd005f387478ba87840808d1353b47b82dcf63739a78bb1c8d3be',
    },
  },
}
const CAPTURE_STATUSES = new Set(['blocked', 'captured'])
const POLICY_STATUSES = new Set(['blocked', 'capture-in-progress', 'captured'])
const SHA256_PATTERN = /^[a-f0-9]{64}$/
const SAFE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const SENSITIVE_FIXTURE_PATTERNS = [
  /(?:^|[^a-z])sk-[a-z0-9_-]{12,}/i,
  /(?:^|[^a-z])gh[oprsu]_[a-z0-9]{12,}/i,
  /AKIA[0-9A-Z]{12,}/,
  /Bearer\s+[a-z0-9._-]{12,}/i,
  /\/Users\/[^/]+\//,
  /\/home\/[^/]+\//,
]

function fail(label, message) {
  throw new Error(`${label}: ${message}`)
}

function assertObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(label, 'must be an object')
  return value
}

function assertExactKeys(value, keys, label) {
  const object = assertObject(value, label)
  const expected = new Set(keys)
  for (const key of Object.keys(object)) {
    if (!expected.has(key)) fail(label, `unknown field ${key}`)
  }
  for (const key of keys) {
    if (!Object.hasOwn(object, key)) fail(label, `missing field ${key}`)
  }
  return object
}

function assertString(value, label) {
  if (typeof value !== 'string' || value.trim() === '') fail(label, 'must be a non-empty string')
  return value
}

function assertNullableString(value, label) {
  if (value !== null) assertString(value, label)
}

function assertNumber(value, label, predicate = () => true) {
  if (typeof value !== 'number' || !Number.isFinite(value) || !predicate(value)) {
    fail(label, 'must be a valid number')
  }
}

function assertStringArray(value, label, options = {}) {
  if (!Array.isArray(value)) fail(label, 'must be an array')
  if (options.nonEmpty && value.length === 0) fail(label, 'must not be empty')
  const unique = new Set()
  for (const [index, entry] of value.entries()) {
    assertString(entry, `${label}[${index}]`)
    if (options.unique && unique.has(entry)) fail(label, `contains duplicate ${entry}`)
    unique.add(entry)
  }
}

function assertId(value, label) {
  assertString(value, label)
  if (!SAFE_ID_PATTERN.test(value)) fail(label, 'must be a lowercase kebab-case identifier')
}

function assertExactIdSet(actual, expected, label) {
  if (actual.length !== expected.length || actual.some((value, index) => value !== expected[index])) {
    fail(label, `must equal ${expected.join(', ')} in contract order`)
  }
}

function assertPinnedValue(actual, expected, label) {
  if (actual !== expected) fail(label, `must equal pinned value ${expected}`)
}

function scanSyntheticContent(value, label) {
  if (typeof value === 'string') {
    if (SENSITIVE_FIXTURE_PATTERNS.some((pattern) => pattern.test(value))) {
      fail(label, 'contains sensitive-looking fixture content')
    }
    return
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => scanSyntheticContent(entry, `${label}[${index}]`))
    return
  }
  if (value && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) scanSyntheticContent(entry, `${label}.${key}`)
    return
  }
  if (value !== null && !['number', 'boolean'].includes(typeof value)) {
    fail(label, 'contains a non-JSON fixture value')
  }
}

function validatePins(pins) {
  assertExactKeys(pins, ['nativeApp', 'cli', 'schema', 'environment'], 'pins')

  const nativeApp = assertExactKeys(
    pins.nativeApp,
    ['path', 'bundleId', 'desktopVersion', 'bundleVersion'],
    'pins.nativeApp',
  )
  for (const key of ['path', 'bundleId', 'desktopVersion', 'bundleVersion']) {
    assertString(nativeApp[key], `pins.nativeApp.${key}`)
    assertPinnedValue(nativeApp[key], BASELINE_PINS.nativeApp[key], `pins.nativeApp.${key}`)
  }

  const cli = assertExactKeys(
    pins.cli,
    ['nativeBundledVersion', 'cranberriRuntimeVersion', 'compatibility'],
    'pins.cli',
  )
  assertString(cli.nativeBundledVersion, 'pins.cli.nativeBundledVersion')
  assertString(cli.cranberriRuntimeVersion, 'pins.cli.cranberriRuntimeVersion')
  assertPinnedValue(
    cli.nativeBundledVersion,
    BASELINE_PINS.cli.nativeBundledVersion,
    'pins.cli.nativeBundledVersion',
  )
  assertPinnedValue(
    cli.cranberriRuntimeVersion,
    BASELINE_PINS.cli.cranberriRuntimeVersion,
    'pins.cli.cranberriRuntimeVersion',
  )
  if (cli.compatibility !== 'protocol-equivalent') {
    fail('pins.cli.compatibility', 'must be protocol-equivalent for this baseline')
  }

  const schema = assertExactKeys(pins.schema, ['generatedFileCount', 'files'], 'pins.schema')
  assertNumber(schema.generatedFileCount, 'pins.schema.generatedFileCount', Number.isInteger)
  assertPinnedValue(
    schema.generatedFileCount,
    BASELINE_PINS.schema.generatedFileCount,
    'pins.schema.generatedFileCount',
  )
  if (!Array.isArray(schema.files) || schema.files.length === 0) fail('pins.schema.files', 'must not be empty')
  const schemaPaths = new Set()
  for (const [index, file] of schema.files.entries()) {
    const entry = assertExactKeys(file, ['path', 'sha256'], `pins.schema.files[${index}]`)
    assertString(entry.path, `pins.schema.files[${index}].path`)
    assertString(entry.sha256, `pins.schema.files[${index}].sha256`)
    if (!SHA256_PATTERN.test(entry.sha256)) fail(`pins.schema.files[${index}].sha256`, 'must be a SHA-256 hash')
    if (schemaPaths.has(entry.path)) fail('pins.schema.files', `contains duplicate ${entry.path}`)
    schemaPaths.add(entry.path)
  }
  for (const requiredPath of ['v2/ThreadItem.ts', 'ServerRequest.ts']) {
    if (!schemaPaths.has(requiredPath)) fail('pins.schema.files', `missing ${requiredPath}`)
    const actualHash = schema.files.find((entry) => entry.path === requiredPath)?.sha256
    assertPinnedValue(actualHash, BASELINE_PINS.schema.files[requiredPath], `pins.schema.files.${requiredPath}`)
  }

  const environment = assertExactKeys(
    pins.environment,
    ['osVersion', 'osBuild', 'display', 'interfaceSize', 'nativeUiFont'],
    'pins.environment',
  )
  for (const key of ['osVersion', 'osBuild', 'interfaceSize', 'nativeUiFont']) {
    assertString(environment[key], `pins.environment.${key}`)
  }
  const display = assertExactKeys(
    environment.display,
    ['physicalWidth', 'physicalHeight', 'scaleFactor', 'kind'],
    'pins.environment.display',
  )
  assertNumber(display.physicalWidth, 'pins.environment.display.physicalWidth', Number.isInteger)
  assertNumber(display.physicalHeight, 'pins.environment.display.physicalHeight', Number.isInteger)
  assertNumber(display.scaleFactor, 'pins.environment.display.scaleFactor', (value) => value > 0)
  assertString(display.kind, 'pins.environment.display.kind')
}

function validateMatrix(matrix) {
  assertExactKeys(matrix, ['themes', 'viewports'], 'matrix')
  assertStringArray(matrix.themes, 'matrix.themes', { nonEmpty: true, unique: true })
  assertExactIdSet(matrix.themes, REQUIRED_THEMES, 'matrix.themes')
  if (!Array.isArray(matrix.viewports)) fail('matrix.viewports', 'must be an array')
  if (matrix.viewports.length !== REQUIRED_VIEWPORTS.length) {
    fail('matrix.viewports', `must contain ${REQUIRED_VIEWPORTS.length} entries`)
  }
  for (const [index, expected] of REQUIRED_VIEWPORTS.entries()) {
    const viewport = assertExactKeys(
      matrix.viewports[index],
      ['id', 'width', 'height', 'scaleFactor'],
      `matrix.viewports[${index}]`,
    )
    if (viewport.id !== expected.id || viewport.width !== expected.width || viewport.height !== expected.height) {
      fail(`matrix.viewports[${index}]`, `must be ${expected.id} at ${expected.width}x${expected.height}`)
    }
    assertNumber(viewport.scaleFactor, `matrix.viewports[${index}].scaleFactor`, (value) => value > 0)
  }
}

function validateComparison(comparison) {
  assertExactKeys(
    comparison,
    ['regions', 'masks', 'nonComparableControls', 'geometryToleranceCssPx', 'changedPixelThreshold'],
    'comparison',
  )
  assertNumber(
    comparison.geometryToleranceCssPx,
    'comparison.geometryToleranceCssPx',
    (value) => value >= 0 && value <= 2,
  )
  assertNumber(
    comparison.changedPixelThreshold,
    'comparison.changedPixelThreshold',
    (value) => value >= 0 && value <= 0.01,
  )

  if (!Array.isArray(comparison.regions) || comparison.regions.length === 0) {
    fail('comparison.regions', 'must not be empty')
  }
  const regionIds = new Set()
  for (const [index, region] of comparison.regions.entries()) {
    const entry = assertExactKeys(region, ['id', 'description'], `comparison.regions[${index}]`)
    assertId(entry.id, `comparison.regions[${index}].id`)
    assertString(entry.description, `comparison.regions[${index}].description`)
    if (regionIds.has(entry.id)) fail('comparison.regions', `contains duplicate ${entry.id}`)
    regionIds.add(entry.id)
  }

  if (!Array.isArray(comparison.masks) || comparison.masks.length === 0) {
    fail('comparison.masks', 'must not be empty')
  }
  const masksById = new Map()
  for (const [index, mask] of comparison.masks.entries()) {
    const entry = assertExactKeys(mask, ['id', 'kind', 'selector', 'reason'], `comparison.masks[${index}]`)
    assertId(entry.id, `comparison.masks[${index}].id`)
    if (!['selector', 'comparison-rule'].includes(entry.kind)) {
      fail(`comparison.masks[${index}].kind`, 'must be selector or comparison-rule')
    }
    assertNullableString(entry.selector, `comparison.masks[${index}].selector`)
    if (entry.kind === 'selector' && entry.selector === null) {
      fail(`comparison.masks[${index}].selector`, 'is required for a selector mask')
    }
    if (entry.kind === 'comparison-rule' && entry.selector !== null) {
      fail(`comparison.masks[${index}].selector`, 'must be null for a comparison rule')
    }
    assertString(entry.reason, `comparison.masks[${index}].reason`)
    if (masksById.has(entry.id)) fail('comparison.masks', `contains duplicate ${entry.id}`)
    masksById.set(entry.id, entry)
  }

  if (!Array.isArray(comparison.nonComparableControls) || comparison.nonComparableControls.length === 0) {
    fail('comparison.nonComparableControls', 'must identify Cranberri-only controls')
  }
  for (const [index, control] of comparison.nonComparableControls.entries()) {
    const entry = assertExactKeys(
      control,
      ['id', 'maskId', 'reason'],
      `comparison.nonComparableControls[${index}]`,
    )
    assertId(entry.id, `comparison.nonComparableControls[${index}].id`)
    assertId(entry.maskId, `comparison.nonComparableControls[${index}].maskId`)
    assertString(entry.reason, `comparison.nonComparableControls[${index}].reason`)
    if (!masksById.has(entry.maskId)) {
      fail(`comparison.nonComparableControls[${index}]`, `references undeclared mask ${entry.maskId}`)
    }
  }
  return { regionIds, masksById }
}

function validateFixtures(fixtures) {
  if (!Array.isArray(fixtures) || fixtures.length === 0) fail('fixtures', 'must not be empty')
  const fixtureIds = new Set()
  for (const [index, fixture] of fixtures.entries()) {
    const entry = assertExactKeys(
      fixture,
      ['id', 'classification', 'description', 'content'],
      `fixtures[${index}]`,
    )
    assertId(entry.id, `fixtures[${index}].id`)
    if (entry.classification !== 'synthetic-non-sensitive') {
      fail(`fixtures[${index}].classification`, 'must be synthetic-non-sensitive')
    }
    assertString(entry.description, `fixtures[${index}].description`)
    assertObject(entry.content, `fixtures[${index}].content`)
    scanSyntheticContent(entry.content, `fixtures[${index}].content`)
    if (fixtureIds.has(entry.id)) fail('fixtures', `contains duplicate ${entry.id}`)
    fixtureIds.add(entry.id)
  }
  return fixtureIds
}

function validateStates(states, fixtureIds, regionIds, masksById) {
  if (!Array.isArray(states)) fail('states', 'must be an array')
  const actualIds = states.map((state, index) => {
    const entry = assertExactKeys(
      state,
      ['id', 'fixtureId', 'setup', 'interactions', 'outcomes', 'regionIds', 'maskIds'],
      `states[${index}]`,
    )
    assertId(entry.id, `states[${index}].id`)
    assertId(entry.fixtureId, `states[${index}].fixtureId`)
    if (!fixtureIds.has(entry.fixtureId)) fail(`states[${index}].fixtureId`, `unknown fixture ${entry.fixtureId}`)
    assertStringArray(entry.setup, `states[${index}].setup`, { nonEmpty: true })
    assertStringArray(entry.interactions, `states[${index}].interactions`, { nonEmpty: true })
    assertStringArray(entry.outcomes, `states[${index}].outcomes`, { nonEmpty: true })
    assertStringArray(entry.regionIds, `states[${index}].regionIds`, { nonEmpty: true, unique: true })
    assertStringArray(entry.maskIds, `states[${index}].maskIds`, { unique: true })
    for (const regionId of entry.regionIds) {
      if (!regionIds.has(regionId)) fail(`states[${index}].regionIds`, `unknown region ${regionId}`)
    }
    for (const maskId of entry.maskIds) {
      if (!masksById.has(maskId)) fail(`states[${index}].maskIds`, `references undeclared mask ${maskId}`)
    }
    return entry.id
  })
  assertExactIdSet(actualIds, REQUIRED_STATE_IDS, 'states')
}

function expectedCaptureIds() {
  return REQUIRED_STATE_IDS.flatMap((stateId) => REQUIRED_THEMES.flatMap((theme) => (
    REQUIRED_VIEWPORTS.map((viewport) => `${stateId}--${theme}--${viewport.id}`)
  )))
}

function resolveCapturedAsset(asset, manifestPath) {
  if (path.isAbsolute(asset)) fail('capture.asset', 'must be relative to the reference directory')
  const referenceRoot = path.dirname(path.resolve(manifestPath))
  const resolved = path.resolve(referenceRoot, asset)
  if (resolved !== referenceRoot && !resolved.startsWith(`${referenceRoot}${path.sep}`)) {
    fail('capture.asset', 'must stay inside the reference directory')
  }
  if (!asset.endsWith('.png')) fail('capture.asset', 'must be a PNG file')
  return resolved
}

function validateCaptures(captures, capturePolicy, manifestPath, fileExists) {
  if (!Array.isArray(captures)) fail('captures', 'must be an array')
  const expectedIds = expectedCaptureIds()
  if (captures.length !== expectedIds.length) {
    fail('captures', `capture matrix must contain ${expectedIds.length} entries`)
  }
  const seen = new Set()
  for (const [index, capture] of captures.entries()) {
    const entry = assertExactKeys(
      capture,
      ['id', 'stateId', 'theme', 'viewportId', 'status', 'asset', 'reasonCode'],
      `captures[${index}]`,
    )
    for (const key of ['id', 'stateId', 'theme', 'viewportId', 'status']) {
      assertString(entry[key], `captures[${index}].${key}`)
    }
    assertNullableString(entry.asset, `captures[${index}].asset`)
    assertNullableString(entry.reasonCode, `captures[${index}].reasonCode`)
    if (!CAPTURE_STATUSES.has(entry.status)) fail(`captures[${index}].status`, 'must be blocked or captured')
    const expectedId = `${entry.stateId}--${entry.theme}--${entry.viewportId}`
    if (entry.id !== expectedId) fail(`captures[${index}].id`, `must be ${expectedId}`)
    if (!expectedIds.includes(entry.id)) fail(`captures[${index}].id`, 'is outside the required matrix')
    if (seen.has(entry.id)) fail('captures', `contains duplicate ${entry.id}`)
    seen.add(entry.id)

    if (entry.status === 'blocked') {
      if (entry.asset !== null) fail(`captures[${index}]`, 'blocked entry must not declare asset')
      if (entry.reasonCode !== capturePolicy.reasonCode) {
        fail(`captures[${index}].reasonCode`, `must be ${capturePolicy.reasonCode}`)
      }
    } else {
      if (entry.asset === null) fail(`captures[${index}]`, 'captured entry requires asset')
      if (entry.reasonCode !== null) fail(`captures[${index}].reasonCode`, 'must be null when captured')
      const resolvedAsset = resolveCapturedAsset(entry.asset, manifestPath)
      if (!fileExists(resolvedAsset)) fail(`captures[${index}]`, `screenshot does not exist: ${entry.asset}`)
    }
  }
  assertExactIdSet([...seen], expectedIds, 'captures')

  const statuses = new Set(captures.map((capture) => capture.status))
  if (capturePolicy.status === 'blocked' && (statuses.size !== 1 || !statuses.has('blocked'))) {
    fail('capturePolicy.status', 'blocked policy requires every capture to be blocked')
  }
  if (capturePolicy.status === 'captured' && (statuses.size !== 1 || !statuses.has('captured'))) {
    fail('capturePolicy.status', 'captured policy requires every capture to be captured')
  }
}

export function loadReferenceManifest(manifestPath = DEFAULT_MANIFEST_PATH) {
  return JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
}

export function validateReferenceManifest(manifest, options = {}) {
  const manifestPath = options.manifestPath ?? DEFAULT_MANIFEST_PATH
  const fileExists = options.fileExists ?? fs.existsSync
  assertExactKeys(
    manifest,
    ['schemaVersion', 'contractId', 'capturePolicy', 'pins', 'matrix', 'comparison', 'fixtures', 'states', 'captures'],
    'manifest',
  )
  if (manifest.schemaVersion !== 1) fail('manifest.schemaVersion', 'must be 1')
  if (manifest.contractId !== 'native-codex-chat-composer-parity') {
    fail('manifest.contractId', 'must be native-codex-chat-composer-parity')
  }

  const capturePolicy = assertExactKeys(
    manifest.capturePolicy,
    ['status', 'reasonCode', 'reason', 'blockedByApp', 'syntheticContentOnly'],
    'capturePolicy',
  )
  if (!POLICY_STATUSES.has(capturePolicy.status)) {
    fail('capturePolicy.status', 'must be blocked, capture-in-progress, or captured')
  }
  assertNullableString(capturePolicy.reasonCode, 'capturePolicy.reasonCode')
  assertNullableString(capturePolicy.reason, 'capturePolicy.reason')
  assertNullableString(capturePolicy.blockedByApp, 'capturePolicy.blockedByApp')
  if (capturePolicy.syntheticContentOnly !== true) {
    fail('capturePolicy.syntheticContentOnly', 'must be true')
  }
  if (capturePolicy.status === 'blocked') {
    assertString(capturePolicy.reasonCode, 'capturePolicy.reasonCode')
    assertString(capturePolicy.reason, 'capturePolicy.reason')
    assertString(capturePolicy.blockedByApp, 'capturePolicy.blockedByApp')
  }
  if (capturePolicy.status === 'captured' && [
    capturePolicy.reasonCode,
    capturePolicy.reason,
    capturePolicy.blockedByApp,
  ].some((value) => value !== null)) {
    fail('capturePolicy', 'captured policy must clear blocking metadata')
  }

  validatePins(manifest.pins)
  validateMatrix(manifest.matrix)
  const { regionIds, masksById } = validateComparison(manifest.comparison)
  const fixtureIds = validateFixtures(manifest.fixtures)
  validateStates(manifest.states, fixtureIds, regionIds, masksById)
  validateCaptures(manifest.captures, capturePolicy, manifestPath, fileExists)
  return manifest
}

export function buildReplayContract(manifest, options = {}) {
  const validated = validateReferenceManifest(manifest, options)
  const statesById = new Map(validated.states.map((state) => [state.id, state]))
  const fixturesById = new Map(validated.fixtures.map((fixture) => [fixture.id, fixture]))
  const viewportsById = new Map(validated.matrix.viewports.map((viewport) => [viewport.id, viewport]))
  const regionsById = new Map(validated.comparison.regions.map((region) => [region.id, region]))
  const masksById = new Map(validated.comparison.masks.map((mask) => [mask.id, mask]))
  const cases = validated.captures.map((capture) => {
    const state = statesById.get(capture.stateId)
    return {
      id: capture.id,
      stateId: state.id,
      theme: capture.theme,
      viewport: viewportsById.get(capture.viewportId),
      fixture: fixturesById.get(state.fixtureId),
      setup: state.setup,
      interactions: state.interactions,
      outcomes: state.outcomes,
      regions: state.regionIds.map((id) => regionsById.get(id)),
      masks: state.maskIds.map((id) => masksById.get(id)),
      capture: {
        status: capture.status,
        asset: capture.asset,
        reasonCode: capture.reasonCode,
      },
    }
  })
  return {
    schemaVersion: validated.schemaVersion,
    contractId: validated.contractId,
    pins: validated.pins,
    tolerances: {
      geometryCssPx: validated.comparison.geometryToleranceCssPx,
      changedPixelRatio: validated.comparison.changedPixelThreshold,
    },
    summary: {
      total: cases.length,
      blocked: cases.filter((entry) => entry.capture.status === 'blocked').length,
      captured: cases.filter((entry) => entry.capture.status === 'captured').length,
    },
    cases,
  }
}

function readOption(args, name) {
  const index = args.indexOf(name)
  if (index === -1) return undefined
  if (!args[index + 1]) throw new Error(`Missing value for ${name}`)
  return args[index + 1]
}

function runCli() {
  const args = process.argv.slice(2)
  const manifestPath = path.resolve(readOption(args, '--manifest') ?? DEFAULT_MANIFEST_PATH)
  const replay = buildReplayContract(loadReferenceManifest(manifestPath), { manifestPath })
  process.stdout.write(`${JSON.stringify({
    contractId: replay.contractId,
    summary: replay.summary,
    captureStatus: replay.summary.captured === replay.summary.total ? 'captured' : 'blocked',
  }, null, 2)}\n`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) runCli()
