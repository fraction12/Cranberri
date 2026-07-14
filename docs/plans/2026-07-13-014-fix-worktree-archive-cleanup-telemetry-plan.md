---
title: Fix worktree archive cleanup and lifecycle telemetry
date: 2026-07-13
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-plan-bootstrap
execution: code
origin:
  - docs/plans/2026-07-13-013-fix-archive-managed-worktree-cleanup-plan.md
---

# Fix Worktree Archive Cleanup and Lifecycle Telemetry

## Goal Capsule

- **Objective:** Make explicit archive reliably remove Cranberri-managed worktrees containing ordinary ignored dependency and build trees, while preserving the existing fail-closed treatment of meaningful untracked work and unsupported filesystem entries.
- **Authority:** The durable task/worktree lifecycle journal remains the source of truth. Git classifies ignored roots; the snapshot remains authoritative only for staged, unstaged, and non-ignored untracked work.
- **Execution profile:** Proof-first changes to lifecycle normalization, telemetry observation, and packaged Electron archive UAT.
- **Stop conditions:** Do not weaken ownership checks, follow symlinks, force-remove worktrees, snapshot ignored content, or expose absolute paths and file contents in telemetry.
- **Tail ownership:** Run focused Vitest coverage, `npm run build`, and the packaged archive flow in `scripts/smoke-electron.mjs`.

---

## Product Contract

### Summary

An explicit archive currently snapshots and archives the Codex thread successfully, then can strand the task in `cleanupBlocked` because ignored dependency trees are expanded into individual entries and nested package-manager symlinks are treated like restorable untracked files.
The corrected flow treats ignored roots as disposable opaque entries without traversing them, while retaining byte-level verification for captured untracked files.
Lifecycle telemetry must describe every archive, restore, and delete operation from durable journal transitions so partial success and recovery retries are diagnosable without reading raw task-store files.

### Requirements

**Archive cleanup**

- R1. Explicit archive removes a managed worktree containing ignored directories such as `node_modules` or `out`, including symlinks nested inside those directories, without following or reading those symlinks.
- R2. Ignored roots are derived from structured NUL-delimited Git status output and moved atomically into operation-owned quarantine on the same managed filesystem.
- R3. Non-ignored untracked files continue to require snapshot membership, stable regular-file reads, content verification, and per-entry durable receipts.
- R4. An ignored root that is itself a symlink or special file remains unsupported and blocks cleanup before source mutation.
- R5. If removal fails after normalization, Cranberri reconstructs both captured untracked files and opaque ignored roots at their original paths before reporting cleanup blocked.
- R6. Restore never recreates ignored dependency or build output; the configured environment setup remains responsible for regeneration.

**Telemetry and interaction truthfulness**

- R7. New and recovered archive, restore, and delete operations emit ordered lifecycle telemetry for start or recovery observation, durable phase receipts, needs-attention outcomes, retries, and completion duration.
- R8. Lifecycle telemetry includes operation, task, project, worktree, kind, phase, status, retry count, error code, and a bounded diagnostic message, but excludes receipt details, absolute paths, refs, hashes, file contents, and snapshot contents.
- R9. Telemetry emission never blocks or changes lifecycle authority; write failures are logged and lifecycle execution continues.
- R10. The repo rail does not optimistically claim archive completion. It keeps the row stable while the request is pending, prevents duplicate lifecycle actions, then refreshes from task and Codex authority before showing success.

### Acceptance Examples

- AE1. Given a managed worktree with ignored `node_modules/.bin/acorn -> ../acorn/bin/acorn`, Archive completes, removes and unregisters the worktree, retains a valid restore snapshot, and records a completed lifecycle telemetry event.
- AE2. Given ignored `out/` plus a non-ignored untracked file, Archive discards `out/`, snapshots and restores the untracked file, and never includes either ignored path or its contents in telemetry.
- AE3. Given an injected Git removal failure after ignored-root quarantine, the ignored tree and nested symlink return to the source path, Git status matches the pre-archive state, and telemetry records needs attention.
- AE4. Given an untracked symlink or an ignored root that is itself a symlink, Archive preserves the source and records a categorized cleanup-blocked outcome.
- AE5. Given an archive in progress from the repo rail, the session remains in its current list with lifecycle actions disabled until authority settles; successful completion then closes its workspace and moves it to archived history once.

### Scope Boundaries

- Do not add `.worktreeinclude` support or preserve ignored content in snapshots.
- Do not redesign the task-store schema or lifecycle saga ordering.
- Do not add remote telemetry or analytics; all events remain in Cranberri's local JSONL and SQLite stores.
- Do not broaden cleanup to external, permanent, or Local checkouts.

---

## Planning Contract

### Key Technical Decisions

- KTD1. Use `git status --porcelain=v2 -z --ignored=matching --untracked-files=normal` to obtain collapsed ignored roots. This avoids expanding `node_modules` into package-manager symlink leaves and avoids parsing human-formatted Git output.
- KTD2. Keep separate normalization paths. Captured untracked files retain digest verification; ignored roots use no-follow ancestor validation plus same-filesystem atomic rename and inode/type verification.
- KTD3. Add distinct durable receipt subphases for ignored-root move planning and completion so recovery can reconstruct opaque roots without treating directories as regular files.
- KTD4. Observe lifecycle telemetry from committed `TaskStore` transitions rather than scattering telemetry calls through archive, recovery, restore, and delete branches. This covers ordinary execution and startup reconciliation with one authority-aligned surface.
- KTD5. Serialize telemetry writes behind the observer and emit only a safe projection of operations and receipts. Telemetry failure is non-fatal and cannot participate in lifecycle control flow.
- KTD6. Replace repo-rail optimistic list mutation with a pending identity and authoritative refresh. The existing task-store authority event remains the convergence mechanism for other surfaces.

