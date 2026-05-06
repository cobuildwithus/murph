# Injected Clock Wake Recovery

## Goal

Remove direct wall-clock reads from assistant phase skipped-device-sync wake recovery and canonical cron stale-claim normalization. Success means tests can exercise both behaviors with injected time policy instead of fake global timers, while existing runtime behavior stays unchanged by default.

## Constraints

- Keep wake recovery and cron stale-claim behavior semantically unchanged unless an injected policy overrides the clock or stale threshold.
- Preserve assistant-runtime and assistant-engine package boundaries.
- Avoid broad clock refactors outside the identified seams.
- Keep stale-threshold policy centralized where canonical cron runtime state owns the normalization.

## State

Done:
- Read required routing, architecture, product, reliability, completion, and verification docs.
- Located direct `Date.now()` reads in skipped-device-sync wake recovery and canonical cron stale-claim normalization.
- Passed runner `input.now` through to assistant phase input and used it for skipped-device-sync wake recovery.
- Added canonical cron runtime normalization policy with injected `now` and `runningStaleAfterMs`, keeping the one-hour default centralized.
- Updated focused tests to cover injected phase time, runner now propagation, and cron stale-threshold policy.
- Verification passed:
  - `bash scripts/workspace-verify.sh test:diff packages/assistant-runtime/src/hosted-runtime/workspace-assistant-phase.ts packages/assistant-runtime/src/hosted-runtime/workspace-runner.ts packages/assistant-runtime/test/hosted-runtime-workspace-assistant-phase.test.ts packages/assistant-runtime/test/hosted-runtime-workspace-runner.test.ts packages/assistant-engine/src/assistant/cron/runtime-state.ts packages/assistant-engine/test/assistant-cron-seams.test.ts`
  - `pnpm typecheck`
  - `git diff --check`

Now:
- Final local review, then close plan and commit if unblocked.

Next:
- Use `scripts/finish-task` if unrelated dirty work does not block the scoped commit.

## Working Set

- `packages/assistant-runtime/src/hosted-runtime/workspace-assistant-phase.ts`
- `packages/assistant-runtime/test/hosted-runtime-workspace-assistant-phase.test.ts`
- `packages/assistant-engine/src/assistant/cron/runtime-state.ts`
- `packages/assistant-engine/test/assistant-cron-seams.test.ts`
Status: completed
Updated: 2026-05-06
Completed: 2026-05-06
