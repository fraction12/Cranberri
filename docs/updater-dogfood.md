# Cranberri updater dogfood

This checklist covers stable GitHub artifacts and beta source builds. Stable releases are the daily-driver path; beta remains available for rehearsals.

## TL;DR

1. Package Cranberri as a macOS `.app` via `npm run package` or `npm run package:dir`.
2. Build metadata (`src/shared/buildInfo.json`) is embedded with `commit`, `branch`, `version`, and `packaged: true`.
3. The packaged app compares its commit to `origin/main` in a configured Cranberri source repo.
4. If behind, the app can build the latest `main` in a hidden staging area under `~/Library/Application Support/Cranberri/updater-staging`.
5. Cranberri blocks install while tasks, workers, setup jobs, terminals, or handoffs are active and flushes workspace/draft state.
6. A detached helper copies a candidate beside the installed app, journals same-volume rename promotion, and keeps the previous app until the recovered renderer acknowledges health.
7. A watchdog restores the previous app if promotion is interrupted or the candidate never acknowledges startup health.

## New/changed files

- `electron-builder.yml` — macOS packaging config, unsigned, `.app` + `dmg` + `zip`, `node-pty` unpacked.
- `package.json` — new scripts: `copy:updater-helper`, `build:metadata`, `package`, `package:dir`.
- `scripts/build-metadata.mjs` — writes `src/shared/buildInfo.json` from `git` and `package.json`.
- `scripts/updater/install-helper.mjs` and `install-watchdog.mjs` — journaled promotion, rollback, and relaunch.
- `scripts/validate-release.mjs` — tag, package, bundle, architecture, and SHA-256 release validation.
- `src/shared/buildInfo.ts` + `src/shared/buildInfo.json` — typed build metadata.
- `src/shared/update.ts` — updater domain types and zod schemas.
- `src/main/updater.ts` — source-repo resolution, `origin/main` comparison, staging build, install orchestration.
- `src/renderer/state/update.ts` — renderer hook for update state/progress.
- `src/renderer/components/SettingsDialog.tsx` — new **Updates** tab with status, progress, check/install actions.
- `src/main/index.ts`, `src/preload/index.ts`, `src/renderer/vite-env.d.ts` — IPC wiring.
- `src/shared/settings.ts`, `src/main/settings.ts` — added optional `updater.sourceRepoPath`.

## Dogfood checklist

### Packaging smoke test
- [ ] Run `npm run typecheck` and `npm run lint` — both pass.
- [ ] Run `npm run package:dir`.
- [ ] Run `TAG=v<package-version> npm run validate:release`.
- [ ] Verify both updater helpers exist under `Contents/Resources/app.asar.unpacked/out/updater/`.
- [ ] Launch the packaged app from Finder or `open dist/mac-arm64/Cranberri.app`.
- [ ] Open Settings → About and confirm the Version matches `package.json`.
- [ ] Open Settings → Updates and confirm it shows the running commit and `developmentMode` is NOT reported (unless you launched from dev).

### Update detection
- [ ] Register or configure the local Cranberri source repo as the update source. (Fallback: add the repo via the repo picker; the updater will discover a GitHub origin.)
- [ ] Make a test commit on `main` and push to `origin/main`.
- [ ] Click **Check for updates** in Settings → Updates.
- [ ] Confirm the UI shows "N commits behind" with the correct current and latest commits.
- [ ] Reset/force-push the test commit away before doing a real install.

### Staging build
- [ ] With an update available, click **Build & install update**.
- [ ] Confirm progress messages appear (preparing → fetching → dependencies → building → packaging → readyToInstall).
- [ ] Verify `~/Library/Application Support/Cranberri/updater-staging/source/dist/mac-arm64/Cranberri.app` exists after packaging completes.

### Install and relaunch (destructive)
- [ ] Close any unsaved work.
- [ ] Click **Build & install update** (or proceed from a previous staging build).
- [ ] The app should quit.
- [ ] The detached helper logs to the parent terminal (if any) and to the result manifest.
- [ ] The old app is renamed to `.Cranberri.previous.app` beside the install.
- [ ] The complete candidate is promoted by same-volume rename.
- [ ] The new app launches via `/usr/bin/open -n <path>`.
- [ ] After workspace recovery, `updater-journal.json` records `healthAcknowledged` and the backup moves to Trash.
- [ ] On relaunch, Settings → Updates shows the new commit, or a failure message if something went wrong.

### Failure modes to verify
- [ ] Dev build reports `developmentMode` and disables install.
- [ ] No source repo configured reports `noSourceRepo`.
- [ ] Source repo with no GitHub origin reports `sourceNotGitHub`.
- [ ] Source repo with uncommitted changes is a hard blocker.
- [ ] Active Codex work, environment setup, handoff, terminal, or child process blocks install.
- [ ] A mismatched tag, manifest, digest, bundle ID, version, or architecture blocks stable install.
- [ ] `npm run test:updater-helper` passes promotion, rollback, watchdog, and quiescence tests.
- [ ] Running commit not in source history reports `comparisonUnknown`.
- [ ] Failed staging build writes the failure to status and leaves the build log path visible in the UI.

## Remaining release policy

- The installer currently targets `dist/mac-arm64/Cranberri.app` only. Intel builds and non-macOS platforms are not supported.
- Local beta packaging remains usable without signing credentials. Release runners should provide an Apple signing identity and notarization credentials; packaged smoke remains mandatory either way.
- The helper is run via the Electron binary (`process.execPath`) executing a `.mjs` file. If the script accidentally imports Electron modules, it could try to create a window; it currently does not.
- `npm install` in the staging area may take a long time and currently has no cancellation.
- The app must already have a registered repo whose origin is GitHub, or `updater.sourceRepoPath` must be set in settings. There is no UI yet to explicitly pick the update source repo from Settings.

## FAQ

**Why is the dev build blocked from self-updating?**
Dev builds already run from source; telling them to update would replace the source checkout with a packaged app. The blocked message tells the user to use git directly.

**What happens if the install helper fails?**
It restores the previous app, preserves the failed candidate for diagnosis, journals `rolledBack`, writes `updater-result.json`, and relaunches the restored app. If the helper dies or the candidate never acknowledges startup health, the watchdog performs the same recovery.

**Where is the build log?**
`~/Library/Application Support/Cranberri/updater-staging/build.log`.

**Can I roll back?**
Promotion retains the previous bundle until the candidate restores workspace state and acknowledges health. Interrupted promotion rolls back automatically.
