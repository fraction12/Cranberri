# Daily-Driver Baseline Audit

Date: 2026-07-12

## Installed Artifact

- Path: `/Applications/Cranberri.app`
- Version/build: `0.1.11` / `0.1.11`
- Bundle: `com.dushyantgarg.cranberri`
- Profile: normal user profile, real registered repositories observed read-only
- Operator: Computer Use through the visible installed application

## Observed Passes

- Registered repositories and their session lists loaded without a manual refresh.
- Switching from a worktree chat to a new local chat changed the visible execution label from `Worktree · from main` to `Local · main`.
- Files, Diff, and Agents tabs switched immediately and showed context-appropriate empty states.
- Opening a terminal from the local session used `/Users/dushyantgarg/Documents/Projects/Cranberri` as its visible working directory.
- Opening a browser from the same session produced a bounded `about:blank` tab with reachable navigation controls.
- The model/reasoning menu opened without moving the transcript and remained open during a scroll gesture.
- At the normal window size, workspace tabs truncated long labels intentionally and the browser plus right rail showed no overlap or clipped controls.

## Findings

### DD-05 - Multiline composer replay required

Result: blocked, release risk P1 until fixture replay

Computer Use typed a long synthetic paragraph followed by a newline. The newline triggered the normal Enter-to-send path, creating a local session and sending the first paragraph; the second paragraph remained as a follow-up draft. The draft was preserved and the completed response rendered correctly, but this run did not prove multiline paste, Shift+Enter, chip selection, or draft restoration. Replay DD-05 in the isolated fixture profile with explicit key-level steps before assigning a product verdict.

### DD-02 - Long labels are dense but coherent

Result: pass with P2 observation

The repo rail and workspace tabs truncate very long session titles. The full accessible descriptions remain available, and the normal-size screenshot showed no overlap. Compact-width replay still needs to confirm tooltip discoverability and focus treatment.

## Blocked Scenarios

DD-01 through DD-14 now have deterministic preconditions and pass conditions in `docs/uat/daily-driver-scenarios.md`. Mutation, restart, worktree, handoff, archive/delete, forced-quit, update, and fixture-backed Codex scenarios were not claimed as passed in this normal-profile baseline. They require the isolated fixture profile and per-scenario evidence records.

## Baseline Decision

The installed app is usable for read-only navigation and basic local context switching, but the baseline does not yet justify daily-driver graduation. The highest-risk next work remains canonical window/task/thread identity, crash-safe persistence, controlled composer replay, cross-store recovery, and updater rollback. Source tests or packaged smoke cannot replace the remaining installed-app scenarios.
