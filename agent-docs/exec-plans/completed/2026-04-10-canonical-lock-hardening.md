# Canonical Lock Hardening

## Goal

Close the correctness gaps found after the canonical resource-lock runtime landed:
- make the underlying directory lock publish protocol safe against half-published locks and stale-lock cleanup races
- eliminate mixed canonical write coordination domains so generic batch/jsonl helpers cannot race legacy canonical-write-lock callers on the same canonical path
- remove remaining path-lock mismatches such as `copyRawArtifact()` computing one target for locking and another for writing

## Scope

- `packages/runtime-state/**`
- `packages/core/**`
- targeted tests under `packages/runtime-state/test/**` and `packages/core/test/**`
- minimal doc/plan updates if the runtime contract changes materially

## Constraints

- Preserve file-first canonical vault storage; do not introduce a database-backed lock service.
- Keep unrelated dirty-tree edits intact.
- Prefer one coherent serialization regime for canonical writes.
- Keep the public architecture simpler after the fix, not more layered.

## Working Hypotheses

1. The current `mkdir(lockPath) -> write owner.json` protocol is fundamentally unsafe because contenders can observe and clear an incompletely published lock.
2. Canonical writes should serialize through one coordination domain per concrete canonical target set; mixing resource-only and global-only lanes is unsound.
3. Public append/raw helpers should either participate in the canonical staged write runtime or be clearly marked/private unsafe helpers rather than first-class public mutation ports.

## Landed Shape

- `packages/runtime-state/src/locks.ts` now publishes fully initialized lock directories via temp-sibling directory plus atomic rename, detaches lock directories before cleanup, and guards stale-lock cleanup with an identity-checked cleanup-claim flow.
- `packages/core/src/operations/canonical-write-lock.ts` now queues same-process independent callers per vault and only re-enters when a caller is inside an explicit logical write-lock scope.
- `packages/core/src/operations/write-batch.ts` now always acquires the umbrella canonical write lock during commit and rollback.
- `packages/core/src/public-mutations.ts` now routes public `appendJsonlRecord`, `applyCanonicalWriteBatch`, and `copyRawArtifact` through `runCanonicalWrite` instead of direct filesystem helpers.
- `packages/core/src/audit.ts` now routes batchless audit writes through `runCanonicalWrite`.
- `packages/core/src/raw.ts` now exposes the prepared raw artifact shape needed to avoid separate lock-target and write-target derivation.

## Verification

- `pnpm --dir packages/runtime-state typecheck` ✅
- `pnpm --dir packages/runtime-state test` ✅
- `pnpm --dir packages/core typecheck` ✅
- `pnpm --dir packages/core test -- canonical-write-lock.test.ts canonical-mutations-boundary.test.ts core.test.ts` ✅
- `pnpm typecheck` ❌ blocked by pre-existing unrelated `apps/web/test/join-invite-client.test.ts` type errors
- `bash scripts/workspace-verify.sh test:diff <scoped paths>` ❌ blocked by pre-existing unrelated `packages/cli/test/supplement-wearables-coverage.test.ts` type error on `excerpt`
- `pnpm test:smoke` ✅
Status: completed
Updated: 2026-04-10
Completed: 2026-04-10
