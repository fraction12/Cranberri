import { defineConfig } from '@playwright/test'
import os from 'node:os'
import path from 'node:path'

export default defineConfig({
  testDir: './scripts/uat',
  testMatch: 'codex-chat-parity.spec.ts',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'line',
  outputDir: path.join(os.tmpdir(), 'cranberri-chat-parity-results'),
  use: {
    trace: 'retain-on-failure',
  },
})
