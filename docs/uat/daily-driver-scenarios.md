# Daily-Driver Installed-Release UAT

This corpus is the human-style acceptance suite for the installed Cranberri app. Run the same scenario IDs against the baseline release, risky checkpoints, and the final installed candidate. Automation may prepare fixtures and inspect durable state, but it does not replace the visible interaction.

## Safety Contract

- Mutation scenarios use only the generated fixture root and its isolated `user-data` directory. Never register or mutate a user repository.
- Real registered repositories may be observed only in an explicitly approved read-only run. Do not capture their file names, contents, remotes, diffs, prompts, or terminal output.
- Use the synthetic Git remote already configured by the fixture. Never fetch, push, enter a token, or approve an external side effect.
- Raw screenshots, accessibility snapshots, logs, and JSON evidence remain under the OS temp root. Commit only sanitized findings without absolute fixture paths or machine identity.
- Installed-app replacement, destructive UI cleanup, system permission prompts, and secret entry require action-time user approval. DD-13 inspects update UI but does not install.
- Cleanup uses `npm run uat:daily-driver:fixtures -- cleanup --root <fixture-root>` and `npm run uat:daily-driver:evidence -- cleanup --root <evidence-root>`. Both commands dispatch `/usr/bin/trash` and reject unmarked roots.

## Fixture Bootstrap

1. Quit Cranberri and confirm no Cranberri process remains.
2. Run `npm run uat:daily-driver:fixtures -- create` and retain the printed `root`, `manifestPath`, `userDataPath`, and `fixtureSha` in the raw run notes.
3. Launch `/Applications/Cranberri.app/Contents/MacOS/Cranberri` with `CRANBERRI_USER_DATA_DIR` set to the generated `userDataPath`. Operate the resulting window through Computer Use.
4. Confirm the only registered project is **Cranberri Daily Driver Fixture**. If any real project appears, stop the run as P0 and preserve evidence without taking another mutating action.
5. Confirm Codex is authenticated before scenarios that send turns. Record authentication unavailability as `blocked`; never capture credentials or account details.
6. Before each scenario, start an evidence record as described in `daily-driver-evidence.md`. Capture before/action/after evidence for failures and key transitions.

The fixture cases are stable across runs: `local` is clean on `main`; `worktree` has one synthetic committed change; `handoff` has one unique commit; `dirty` has tracked and untracked changes; `error` provides a missing checkout path and a non-Git directory. The fixture SHA excludes temp paths and is identical for identical fixture content.

## Evidence Contract v1

The recorder accepts only the scenario IDs below. A `pass` requires every named timing, a passing durable assertion with the exact stable ID, and at least one raw evidence artifact under the marked temp evidence root. `fail` and `blocked` records still describe observed evidence, but they do not claim the pass contract was met.

| Scenario | Required timings for pass | Required durable assertion |
|---|---|---|
| DD-01 | `launchToUsableMs` | `fixture-project-only` |
| DD-02 | `launchToUsableMs`, `workspaceCoherentMs`, `windowSwitchCoherentP95Ms` | `restored-execution-identity` |
| DD-03 | None | `local-session-restored` |
| DD-04 | None | `managed-checkout-identity` |
| DD-05 | `composerKeyToPaintP95Ms` | `composer-draft-roundtrip` |
| DD-06 | None | `menu-focus-scroll-contained` |
| DD-07 | None | `active-turn-targeting` |
| DD-08 | None | `agent-checkout-identity` |
| DD-09 | `terminalReadyMs`, `browserReadyMs` | `terminal-browser-context` |
| DD-10 | `rightRailRefreshMs` | `right-rail-checkout-context` |
| DD-11 | None | `lifecycle-recovery-state` |
| DD-12 | None | `handoff-head-dirty-protection` |
| DD-13 | None | `update-metadata-no-install` |
| DD-14 | None | `compact-layout-context-preserved` |

## Scenarios

### DD-01 Cold Installed Launch

**Preconditions:** Fixture bootstrap is complete; Cranberri is fully quit; no fixture profile window has been launched in this process lifetime; window target is 1440 x 960.

**Actions:** Start timing immediately before launching the installed executable. Wait without corrective clicks until the fixture project, chat surface, composer, and right rail are usable. Traverse the first focusable controls with Tab and inspect initial loading/error states.

