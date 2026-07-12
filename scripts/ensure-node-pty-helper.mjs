#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

export function ensureNodePtyHelpersExecutable(nodePtyRoot, platform = process.platform, arch = process.arch) {
  if (platform === 'win32') return []
  const candidates = [
    path.join(nodePtyRoot, 'build', 'Release', 'spawn-helper'),
    path.join(nodePtyRoot, 'prebuilds', `${platform}-${arch}`, 'spawn-helper'),
  ]
  const helpers = candidates.filter(fs.existsSync)
  if (helpers.length === 0) throw new Error(`node-pty spawn-helper is missing for ${platform}-${arch}`)
  for (const helper of helpers) {
    const mode = fs.statSync(helper).mode & 0o777
    if ((mode & 0o111) !== 0o111) fs.chmodSync(helper, mode | 0o111)
  }
  return helpers
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null
if (invokedPath === fileURLToPath(import.meta.url)) {
  const require = createRequire(import.meta.url)
  const nodePtyRoot = path.dirname(require.resolve('node-pty/package.json'))
  const helpers = ensureNodePtyHelpersExecutable(nodePtyRoot)
  process.stdout.write(`Verified node-pty helper: ${helpers.join(', ')}\n`)
}
