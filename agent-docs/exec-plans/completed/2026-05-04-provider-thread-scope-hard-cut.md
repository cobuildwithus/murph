# Provider Thread Scope Hard Cut

Goal:
Remove `murph-history-only` as a normal assistant continuity mode. Human
conversation turns should use Codex session threads. Notification/cron decision
jobs should use isolated Codex threads without replaying Murph transcript and
without clearing the user's saved conversation resume state.

Success criteria:

- No live code/test references to `murph-history-only`.
- Assistant planning uses a clear provider thread scope:
  `session-thread` or `isolated-thread`.
- Auto-reply/onboarding conversation turns use the session thread.
- Notification/cron decision jobs use isolated threads.
- Isolated turns preserve existing session resume state during finalization.
- Normal planning no longer loads 100-message Murph transcript replay.

Constraints:

- Greenfield hard cut: no compatibility alias for the old mode.
- Preserve unrelated active provider-usage/logging changes in the dirty
  worktree.

State:

- Implementation complete, verified, and committed.

Done:

- Replaced the old provider continuity mode with `session-thread` /
  `isolated-thread`.
- Kept auto-reply conversation turns on the session provider thread.
- Kept notification/cron decision turns isolated.
- Made isolated finalization preserve existing session resume state.
- Removed normal transcript replay from route planning.
- Removed legacy system-prompt replay from Codex turn text.
- Renamed fresh provider continuation events to `thread-start`.
- Verified with focused assistant-engine checks and workspace `test:diff`.

Working set:

- `packages/assistant-engine/src/assistant/provider-turn/planning.ts`
- `packages/assistant-engine/src/assistant/provider-turn-runner.ts`
- `packages/assistant-engine/src/assistant/local-service.ts`
- `packages/assistant-engine/src/assistant/notification-turn.ts`
- `packages/assistant-engine/src/assistant/turn-finalizer.ts`
- `packages/assistant-engine/test/**`
  Status: completed
  Updated: 2026-05-04
  Completed: 2026-05-04
