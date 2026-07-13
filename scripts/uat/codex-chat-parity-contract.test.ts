import { describe, expect, it, vi } from 'vitest'
import {
  REQUIRED_STATE_IDS,
  buildReplayContract,
  loadReferenceManifest,
  validateReferenceManifest,
} from './codex-chat-parity-contract.mjs'

function clone<T>(value: T): T {
  return structuredClone(value)
}

describe('native Codex chat parity reference contract', () => {
  it('validates the checked-in blocked manifest without looking for fabricated screenshots', () => {
    const manifest = loadReferenceManifest()
    const fileExists = vi.fn(() => false)

    const validated = validateReferenceManifest(manifest, { fileExists })
    const replay = buildReplayContract(validated)

    expect(validated.states.map((state) => state.id)).toEqual(REQUIRED_STATE_IDS)
    expect(replay.summary).toEqual({ total: 64, blocked: 64, captured: 0 })
    expect(replay.cases).toHaveLength(64)
    expect(fileExists).not.toHaveBeenCalled()
  })

  it('requires exact build, CLI, schema, display, and interface metadata', () => {
    const manifest = clone(loadReferenceManifest())
    delete manifest.pins.nativeApp.desktopVersion

    expect(() => validateReferenceManifest(manifest)).toThrow(/desktopVersion/)

    const drifted = clone(loadReferenceManifest())
    drifted.pins.cli.nativeBundledVersion = 'codex-cli latest'
    expect(() => validateReferenceManifest(drifted)).toThrow(/must equal pinned value/)
  })

  it('requires replayable setup, interactions, outcomes, and fixed viewport geometry', () => {
    const missingOutcome = clone(loadReferenceManifest())
    missingOutcome.states[0].outcomes = []
    expect(() => validateReferenceManifest(missingOutcome)).toThrow(/outcomes.*must not be empty/)

    const driftedViewport = clone(loadReferenceManifest())
    driftedViewport.matrix.viewports[0].width = 1399
    expect(() => validateReferenceManifest(driftedViewport)).toThrow(/must be desktop-1400x900 at 1400x900/)
  })

  it('rejects masks that were not declared before capture', () => {
    const manifest = clone(loadReferenceManifest())
    manifest.states[0].maskIds.push('after-the-fact-waiver')

    expect(() => validateReferenceManifest(manifest)).toThrow(/undeclared mask after-the-fact-waiver/)
  })

  it('rejects a captured claim without a screenshot asset path', () => {
    const manifest = clone(loadReferenceManifest())
    manifest.capturePolicy.status = 'capture-in-progress'
    manifest.captures[0].status = 'captured'
    manifest.captures[0].reasonCode = null

    expect(() => validateReferenceManifest(manifest)).toThrow(/captured entry requires asset/)
  })

  it('checks screenshot existence only for entries that claim captured', () => {
    const manifest = clone(loadReferenceManifest())
    const captured = manifest.captures[0]
    manifest.capturePolicy.status = 'capture-in-progress'
    captured.status = 'captured'
    captured.reasonCode = null
    captured.asset = `assets/${captured.id}.png`
    const fileExists = vi.fn(() => false)

    expect(() => validateReferenceManifest(manifest, { fileExists })).toThrow(/screenshot does not exist/)
    expect(fileExists).toHaveBeenCalledTimes(1)

    fileExists.mockReturnValue(true)
    expect(() => validateReferenceManifest(manifest, { fileExists })).not.toThrow()
  })

  it('rejects blocked entries that imply an asset exists', () => {
    const manifest = clone(loadReferenceManifest())
    manifest.captures[0].asset = 'assets/fabricated.png'

    expect(() => validateReferenceManifest(manifest)).toThrow(/blocked entry must not declare asset/)
  })

  it('rejects real-looking or unclassified fixture content', () => {
    const unclassified = clone(loadReferenceManifest())
    unclassified.fixtures[0].classification = 'unknown'
    expect(() => validateReferenceManifest(unclassified)).toThrow(/synthetic-non-sensitive/)

    const sensitive = clone(loadReferenceManifest())
    sensitive.fixtures[0].content.prompt = 'Use token ghp_examplethatmustneverbecommitted'
    expect(() => validateReferenceManifest(sensitive)).toThrow(/sensitive-looking fixture content/)
  })

  it('rejects missing matrix cases and unknown manifest fields', () => {
    const missing = clone(loadReferenceManifest())
    missing.captures.pop()
    expect(() => validateReferenceManifest(missing)).toThrow(/capture matrix must contain 64 entries/)

    const unknown = clone(loadReferenceManifest())
    Object.assign(unknown, { waiveMismatch: true })
    expect(() => validateReferenceManifest(unknown)).toThrow(/unknown field waiveMismatch/)
  })
})
