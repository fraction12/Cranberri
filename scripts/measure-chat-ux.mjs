#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'

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

function count(pattern, text) {
  return [...text.matchAll(pattern)].length
}

const chatPath = 'src/renderer/components/ChatWindow.tsx'
const statePath = 'src/renderer/state/codex.tsx'
const clientPath = 'src/main/codex/client.ts'
const telemetryPath = 'src/main/telemetry.ts'

const chatExists = existsSync(chatPath)
const stateExists = existsSync(statePath)
const clientExists = existsSync(clientPath)
const telemetryExists = existsSync(telemetryPath)

const chat = chatExists ? readFileSync(chatPath, 'utf8') : ''
const state = stateExists ? readFileSync(statePath, 'utf8') : ''
const client = clientExists ? readFileSync(clientPath, 'utf8') : ''

const build = run('npm', ['run', 'build'])

const renderWorkingGroupCount = count(/<ReasoningGroup\b/g, chat)
const explicitDuplicateGuard = /hasRunningReasoning/.test(chat) && /!hasRunningReasoning/.test(chat)
const deltaIgnoredBeforeReducer = /if \(e\.type === 'agent_message_delta'\) \{\s*return\s*\}/s.test(state)
const deltaSchedulesVisibleText = /case 'agent_message_delta'[\s\S]{0,300}(thread\.messages|scheduleDeltaFlush)/.test(state)
const completionPhaseRouting = /e\.phase === 'final_answer' \? 'assistant' : 'reasoning'/.test(state)
const compactHydration = /item\.type === 'contextCompaction' \|\| item\.type === 'compaction'/.test(state)
const compactProtocol = /thread\/compact\/start/.test(client)
const telemetryAvailable = telemetryExists && /debug-telemetry\.jsonl/.test(readFileSync(telemetryPath, 'utf8'))
const chatSnapshotTelemetry = /chat-window:snapshot/.test(chat)
const telemetryLogsOnEveryThreadObject = /\}, \[id, thread, telemetryKey\]\)/.test(chat)
const replayUsesInterval = /window\.setInterval\(step,/.test(state)
const runEndDoesNotCancelReplay = replayUsesInterval && !/case 'run_end':[\s\S]{0,900}clearInterval\(streamTimersRef\.current/.test(state)
const duplicateRunEndRisk = /this\.emit\('event', \{ type: 'run_end'/.test(client) && count(/type: 'run_end'/g, client) > 1

let score = 0
score += build.code === 0 ? 20 : 0
score += explicitDuplicateGuard ? 12 : 0
score += deltaIgnoredBeforeReducer && !deltaSchedulesVisibleText ? 18 : 0
score += completionPhaseRouting ? 8 : 0
score += compactHydration ? 8 : 0
score += compactProtocol ? 8 : 0
score += telemetryAvailable && chatSnapshotTelemetry ? 6 : 0
score += !runEndDoesNotCancelReplay ? 12 : 0
score += !telemetryLogsOnEveryThreadObject ? 4 : 0
score += !duplicateRunEndRisk ? 4 : 0
score = Math.min(100, score)

const metrics = {
  chat_affordance_score: score,
  build_passed: build.code === 0 ? 1 : 0,
  chat_files_present: chatExists && stateExists && clientExists ? 1 : 0,
  duplicate_running_affordance_static: explicitDuplicateGuard ? 0 : 1,
  raw_delta_render_static: deltaIgnoredBeforeReducer && !deltaSchedulesVisibleText ? 0 : 1,
  build_seconds: Number(build.seconds.toFixed(3)),
  reasoning_group_render_sites: renderWorkingGroupCount,
  compact_hydration: compactHydration ? 1 : 0,
  compact_protocol: compactProtocol ? 1 : 0,
  telemetry_available: telemetryAvailable ? 1 : 0,
  chat_snapshot_telemetry: chatSnapshotTelemetry ? 1 : 0,
  run_end_replay_risk: runEndDoesNotCancelReplay ? 1 : 0,
  telemetry_churn_risk: telemetryLogsOnEveryThreadObject ? 1 : 0,
  duplicate_run_end_risk: duplicateRunEndRisk ? 1 : 0,
}

process.stdout.write(`${JSON.stringify(metrics)}\n`)
if (build.code !== 0) {
  process.stderr.write(`${build.stdout}\n${build.stderr}\n`)
  process.exit(1)
}
