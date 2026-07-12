#!/usr/bin/env node
import fs from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const executable = require('electron')
if (typeof executable !== 'string' || !fs.existsSync(executable)) {
  throw new Error('Electron executable was not materialized during install')
}
process.stdout.write(`Verified Electron binary: ${executable}\n`)
