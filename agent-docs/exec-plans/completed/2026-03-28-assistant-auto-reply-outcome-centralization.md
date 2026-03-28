# Assistant Auto-Reply Outcome Centralization

## Goal

Refactor `scanAssistantAutoReplyOnce` into an explicit per-group state machine that centralizes cursor/stop/artifact/session semantics and moves provider stall watchdog behavior behind a smaller helper surface.

## Scope

- `packages/cli/src/assistant/automation/scanner.ts`
- `packages/cli/src/assistant/automation/provider-watchdog.ts`
- Focused assistant runtime tests that anchor scanner cursor, deferred-artifact, retry, and watchdog behavior

## Constraints

- Preserve exact cursor advancement rules for skip, defer, success, retryable delivery failure, and non-retryable failure outcomes.
- Preserve resumable-session and retry behavior, including stalled-provider abort/retry semantics and the long-running `deepthink` exception.
- Keep the refactor structural: do not change thresholds, artifact shapes, or unrelated assistant automation behavior.
- Preserve adjacent dirty assistant automation edits already present in the worktree.

## Verification

- Focused assistant runtime tests covering the existing scanner/watchdog behavior anchors
- Required repo checks: `pnpm typecheck`, `pnpm test`, `pnpm test:coverage`

## Notes

- The target shape is one per-group outcome type plus one commit path that owns cursor movement, artifact writes, summary events, and stop/continue behavior.
- The main loop should only load groups, execute the provider path, and commit the returned outcome.
- Completion workflow still requires delegated `simplify`, `test-coverage-audit`, and `task-finish-review` passes before handoff.
Status: completed
Updated: 2026-03-28
Completed: 2026-03-28
