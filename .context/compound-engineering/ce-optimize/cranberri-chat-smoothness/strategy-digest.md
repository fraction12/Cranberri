# cranberri-chat-smoothness strategy digest

Current best: iteration 1, chat_affordance_score 100 / 100.

Baseline risks removed:
- run_end_replay_risk: 1 -> 0
- telemetry_churn_risk: 1 -> 0
- duplicate_run_end_risk: 1 -> 0

Winning changes:
1. Replace final text interval replay with immediate completion rendering. This avoids UI lag after run_end and prevents hidden timers from mutating completed runs.
2. Keep chat telemetry snapshots keyed by stable scalar state, with the latest payload stored in a ref. This avoids logging on every thread object identity change.
3. Centralize Codex run lifecycle emission through emitRunStart/emitRunEnd and track active thread ids. Duplicate terminal events from status idle, task_complete, turn/completed, and serverRequest/resolved no longer spam renderer state.

No remaining runnable hypotheses; target reached.
