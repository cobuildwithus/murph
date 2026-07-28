# Correct legacy transcript retention rollout

Status: completed
Created: 2026-07-25
Updated: 2026-07-26

## Goal

- Preserve recent legacy transcript context during the first retention rollout
  while keeping exact receipt-anchored 14-day retirement for every newly written
  user transcript entry.

## Success criteria

- Phase one stamps every new user transcript entry with `contentReceivedAt`.
- Phase one never retires an unstamped legacy user transcript entry merely
  because its accepted-turn journal was already compacted.
- The unreliable journal/input reconstruction scan is deleted rather than
  becoming a second receipt owner.
- Durable deployment guidance defers legacy unstamped-entry retirement and
  snapshot rearming until one full 14-day interval after verified runner
  convergence.
- Focused snapshot/restore and fresh-thread fallback tests prove recent legacy
  user/assistant history remains intact, while stamped entries still retire at
  the inclusive receipt deadline.
- Canonical verification, the final ReviewGPT correction loop, and PR CI pass.

## Scope

- In scope:
  - Assistant transcript persistence and retention.
  - Hosted snapshot/restore regression coverage.
  - Migration inventory and deployment/cutover documentation.
  - PR #936 correction-loop evidence.
- Out of scope:
  - A new receipt index, recovery table, scheduler, or reconciliation owner.
  - Immediate cleanup of legacy unstamped transcript entries.
  - Changes to the already-proven inactive-workspace signal and pending-input
    terminalization corrections.

## Tasks

1. Trace transcript stamping, runtime-residue pruning, snapshot publication,
   migration rearming, and fresh-thread history assembly.
2. Add failing phase-one regressions for a recent settled legacy transcript
   after journal pruning and checkpoint/restore.
3. Delete legacy receipt reconstruction and preserve unstamped entries in phase
   one; retain exact-deadline cleanup for stamped entries.
4. Remove phase-one migration rearming for persisted snapshots and document the
   separate 14-day phase-two cutover.
5. Run focused and canonical verification, parent review, scoped commit/push,
   and the next ReviewGPT correction round.
6. Merge current `main`, resolve the hosted-runtime protocol documentation
   conflict, rerun the required delta review and CI, and prove merge readiness.

## Decisions

- Accept ReviewGPT round four's production-path finding: settled snapshot
  cleanup normally deletes the only proposed transcript-to-input join before
  rollout, so missing evidence cannot safely mean expired content.
- Use deployment ordering instead of adding a persisted legacy receipt owner.
- Treat the first stamping-capable runner as the phase-one rollback floor. The
  legacy scrub/rearm phase may begin only after 14 complete days of verified
  runner convergence.

## Verification

- `pnpm exec vitest run --config packages/assistant-engine/vitest.config.ts packages/assistant-engine/test/assistant-store-persistence.test.ts packages/assistant-engine/test/assistant-transcript-content-retention.test.ts packages/assistant-engine/test/assistant-codex-turn-planning.test.ts`
  passed 88 focused Assistant Engine tests.
- `pnpm exec vitest run --config packages/assistant-runtime/vitest.config.ts packages/assistant-runtime/test/hosted-runtime-workspace-entrypoint.test.ts -t "preserves a recent unstamped legacy transcript pair across retention-only checkpoint restore"`
  passed the production-path restore/checkpoint regression.
- `pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/test/hosted-mailbox-schema.test.ts apps/web/test/hosted-mailbox-content-retention-migration-postgres.test.ts`
  passed six static migration tests; the isolated real-Postgres migration test
  also passed.
- Assistant Engine, Assistant Runtime, and Web typechecks passed.
- Canonical `pnpm test:diff ...` passed repository guards and all affected
  package tests/typechecks except the unchanged CLI review-prompt wording audit
  already corrected on current `main`; rerun acceptance after base integration.
- `git diff --check` and the task privacy scan passed.
- The required product-experience review returned `PASS` with no reproducible
  user-visible failure.
Completed: 2026-07-26
