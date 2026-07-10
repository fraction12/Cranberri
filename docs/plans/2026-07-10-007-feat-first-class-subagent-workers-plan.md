---
title: "First-Class Subagent Workers - Plan"
type: feat
date: "2026-07-10"
topic: first-class-subagent-workers
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
execution: code
---

# First-Class Subagent Workers - Plan

## Goal

Make Codex multi-agent work visible and controllable in Cranberri as a persistent worker tree instead of flattening subagent activity into generic tool events.

## Product Contract

- A parent task owns an ordered list of workers with truthful lifecycle states: starting, running, idle, interrupted, completed, failed, stopped, or unavailable.
- Live workers expose open, steer, and stop controls. Completed or interrupted workers can be resumed with a new instruction.
- Opening a worker shows its full transcript and a clear route back to its parent task.
- Restored sessions reconstruct their worker tree from persisted `collabAgentToolCall` and `subAgentActivity` items, then enrich workers from child thread metadata when available.
- Subagent threads remain attached to their parent task, but do not render in the repo rail.
- Nested subagents remain attached to the worker that spawned them, so the model supports a tree rather than a single flat pool.

## Technical Contract

1. Preserve app-server thread metadata (`parentThreadId`, `sessionId`, agent nickname and role, source, ephemeral state) in shared session types.
2. Normalize collab-agent thread items into a shared `CodexWorker` model and merge out-of-order lifecycle updates deterministically.
3. Emit parent-addressed `worker_updated` events for `thread/started`, thread status changes, collab tool calls, and subagent activity.
4. Route steer and resume requests through the parent turn so its collaboration tools control multi-agent v2 children; recover child turn IDs only for direct interruption.
5. Hydrate parent and worker tasks into renderer state without relying on the worker UI being open when events arrive.
6. Render a compact persistent worker shelf in chat while keeping the repo rail focused on root sessions.
7. Extend the fake Codex client and Electron smoke test with spawn, steer, stop, open, back-navigation, and restore scenarios.

## Acceptance

- A real Codex prompt that spawns a subagent produces a named worker row without reloading.
- Worker status reaches a terminal state and remains correct after reopening the parent task.
- Steering or resuming a worker addresses the parent turn, which controls the same child through `send_input` or `resume_agent`; Cranberri never sends direct app-server input to a v2 child.
- Stop interrupts the worker's active turn and updates both its row and opened transcript.
- Opening a worker and returning to the parent never changes repositories or loses the original chat tab.
- `npm test`, `npm run build`, packaged Electron smoke, and a real-runtime multi-agent UAT pass.
