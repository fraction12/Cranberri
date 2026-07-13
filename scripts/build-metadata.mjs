import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import childProcess from 'node:child_process'
import { resolveBuildChannel } from './build-channel.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const sharedDir = path.join(root, 'src', 'shared')

function exec(command, args, options = {}) {
  const result = childProcess.spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    ...options,
  })
  if (result.error) throw result.error
  return result.stdout?.trim() ?? ''
}

let commit = ''
let branch = ''
let commitTime = ''
try {
  commit = exec('git', ['rev-parse', 'HEAD'])
  branch = exec('git', ['rev-parse', '--abbrev-ref', 'HEAD'])
  commitTime = exec('git', ['log', '-1', '--format=%cI', 'HEAD'])
} catch (error) {
  console.warn('Failed to read git metadata:', error.message)
}

const isPackaged = process.argv.includes('--packaged') || process.env.CRANBERRI_PACKAGED === 'true'
const channel = resolveBuildChannel({
  packaged: isPackaged,
  requested: process.env.CRANBERRI_BUILD_CHANNEL,
})
const schemas = JSON.parse(fs.readFileSync(path.join(sharedDir, 'persistence-schema-versions.json'), 'utf8'))
const buildInfo = {
  commit: commit || 'unknown',
  branch: branch || 'unknown',
  commitTime: commitTime || new Date().toISOString(),
  buildTime: new Date().toISOString(),
  version: JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version,
  packaged: isPackaged,
  channel,
  schemas,
}

const outputPath = path.join(sharedDir, 'buildInfo.generated.json')
fs.mkdirSync(sharedDir, { recursive: true })
fs.writeFileSync(outputPath, JSON.stringify(buildInfo, null, 2) + '\n')
console.log(`Wrote build metadata to ${outputPath}:`, buildInfo)
