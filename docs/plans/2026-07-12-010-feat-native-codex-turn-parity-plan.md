---
title: "Native Codex Turn Parity - Plan"
type: feat
date: "2026-07-12"
topic: native-codex-turn-parity
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-plan-bootstrap
execution: code
---

# Native Codex Turn Parity - Plan

## Goal Capsule

- Make sending and following a turn inside Cranberri feel like the native Codex app.
- Preserve Codex's real chronological reasoning, command, patch, search, tool, approval, and completion lifecycle instead of reducing it to a flat activity label.
- Let a follow-up sent during an active turn steer that turn through `turn/steer`.
- Keep Cranberri's attachments, skills, plugins, modes, model controls, voice, context meter, and reusable response context without letting them change the transcript rhythm.
- Stop when restored and live turns share one display model, completed work collapses cleanly, active work remains inspectable, scroll intent is respected, and the production build passes.

---

## Product Contract

### Turn behavior

- A user prompt appears immediately and owns the activity trail that follows it.
- Live app-server items appear in chronological order with typed labels and states.
- Reasoning and commentary belong inside the trail; the final answer remains a separate response below it.
- The active header shows a compact working state and elapsed time. A completed header settles to `Worked for X` and collapses by default.
- Commands, patches, searches, MCP and dynamic tools, collaboration, compaction, failures, and approvals remain individually inspectable.
- Approval controls render at the relevant item position when `targetItemId` is available and fall back to the active turn otherwise.
- A restored session reconstructs the same trail from persisted turn items.

### Composer behavior

- Enter sends whenever the composer contains content, including while the root turn is active.
- Sending during an active root turn calls `turn/steer` and records the direction inside that turn.
- The primary composer action is Stop only when a turn is active and the composer is empty; typed content switches it back to Send.
- Existing Cranberri composer capabilities remain available.

### Scroll and streaming behavior

- New output pins to the bottom only while the reader is already near the bottom.
- Moving away from the bottom reveals a jump-to-latest affordance and does not fight the reader.
- Streaming Markdown keeps the same semantic structure used after completion while deferring expensive rich code rendering.

### Scope Boundaries

- This work changes the contents and interaction of the chat window only.
- Rails, task headers, worktree controls, and the outer workspace layout are not redesigned.
- Cranberri continues to use the local Codex app-server; no transcript is inferred from telemetry strings.

---

## Planning Contract

### Key Technical Decisions

- Preserve the app-server's current typed `Turn` and `ThreadItem` lifecycle through a normalized shared display model.
- Keep the existing flat `messages` collection for compatibility, but associate messages with turn IDs and add ordered `activityTurns` for first-class workflow rendering.
- Normalize persisted and live items with the same pure helper so session restore cannot drift from streaming behavior.
- Reconcile optimistic local turn IDs with UUIDs from `turn/started` instead of delaying the prompt while waiting for RPC.
- Extract the activity UI from `ChatWindow.tsx`; the window owns composer and approval actions while focused chat components own trail presentation.
- Preserve legacy reasoning-group rendering only for data that predates the activity-turn model.

### Risks and Mitigations

- App-server item types can grow. Unknown items receive a quiet generic row instead of being dropped or crashing the renderer.
- `thread/status/changed` and `turn/started` can both announce activity. Reconciliation must be idempotent and must not create duplicate turns.
- Reasoning deltas can arrive at high volume. Continue frame-batching message text and let the trail read the matching message by item ID.
- Steering can race with turn completion. Restore the draft and surface the real app-server error when `expectedTurnId` is no longer active.
- Approvals can precede their target item. Resolve placement at render time from `targetItemId`, with an active-turn fallback.

---

## Implementation Units

### U1. Typed turn activity model and lifecycle preservation

- **Files:** `src/shared/codex.ts`, `src/shared/codex-turn-activity.ts`, `src/main/codex/client.ts`, `src/main/codex/fakeClient.ts`, `src/main/codex/eventPolicy.ts` and focused tests.
- **Work:** Add normalized activity/turn types, extend SDK item compatibility fields, forward turn IDs and full item start/completion data, and update the fake client to exercise commands, file changes, commentary, completion, and steering.
- **Done signal:** Pure normalization tests cover representative current protocol items and client tests prove lifecycle identity/timing is forwarded.

### U2. Renderer hydration and active-turn state

- **Files:** `src/renderer/state/codex.tsx`, `src/renderer/state/codex-streaming.ts`, `src/renderer/state/codex-turn-activity.ts` and focused tests.
- **Work:** Hydrate messages and activity turns together, reconcile optimistic/real IDs, merge item lifecycle updates, attach streaming messages to turns, complete turns with server duration/status, and expose a root steering action.
- **Done signal:** Restored and live activity reduce to equivalent state; repeated lifecycle events are idempotent; steering adds one chronological direction item.

### U3. Native-like turn presentation and composer flow

- **Files:** `src/renderer/components/chat/TurnActivity.tsx`, `src/renderer/components/chat/TurnActivityItem.tsx`, `src/renderer/components/chat/TranscriptList.tsx`, `src/renderer/components/chat/Transcript.tsx`, `src/renderer/components/chat/MarkdownContent.tsx`, `src/renderer/components/ChatWindow.tsx`, and component tests.
- **Work:** Render compact active/completed headers and typed item rows, place approvals inline, keep final responses separate, enable Enter-to-steer, switch Send/Stop by composer content, add jump-to-latest, and retain semantic Markdown structure while streaming.
- **Done signal:** Static component tests cover ordering, collapse labels, status/error treatment, inline approvals, and composer send rules.

### U4. End-to-end verification and polish

- **Files:** Existing test/smoke surfaces plus only scoped corrections found during review.
- **Work:** Run focused tests, full tests, production build, fake-client Electron smoke, screenshot inspection at desktop and compact widths, diff review, and simplification.
- **Done signal:** No duplicate messages or trails, no scroll fighting or overlap, active steering works, restored history matches live history, and `npm run build` passes.

---

## Verification Contract

| Gate | Done signal |
|---|---|
| Turn normalization and reducer tests | Current protocol items, hydration, reconciliation, completion, failure, and steering pass |
| Transcript and composer tests | Activity ordering, collapsed/active states, inline approvals, Markdown streaming, and Enter-to-steer pass |
| `npm test` | Full unit suite passes |
| `npm run build` | Typecheck, lint, and Electron/Vite production build pass |
| Fake-client Electron smoke | A live turn visibly streams typed activity, final answer, and steering without blank or overlapping UI |
| Screenshot review | Desktop and compact chat widths remain readable; composer and jump control do not occlude transcript content |
| `git diff --check` | No whitespace errors |

---

## Definition of Done

- Live and restored turns use the same typed, chronological activity model.
- Reasoning and tool work render inside the owning turn trail; final answers render separately.
- Completed trails collapse to `Worked for X`; active trails expose current work and elapsed time.
- Approvals and errors appear at the right point in the trail.
- Active root turns accept follow-up steering from Enter and the Send button.
- Scroll behavior respects reader position and offers jump-to-latest.
- Cranberri's existing composer QoL remains functional.
- Focused tests, full tests, production build, Electron smoke, screenshot review, and diff checks pass.
