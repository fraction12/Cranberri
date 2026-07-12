import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ensureNodePtyHelpersExecutable } from './ensure-node-pty-helper.mjs'

const roots = []

function fixtureHelper(mode = 0o644) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cranberri-node-pty-'))
  roots.push(root)
  const helper = path.join(root, 'prebuilds', 'darwin-arm64', 'spawn-helper')
  fs.mkdirSync(path.dirname(helper), { recursive: true })
  fs.writeFileSync(helper, 'fixture')
  fs.chmodSync(helper, mode)
  return { root, helper }
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe('ensureNodePtyHelpersExecutable', () => {
  it('restores execute bits on a packaged Unix helper', () => {
    const { root, helper } = fixtureHelper()

    expect(ensureNodePtyHelpersExecutable(root, 'darwin', 'arm64')).toEqual([helper])
    expect(fs.statSync(helper).mode & 0o777).toBe(0o755)
  })

  it('fails a Unix install that has no usable helper', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cranberri-node-pty-'))
    roots.push(root)

    expect(() => ensureNodePtyHelpersExecutable(root, 'darwin', 'arm64')).toThrow(/spawn-helper is missing/)
  })

  it('does not require a spawn helper on Windows', () => {
    expect(ensureNodePtyHelpersExecutable('/missing', 'win32', 'x64')).toEqual([])
  })
})
