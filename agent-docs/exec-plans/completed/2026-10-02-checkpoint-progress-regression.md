# Preserve latest mailbox progress at idle checkpoints

Status: completed
Created: 2026-10-02
Updated: 2026-10-02

## Goal

Prevent valid idle workspace snapshots from being rejected after canonical progress publications.

## Scope and invariant

The assistant runtime owns the change. Keep Web workspace-version CAS, fencing,
and equal-or-plus-one generation validation unchanged. No production mutation,
protocol change, migration, or new state owner is needed.

## Evidence and decision

A synthetic composed entrypoint test publishes system progress during quiescence.
Before the fix, the next snapshot uses the new workspace version but an old
foreground generation (7 instead of 8). Derive the generation from the builder's
latest accepted workspace after quiescence, matching the existing version owner.

## Tasks

- [x] Trace the publication failure and reproduce the stale generation.
- [x] Correct the runtime read and document its owner.
- [x] Run regression, adjacent checkpoint tests, typecheck, and complexity review.
- [x] Review the diff; final scoped commit closes this plan.

## Verification

The new regression fails on the unmodified runtime with expected 8, actual 7.
Post-fix verification:

- `pnpm exec vitest run --config packages/assistant-runtime/vitest.config.ts --no-coverage packages/assistant-runtime/test/hosted-runtime-checkpoint-progress.test.ts packages/assistant-runtime/test/hosted-runtime-workspace-entrypoint-checkpoint-wakes.test.ts packages/assistant-runtime/test/hosted-runtime-workspace-runner.test.ts`: 177 passed.
- `pnpm --dir packages/assistant-runtime typecheck`: passed.
- `pnpm complexity:diff`: passed with unchanged complexity debt.
- The adjacent `hosted-runtime-workspace-entrypoint-system-mailbox.test.ts` run
  passed 78 tests and failed six vault-share publication cases. Re-running the
  failing cases on unchanged main reproduced all six; tracked in Frog entry
  `20261002151655-system-mailbox-focused`.
- `git diff --check`: passed.

The regression uses the real entrypoint, publication builder, and status
checkpoint code with controlled completion order at the system-work boundary.
It covers initial null progress, established progress, and remaining progress
that must still advance the idle generation once. Parent review confirms the
builder is initialized from the restored workspace and never accepts older
versions. The fix adds no state, branch, retry, or protocol field.

Live recovery requires deploying the updated runner runtime; local proof does
not establish production recovery. External ReviewGPT and exact-head CI have
not run because no PR/push lane was requested.

## Delivery

No Web relaxation or database repair is required. This is an internal checkpoint
correctness fix, with no member-facing copy or behavior contract to announce.
PR review/CI and production deployment are separate from the local fix scope.
Completed: 2026-10-02
