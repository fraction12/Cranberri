import { execFileSync, spawnSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { assertReleaseIdentity } from './release-contract.mjs'

const root = process.cwd()
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const schemas = JSON.parse(fs.readFileSync(path.join(root, 'src', 'shared', 'persistence-schema-versions.json'), 'utf8'))
const tag = process.env.TAG ?? process.argv.find((arg) => arg.startsWith('v'))
if (!tag) throw new Error('Release tag is required through TAG or a v-prefixed argument')
const commit = process.env.GITHUB_SHA ?? execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
const tagResolution = spawnSync('git', ['rev-parse', `${tag}^{commit}`], { cwd: root, encoding: 'utf8' })
const tagCommit = tagResolution.status === 0 ? tagResolution.stdout.trim() : null
assertReleaseIdentity({ currentCommit: commit, packageVersion: packageJson.version, tag, tagCommit })

const appPath = path.join(root, 'dist', 'mac-arm64', 'Cranberri.app')
const plistPath = path.join(appPath, 'Contents', 'Info.plist')
const executablePath = path.join(appPath, 'Contents', 'MacOS', 'Cranberri')
const helperPath = path.join(appPath, 'Contents', 'Resources', 'app.asar.unpacked', 'out', 'updater', 'install-helper.mjs')
const watchdogPath = path.join(appPath, 'Contents', 'Resources', 'app.asar.unpacked', 'out', 'updater', 'install-watchdog.mjs')
for (const required of [plistPath, executablePath, helperPath, watchdogPath]) {
  if (!fs.existsSync(required)) throw new Error(`Packaged release file is missing: ${required}`)
}

const plist = JSON.parse(execFileSync('/usr/bin/plutil', ['-convert', 'json', '-o', '-', plistPath], { encoding: 'utf8' }))
if (plist.CFBundleIdentifier !== 'com.dushyantgarg.cranberri') throw new Error(`Unexpected bundle identifier: ${plist.CFBundleIdentifier}`)
if (plist.CFBundleShortVersionString !== packageJson.version) throw new Error(`Bundle version ${plist.CFBundleShortVersionString} does not match ${packageJson.version}`)
const executableDescription = execFileSync('/usr/bin/file', [executablePath], { encoding: 'utf8' })
if (!executableDescription.includes('arm64')) throw new Error(`Packaged executable is not arm64: ${executableDescription.trim()}`)

const codesign = spawnSync('/usr/bin/codesign', ['-dv', '--verbose=4', appPath], { encoding: 'utf8' })
const signatureOutput = `${codesign.stdout ?? ''}\n${codesign.stderr ?? ''}`.trim()
const signature = /not signed at all|code object is not signed|Info\.plist=not bound|Sealed Resources=none/i.test(signatureOutput) || !signatureOutput
  ? 'unsigned'
  : /Authority=Developer ID Application:/i.test(signatureOutput)
    ? 'developerId'
    : /Signature=adhoc/i.test(signatureOutput)
      ? 'adHoc'
      : 'other'
if (signature === 'other') throw new Error('Packaged app uses an unsupported signing identity')
if (signature !== 'unsigned') {
  const verification = spawnSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', appPath], { encoding: 'utf8' })
  if (verification.status !== 0) throw new Error(`Packaged app signature verification failed: ${verification.stderr.trim()}`)
}

const zipName = fs.readdirSync(path.join(root, 'dist')).find((name) => new RegExp(`^Cranberri-${packageJson.version.replaceAll('.', '\\.')}.*arm64-mac\\.zip$`).test(name))
if (!zipName) throw new Error('Packaged updater ZIP was not found')
const zipPath = path.join(root, 'dist', zipName)
const sha256 = crypto.createHash('sha256').update(fs.readFileSync(zipPath)).digest('hex')
const manifest = {
  version: 1,
  tag,
  packageVersion: packageJson.version,
  commit,
  channel: process.env.PRERELEASE === 'true' ? 'beta' : 'stable',
  asset: { name: zipName, sha256, bytes: fs.statSync(zipPath).size },
  bundle: {
    identifier: plist.CFBundleIdentifier,
    version: plist.CFBundleShortVersionString,
    architecture: 'arm64',
    minimumSystemVersion: plist.LSMinimumSystemVersion ?? null,
    signature,
  },
  schemas,
}
fs.writeFileSync(path.join(root, 'dist', 'release-manifest.json'), JSON.stringify(manifest, null, 2))
console.log(`Validated ${tag}; wrote dist/release-manifest.json for ${zipName}`)