**Pass conditions:** The installed path and bundle metadata match the evidence record; exactly the fixture project appears; no blank, crash, secret prompt, real repo, focus trap, overlapping control, or manual refresh occurs; `launchToUsableMs <= 3000`. Capture launch-to-window and launch-to-usable timings.

### DD-02 Warm Launch, Repo Expansion, and Session Discovery

**Preconditions:** DD-03 has created one named local session and DD-04 has created one named worktree session; quit cleanly with the local session active; relaunch within five minutes using the same fixture profile.

**Actions:** Measure warm launch, expand and collapse the fixture repo, inspect active and archived session sections, switch between the known local and worktree sessions, and return to the local session.

**Pass conditions:** The project and both sessions appear once with the expected names/statuses; the previously active local session restores; header, transcript, right rail, and checkout label agree after every switch without refresh; `launchToUsableMs <= 3000`, `workspaceCoherentMs <= 500`, and each switch is fully coherent within 250 ms p95.

### DD-03 Local Session Daily Flow

**Preconditions:** Clean `local` case on `main`; no active local fixture session; Codex authenticated; normal-size window.

**Actions:** Create a local session named `DD local`, send a prompt asking Codex to read only the synthetic marker, wait for completion, inspect the transcript, switch away and back, then cleanly restart.

**Pass conditions:** One local session is created against the manifest `local.repoPath`; Codex reports `CRANBERRI_DAILY_DRIVER_UAT`; no fixture file changes; the same thread, transcript, branch, cwd, and session restore after restart; no duplicate first turn or corrective refresh.

### DD-04 Managed Worktree Flow

**Preconditions:** Clean `worktree` case exists on `uat/worktree`; no Cranberri-managed session currently owns it; Codex authenticated.

**Actions:** Create a worktree session from `main` named `DD worktree`, complete visible provisioning/setup, send a read-only marker prompt, switch local/worktree/local, and inspect checkout identity at each stop.

**Pass conditions:** Provisioning has one terminal outcome; the managed checkout is under the fixture root; the task branch/cwd matches the selected tab; chat, files, diff, GitHub, terminal/browser defaults, and agents never show the local checkout while the worktree is active; no manual refresh is needed.

### DD-05 Composer With Skill and Plugin Chips

**Preconditions:** `DD local` is idle; at least one installed skill and plugin are visible; capture their display names only, never configuration or secrets.

**Actions:** Compose at least 1,500 synthetic characters across multiple lines; insert one skill chip, one plugin chip, and the fixture README attachment; move the caret before/across/after chips, select text, backspace adjacent text, scroll top-to-bottom, switch tabs and back, then send.

**Pass conditions:** Text never escapes or resizes the composer incoherently; chips remain atomic and correctly labeled; caret/selection and scroll position remain accurate; tab switching preserves the draft exactly once; sent text/context matches the visible composition; key-to-paint is at most 50 ms p95; failure or blocked send preserves the draft.

### DD-06 Menus, Selects, and Nested Scrolling

**Preconditions:** `DD local` is idle; normal window; enough model/skill/plugin/session entries to scroll where the UI supports it.

**Actions:** Open model/reasoning, new-session, add-context, and relevant overflow menus with mouse and keyboard; scroll long menus without moving the transcript; use arrows, Home/End, Escape, and reopen each menu.

**Pass conditions:** Focus enters the opened control and returns to its trigger on Escape; active/disabled choices are announced and visible; nested scroll stays in the menu; no accidental selection/dismissal, clipping, overlap, horizontal spill, or diagnostic text appears.

### DD-07 Active Turn Controls

**Preconditions:** `DD local` is idle and authenticated; use a synthetic prompt that waits long enough to expose active controls and makes no file changes.

**Actions:** Send the prompt, verify streaming/activity state, steer once with `DD_STEER`, then stop. Send a second short prompt to prove the session remains usable.

**Pass conditions:** Send changes to the correct active control; steer is acknowledged once by the same turn; stop settles once and leaves no perpetual busy state; follow-up send succeeds in the same thread; controls are keyboard reachable, accurately labeled, and never target another session.

### DD-08 Agents

**Preconditions:** `DD worktree` is active and idle; Codex authenticated; fixture worktree is clean.

**Actions:** Ask the root turn to spawn one read-only agent that reports cwd, branch, and fixture marker. Open the agent row/task, return through the parent affordance, steer it once if still active, and wait for completion.

