# Release idle background assistant runtimes promptly

Status: completed
Created: 2026-09-20
Updated: 2026-09-20

## Outcome

Finished background assistant work checkpoints promptly and reaches the existing
container cleanup path, whose safety recheck is 60 seconds. Do not add a second
idle delay or a hard execution timeout. Accepted conversation work retains its
configured quiet window; active child work and durable effects remain protected.

## Cause and scope

The runtime initializes its checkpoint deadline from the conversation idle TTL
even when only scheduled assistant work dirties the workspace. Correct the
existing deadline owner without changing wire contracts, model instructions,
automation admission, standby capacity, or container destruction fences.

## Product UX

- Outcome: reduce idle background runtime cost while preserving replies and saved work.
- Reaches: scheduled-only work, foreground conversation, and conversation arriving during background execution.
- Proof: composed runtime tests with synthetic ports and controlled time, durable-effect ordering, existing active-work regressions, and typecheck.

## Tasks

1. Add deterministic regression proof and remove background-only checkpoint delay.
2. Preserve foreground extension, active children, checkpoint-before-effect, and shutdown recovery.
3. Update the runtime protocol owner and focused verification index.
4. Run focused tests, typecheck, complexity inspection, and candidate review; commit the scoped result.

## Verification

- Regression reproduced before the source change: settled background work could
  not return without advancing the conversation idle timer; foreground control passed.
- Focused timing and foreground-promotion tests passed (33 tests).
- Native container runtime-callback lifecycle tests passed (18 tests), covering
  cleanup and the existing active-work protections.
- Expanded entrypoint verification: 20 files / 487 tests passed with
  `pnpm --dir packages/assistant-runtime test hosted-runtime-workspace-entrypoint test/hosted-runtime-background-checkpoint-timing.test.ts test/hosted-runtime-metadata-checkpoint-timing.test.ts test/hosted-runtime-promoted-foreground-priority.test.ts --reporter=dot`.
- `pnpm docs:drift` and `git diff --check`: passed.
- `pnpm --dir packages/assistant-runtime typecheck`: passed.
- `pnpm complexity:diff`: passed; source complexity debt and maximum are unchanged.
  The large runtime owner remains a pre-existing hotspot. Reusing its timer and
  removing a redundant projection-only branch avoids another state owner.
- Existing quiet-window fixtures now supply an initial synthetic conversation;
  later messages use the next lane sequence. Their timing and ordering assertions
  remain intact.
- Parent review checked checkpoint-before-effect ordering, foreground promotion,
  shutdown recovery, active work, and privacy. No new protocol fields, provider
  calls, dependencies, or foreground awaits were introduced.
- Model instructions and turn selection are unchanged. The assistant verification
  boundary is deterministic runtime timing; a real-model journey is not applicable.
- Changelog: not applicable. This changes internal idle resource use while
  preserving conversation timing, replies, and automation selection.
- Final ReviewGPT and CI are not run for this local commit; no PR is open.
- Product UX: Ready. Background completion, initial and later conversation,
  active work, durable effects, and shutdown recovery passed their focused journeys.

## Deployment

No protocol or schema change. Old runtimes keep their existing delay until they
drain; new runtimes use the revised checkpoint timing. Production deployment is
separate from this change.
Completed: 2026-09-20
