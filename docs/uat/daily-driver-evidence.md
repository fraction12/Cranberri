# Daily-Driver UAT Evidence

The evidence helper creates one raw JSON record per scenario under a marked OS-temp directory. It discovers installed bundle metadata, records machine characteristics without hostname or account identity, binds the run to the deterministic fixture SHA, and validates the final result. Raw artifacts never belong in Git.

## Start a Record

Create fixtures first, then start one record immediately before the scenario:

```bash
npm run uat:daily-driver:evidence -- start \
  --scenario DD-01 \
  --fixture /tmp/cranberri-daily-driver-uat-XXXXXX/fixture-manifest.json \
  --app /Applications/Cranberri.app
```

The command prints `artifactRoot`, `recordPath`, and the pending record. Keep screenshots, accessibility snapshots, sanitized terminal captures, and state-assertion output inside that `artifactRoot`. The helper reads these installed-app keys from `Contents/Info.plist`:

- `CFBundleShortVersionString` as `app.version`
- `CFBundleVersion` as `app.build`
- `CFBundleIdentifier` as `app.bundleId`
- Resolved installed bundle location as `app.path`

Machine metadata contains OS platform/release, architecture, CPU model/count, and total memory. It intentionally excludes hostname, username, serial number, account information, and environment variables.

## Capture Evidence

Use monotonic timing at the operator boundary when available. Otherwise record a clearly marked wall-clock observation. Required named timings for scenarios that exercise them are:

- `launchToWindowMs` and `launchToUsableMs`
- `workspaceCoherentMs` and `sessionSwitchMs`
- `rightRailRefreshMs`
- `composerKeyToPaintP95Ms`
- `terminalReadyMs` and `browserReadyMs`
- Any additional timing named for the visible action, with milliseconds as a non-negative number

State assertions pair visible behavior with durable fixture state. Each assertion has a stable `id`, boolean `passed`, and sanitized `actual` summary. Useful assertions include `active-checkout`, `thread-restored`, `fixture-git-status`, `terminal-cwd`, `agent-cwd`, `handoff-head`, `draft-restored`, and `no-real-repos-visible`.

Evidence paths must be absolute, exist at finish time, and remain under the OS temp root. Use descriptive kinds such as `screenshot-before`, `screenshot-after`, `accessibility-after`, `git-state`, or `timing-log`. Never capture secrets, real repo paths/content, account data, full process environments, or private remote URLs.

## Finish a Record

Repeat `--timing`, `--assertion`, and `--evidence` as needed:

```bash
npm run uat:daily-driver:evidence -- finish \
  --record /tmp/cranberri-daily-driver-evidence-XXXXXX/DD-01.json \
  --result pass \
  --severity none \
  --timing launchToWindowMs=410 \
  --timing launchToUsableMs=842 \
  --assertion no-real-repos-visible=pass:fixture-only \
  --assertion workspace-visible=pass:local-fixture-selected \
  --evidence screenshot-after=/tmp/cranberri-daily-driver-evidence-XXXXXX/after.png
```

`pass` requires severity `none` and no failed assertion. `fail` requires P0, P1, or P2. `blocked` means the scenario could not produce a product verdict because an external prerequisite such as Codex authentication or network availability was absent; assign the severity of the blocked release risk.

## Severity and Result

| Severity | Meaning |
|---|---|
| P0 | Data loss, secret/real-repo exposure, mutation outside fixtures, unrecoverable app/update failure, or wrong-repo execution. Stop the run. |
| P1 | Daily flow cannot complete, state is lost/duplicated, manual refresh is required, identity drifts, or a required recovery path fails. Blocks release. |
| P2 | Material interaction, accessibility, layout, feedback, or performance defect that does not violate a P0/P1 invariant. Triage explicitly. |
| none | All pass conditions and assertions succeeded. |

`result` is `pass`, `fail`, or `blocked` after finish. A newly started record remains `pending` until the operator supplies a verdict.

## Record Shape

```json
{
  "schemaVersion": 1,
  "scenarioId": "DD-01",
  "startedAt": "ISO-8601 timestamp",
  "updatedAt": "ISO-8601 timestamp",
  "app": {
    "version": "0.1.11",
    "build": "1011",
    "bundleId": "com.fraction12.cranberri",
    "path": "/Applications/Cranberri.app"
  },
  "machine": {
    "platform": "darwin",
    "release": "OS release",
    "arch": "arm64",
    "cpuModel": "CPU model",
    "cpuCount": 10,
    "totalMemoryBytes": 17179869184
  },
  "fixtureSha": "64 lowercase hex characters",
  "fixtureManifestPath": "/tmp/.../fixture-manifest.json",
  "timings": { "launchToUsableMs": 842 },
  "stateAssertions": [
    { "id": "workspace-visible", "passed": true, "actual": "local fixture selected" }
  ],
  "severity": "none",
  "result": "pass",
  "evidencePaths": [
    { "kind": "screenshot-after", "path": "/tmp/.../after.png" }
  ]
}
```

## Sanitized Audit Summary

The committed baseline/final audit may include scenario ID, app version/build/bundle, fixture SHA, machine class, timings, assertion names, result/severity, and concise defect text. Replace raw absolute paths with stable labels and link findings by scenario ID. Do not commit the raw record, screenshot, accessibility tree, log, fixture repository, or user-data profile.

Before summarizing, verify every documented scenario has a record and every P0/P1/P2 has a linked finding. A missing record is `blocked`, not implicitly passed. Source tests and packaged smoke runs are supporting evidence only; they cannot replace installed-app observation.

## Cleanup

After the sanitized summary is complete and raw evidence is no longer needed:

```bash
npm run uat:daily-driver:evidence -- cleanup --root /tmp/cranberri-daily-driver-evidence-XXXXXX
npm run uat:daily-driver:fixtures -- cleanup --root /tmp/cranberri-daily-driver-uat-XXXXXX
```

Cleanup validates the temp-root guard marker and uses `/usr/bin/trash`. If marker validation fails, stop and inspect the supplied path; do not substitute another deletion command.
