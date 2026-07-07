#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'

function run(command, args) {
  const started = performance.now()
  const result = spawnSync(command, args, { encoding: 'utf8', shell: false })
  return {
    code: result.status ?? 1,
    seconds: (performance.now() - started) / 1000,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  }
}

function sizeKb(filePath) {
  return statSync(filePath).size / 1024
}

function rounded(value) {
  return Number(value.toFixed(3))
}

function rendererMetrics() {
  const rendererDir = 'out/renderer'
  const assetsDir = join(rendererDir, 'assets')
  const indexPath = join(rendererDir, 'index.html')

  if (!existsSync(assetsDir)) {
    return {
      renderer_entry_js_exists: 0,
      renderer_entry_js_kb: 0,
      renderer_total_js_kb: 0,
      renderer_css_kb: 0,
      renderer_chunk_count: 0,
      largest_chunk_kb: 0,
      asset_count: 0,
    }
  }

  const assets = readdirSync(assetsDir)
  const jsAssets = assets.filter((asset) => asset.endsWith('.js'))
  const cssAssets = assets.filter((asset) => asset.endsWith('.css'))
  const indexHtml = existsSync(indexPath) ? readFileSync(indexPath, 'utf8') : ''
  const entryMatch = indexHtml.match(/<script[^>]+type=["']module["'][^>]+src=["'][^"']*assets\/([^"']+\.js)["']/)
  const entryName = entryMatch?.[1] ?? jsAssets.find((asset) => asset.startsWith('index-')) ?? null
  const jsSizes = jsAssets.map((asset) => sizeKb(join(assetsDir, asset)))

  return {
    renderer_entry_js_exists: entryName && existsSync(join(assetsDir, entryName)) ? 1 : 0,
    renderer_entry_js_kb: entryName && existsSync(join(assetsDir, entryName)) ? rounded(sizeKb(join(assetsDir, entryName))) : 0,
    renderer_total_js_kb: rounded(jsSizes.reduce((total, value) => total + value, 0)),
    renderer_css_kb: rounded(cssAssets.reduce((total, asset) => total + sizeKb(join(assetsDir, asset)), 0)),
    renderer_chunk_count: jsAssets.length,
    largest_chunk_kb: rounded(jsSizes.length > 0 ? Math.max(...jsSizes) : 0),
    asset_count: assets.length,
  }
}

const test = run('npm', ['test'])
rmSync('out/renderer', { recursive: true, force: true })
const build = run('npm', ['run', 'build'])
const metrics = {
  build_passed: build.code === 0 ? 1 : 0,
  tests_passed: test.code === 0 ? 1 : 0,
  build_seconds: rounded(build.seconds),
  test_seconds: rounded(test.seconds),
  ...rendererMetrics(),
}

process.stdout.write(`${JSON.stringify(metrics)}\n`)

if (test.code !== 0 || build.code !== 0) {
  process.stderr.write([
    test.code !== 0 ? `npm test failed:\n${test.stdout}\n${test.stderr}` : '',
    build.code !== 0 ? `npm run build failed:\n${build.stdout}\n${build.stderr}` : '',
  ].filter(Boolean).join('\n\n'))
  process.exit(1)
}
