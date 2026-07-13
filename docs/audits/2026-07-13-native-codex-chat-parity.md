# Native Codex chat parity audit

Status: implementation complete; native visual comparison blocked

Plan: `docs/plans/2026-07-13-013-feat-native-codex-chat-composer-parity-plan.md`

## Baseline

- Native desktop build: `26.707.62119` (`5211`)
- Native bundled protocol: `codex-cli 0.144.2`
- Cranberri automatic runtime at baseline: `codex-cli 0.144.0`
- Native appearance: dark, default interface size, Satoshi UI font
- Target viewports: 1400 x 900 and 900 x 600
- Reference capture: blocked by host-app Computer Use safety policy
- Reference contract: executable, 16 states x 2 themes x 2 viewports; all 64
  screenshot entries are honestly marked blocked with no assets
- Protocol compatibility: pinned `ThreadItem` and `ServerRequest` bindings are
  byte-identical between CLI 0.144.0 and 0.144.2

The protocol units may proceed against the bundled 0.144.2 schema. Visual units
must wait for the fixed-state reference assets; no visual mismatch may be waived
or inferred from memory.

## Protocol conformance ledger

| Family | Pinned methods or items | Current owner | Disposition |
|---|---|---|---|
| Command activity | `commandExecution`, `item/commandExecution/outputDelta`, terminal interaction | shared activity model, main client, renderer state, rich renderer | Implemented and tested |
| File activity | `fileChange`, output delta, patch update, turn diff | shared activity model, main client, renderer state, rich renderer | Implemented and tested |
| Tool activity | `mcpToolCall`, MCP progress, `dynamicToolCall` | shared activity model, main client, renderer state, rich renderer | Implemented and tested |
| Command approval | `item/commandExecution/requestApproval` | typed server-request lifecycle and inline request UI | Implemented and tested |
| File approval | `item/fileChange/requestApproval` | typed server-request lifecycle and inline request UI | Implemented and tested |
| Permissions | `item/permissions/requestApproval` | typed server-request lifecycle and inline request UI | Implemented and tested |
| Tool input | `item/tool/requestUserInput` | typed server-request lifecycle and inline request UI | Implemented and tested |
| MCP elicitation | `mcpServer/elicitation/request` | typed server-request lifecycle and inline request UI | Implemented and tested |
| Guardian review | auto-approval review notifications plus `thread/approveGuardianDeniedAction` | existing Guardian-specific path | Keep separate |
| Host-provided requests | dynamic tool call, auth refresh, attestation, current time | main-process handlers | Outside human request UI; retain explicit handler ownership |
| Legacy approvals | `applyPatchApproval`, `execCommandApproval` | compatibility handler | Covered by compatibility mapping |

## Visual mismatch ledger

No visual dispositions are valid until native assets are captured. The ledger
will cover transcript rhythm, disclosure defaults, rich item detail, request
cards, composer geometry, toolbar priority and wrapping, menus, chips, focus,
hover, disabled and error states, and compact behavior.

The checked-in replay contract already owns the required setup, interaction,
outcome, comparable regions, masks, synthetic fixtures, and capture slots. This
is contract completeness, not visual evidence; the visual ledger remains blocked
until real native PNGs satisfy those slots.

## Implementation verification

- Full Vitest suite: 168 files, 1,023 tests passed.
- Production build: typography audit, TypeScript, zero-warning ESLint, preload,
  main, and renderer builds passed.
- Packaged macOS directory build: passed, including native module rebuild.
- Focused packaged parity UAT: passed. The command now packages the current
  checkout before Playwright launches Electron, preventing stale binary passes.
  It keyboard-expands command, patch, MCP result/error, search, image, and
  collaboration detail; drives a typed approval through the production broker,
  IPC, durable settlement, and renderer; verifies decoded media, prompt history,
  structured mention copy/cut/paste, suggestion ARIA, console health, and
  desktop/compact geometry in dark/light.
- Complete Electron smoke: passed across startup, repos, sessions, chat,
  workers, approvals, tools, rails, terminal, browser, themes, settings, and
  worktree lifecycle.
- Real app-server UAT: passed across a local turn, promotion into a managed
  worktree, real shell execution, completed-turn persistence, app restart,
  semantic thread/item and rich `activityDetail` comparison, and restored
  final-response rendering.
- Human request restart coverage: passed. A new ledger instance rehydrates the
  privacy-safe outcome, renderer hydration merges it chronologically without
  duplicates, and the transcript places it back into its owning turn.
- Privacy: deterministic fixtures contain no real command output, credentials,
  private repo data, or user answers. Human-request outcomes persist only the
  bounded display-safe metadata defined by the shared schema.

Native Codex screenshots and numeric screenshot comparison remain blocked by
the host Codex task's Computer Use policy. No pixel-parity claim is made from
memory or Cranberri-only captures.

## Known intentional deviations

- Cranberri keeps repo-specific context, Goal, Plan, model, approval, voice, and
  attachment controls available in the composer.
- Cranberri's outer workspace, rails, task header, terminal, browser, and settings
  remain outside the comparable chat region.