### Sequencing

1. Establish failing lifecycle tests for ignored roots and rollback reconstruction.
2. Implement split captured-file and ignored-root normalization with new receipts.
3. Establish and implement lifecycle telemetry observer coverage.
4. Make repo-rail archive interaction authority-driven and extend packaged smoke with ignored dependency symlinks plus telemetry assertions.

---

## Implementation Units

### U1. Safely normalize ignored worktree roots

- **Goal:** Archive succeeds for ordinary ignored dependency/build trees while preserving exact rollback and existing symlink safety.
- **Files:** Modify `src/shared/tasks.ts`, `src/main/worktree-lifecycle.ts`, and `src/main/worktree-lifecycle.test.ts`.
- **Patterns to follow:** Existing snapshot verification, operation-owned quarantine, `containedPath`, stable regular-file reads, and `reconstructSource` receipts.
- **Approach:** Parse collapsed ignored roots separately from non-ignored untracked paths; validate every ancestor without following symlinks; atomically rename supported ignored root entries; record distinct planned/completed receipts; reconstruct those roots by reversing the same recorded rename when removal fails.
- **Test scenarios:** Ignored directory with nested relative symlink archives; ignored build directory and generated file archive; ignored root symlink remains blocked; non-ignored untracked symlink remains blocked; injected remove failure restores ignored directories and symlink targets exactly; repeated recovery remains idempotent.
- **Verification:** `npx vitest run src/main/worktree-lifecycle.test.ts src/main/git-worktrees.test.ts src/main/worktree-snapshot-store.test.ts`.

### U2. Observe durable lifecycle telemetry

- **Goal:** Make archive, restore, delete, failure, retry, and startup recovery visible in local diagnostics without leaking lifecycle internals.
- **Files:** Create `src/main/task-lifecycle-telemetry.ts` and `src/main/task-lifecycle-telemetry.test.ts`; modify `src/main/worktree-runtime.ts` and `src/main/index.ts`.
- **Patterns to follow:** `TaskStore.subscribe`, `logTelemetry`, the bounded local JSONL store, and SQLite `LocalEventStore` projection.
- **Approach:** Snapshot operation state before startup reconciliation, subscribe to committed task-store revisions, diff operation receipts and outcomes, queue safe projected events in commit order, and expose a disposable observer for tests and shutdown-safe ownership.
- **Test scenarios:** New operation start; receipt progression without details; needs-attention error and retry projection; completion duration; pre-existing unfinished operation observed at startup; duplicate task-store revisions do not duplicate telemetry; emitter rejection does not affect task-store commits.
- **Verification:** `npx vitest run src/main/task-lifecycle-telemetry.test.ts src/main/task-store.test.ts src/main/startup-recovery.test.ts`.

### U3. Make repo-rail archive state authoritative and prove the packaged flow

- **Goal:** Remove the visual false-positive window and verify the original npm symlink failure through the packaged app.
- **Files:** Modify `src/renderer/components/RepoRail.tsx` and `scripts/smoke-electron.mjs`; add a focused renderer helper test if logic extraction is needed.
- **Patterns to follow:** Existing authority invalidation, `tasksApi.refresh`, toast behavior, workspace close semantics, and packaged smoke task-status assertions.
- **Approach:** Track the pending lifecycle session, disable duplicate row actions, avoid pre-response recent/archived mutations, refresh authority before success feedback, and seed the smoke worktree with ignored npm-style and build-output entries before archive.
- **Test scenarios:** Archive pending state; successful archive moves once and closes windows; cleanup failure remains accurately archived with warning; packaged archive removes nested ignored symlinks; telemetry contains start, ignored-root receipt, and completion without path/detail leakage.
- **Verification:** Focused renderer tests if added, then `npm run test:smoke` or the repository's packaged smoke command covering the archive scenario.

---

## Verification Contract

| Check | Applies to | Done signal |
|---|---|---|
| Focused lifecycle Vitest | U1 | Ignored nested symlink archive and rollback reconstruction pass while unsupported root symlinks remain blocked |
| Telemetry observer Vitest | U2 | Ordered, deduplicated, privacy-safe events cover normal and recovered operations |
| Typecheck, lint, production build via `npm run build` | U1-U3 | Command exits successfully |
| Packaged Electron smoke | U3 | Real managed worktree with npm-style ignored symlink archives, disappears from disk, and emits completed telemetry |
| Diff review | U1-U3 | No force removal, symlink following, absolute-path telemetry, unrelated refactor, or weakened snapshot validation |

---

## Definition of Done

- Explicit archive completes for the exact `node_modules/.bin/acorn` shape observed in the installed release.
- The Codex thread, task authority, snapshot, Git registration, physical checkout, and repo rail converge on one completed archived result.
- Injected post-normalization failure reconstructs the original ignored and captured state before exposing cleanup needs attention.
- Local diagnostics explain every lifecycle phase and partial failure without requiring direct inspection of `tasks.json`.
- Focused tests, `npm run build`, and packaged Electron archive UAT pass.
