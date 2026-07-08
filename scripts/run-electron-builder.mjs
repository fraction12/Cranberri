import { spawnSync } from 'node:child_process'
import electronPackage from 'electron/package.json' with { type: 'json' }

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const nativeModules = 'better-sqlite3,bufferutil,node-pty,utf-8-validate'
const electronVersion = electronPackage.version

const electronRebuild = spawnSync(npmCommand, [
  'exec',
  'electron-rebuild',
  '--',
  '--version',
  electronVersion,
  '--force',
  '--which-module',
  nativeModules,
], {
  stdio: 'inherit',
})
const electronRebuildStatus = electronRebuild.status ?? 1
if (electronRebuildStatus) process.exit(electronRebuildStatus)

const builder = spawnSync(npmCommand, ['exec', 'electron-builder', '--', ...process.argv.slice(2)], {
  stdio: 'inherit',
})
const builderStatus = builder.status ?? 1

const rebuild = spawnSync(npmCommand, ['run', 'rebuild:native:node'], {
  stdio: 'inherit',
})
const rebuildStatus = rebuild.status ?? 1

process.exit(builderStatus || rebuildStatus)