**Pass conditions:** One agent appears under the owning parent only; its cwd and branch match the active worktree; status transitions are intelligible and persist after switching away/back; parent/child navigation preserves both transcripts; the fixture remains clean and no agent appears in `DD local`.

### DD-09 Terminal and Browser

**Preconditions:** `DD worktree` is active; no terminal or browser window is open for it; a local synthetic HTTP server may be started from the fixture terminal only.

**Actions:** Open terminal, run `pwd`, `git branch --show-current`, and a deterministic local server; open browser to its loopback URL; navigate, reload, stop, resize, close, and reopen each surface; then switch to `DD local` and open a new terminal.

**Pass conditions:** Worktree terminal reports the manifest worktree path and branch; browser loads only loopback content and follows resize without overlap; closing terminates/cleans owned surfaces; the new local terminal uses the local path, not stale worktree context; readiness and context settle within 500 ms each.

### DD-10 Files, Diff, and GitHub Context

**Preconditions:** `dirty` case is active for dirty-state inspection; no network request is required; synthetic origin remains `example/cranberri-daily-driver-fixture`.

**Actions:** Inspect file tree, select tracked/untracked files, switch working/HEAD diff views where available, scroll a long diff, and inspect each GitHub panel state. Switch to clean local and committed worktree cases and repeat the context check.

**Pass conditions:** File/diff status matches manifest and `git status`; selected content is synthetic; right-rail refresh settles within 500 ms; GitHub shows the synthetic owner/repo or a concise offline/empty state without prompting for a token; late results from the previous checkout never paint into the current one.

### DD-11 Lifecycle and Recovery

**Preconditions:** Synthetic local and worktree sessions exist; all turns/processes are settled; capture durable state before each subcase.

**Actions:** Archive and restore a session; delete a disposable synthetic session with confirmation; force quit only after an acknowledged tab/session mutation; relaunch; then run the missing-checkout and non-Git error cases in a fresh fixture profile.

**Pass conditions:** Archive/restore/delete update tabs and repo rail once without refresh; focus moves predictably; acknowledged state survives forced quit without duplicate tabs/threads; missing/invalid checkout fails closed with a named repair/retry/discard path and never falls back to local or a real repo.

### DD-12 Handoff and Dirty Protection

**Preconditions:** `handoff` has one unique commit; `dirty` has the manifest tracked/untracked status; no active process owns either case; local checkout is on `main`.

**Actions:** Perform worktree-to-local handoff for the clean handoff case, inspect local branch/HEAD, return as supported, then attempt handoff/archive/removal against the dirty case and cancel at the protection prompt.

**Pass conditions:** Clean handoff transfers the exact branch and manifest `headSha` with no lost commit; all surfaces move to the local checkout coherently; dirty/unpushed work is named and protected; cancellation changes no Git ref/file; no cleanup touches paths outside the marked fixture root.

### DD-13 Update Inspection

**Preconditions:** Installed app is idle; fixture profile is active; network availability is recorded; no install approval has been given.

**Actions:** Open update settings/status, request a check if available, inspect channel/current/candidate metadata and all menus/toasts, then dismiss or defer. Do not activate install/replacement.

**Pass conditions:** Current version/build/bundle/path agree with evidence; update availability or offline failure is concise and recoverable; channel/candidate state is unambiguous; no secret, raw stack, duplicate toast, forced quit, download/install, or fixture mutation occurs.

### DD-14 Normal and Compact Windows

**Preconditions:** `DD local` contains a transcript, long draft with chips, agent history, terminal/browser state, and a non-empty diff; start at 1440 x 960.

**Actions:** Inspect every primary surface at normal size; resize to 960 x 640 and then the smallest allowed size; open menus, scroll transcript/composer/rails, toggle terminal/browser, and return to normal size.

**Pass conditions:** Chat remains the dominant surface; all text fits or truncates intentionally with an accessible full label; no controls overlap, jump, or become unreachable; independent scroll regions remain usable; active context and draft survive each resize; returning to normal restores a coherent layout.

## Run Completion

A scenario passes only when every pass condition is observed and every durable assertion passes. Use `fail` with P0/P1/P2 for a product defect and `blocked` when an external prerequisite prevents a verdict. Do not convert a visible failure into a pass because a source test succeeds. Record cleanup as a separate operator action after all evidence paths have been reviewed.
