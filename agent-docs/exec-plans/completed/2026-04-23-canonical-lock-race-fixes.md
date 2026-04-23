# Fix canonical write-lock races across scheduled logs, food auto-log, and vault sync

Status: completed
Created: 2026-04-23
Updated: 2026-04-23

## Goal

- Eliminate three replay/planning races by holding the canonical write lock across the pre-write reads that determine whether a scheduled-log occurrence, food auto-log occurrence, or vault-sync import write should proceed.

## Success criteria

- `executeScheduledLogOccurrence(...)` keeps the scheduled-log read, external-ref dedupe, status gate, and write inside one canonical write-lock scope.
- `runFoodAutoLogCronJob(...)` keeps the external-ref dedupe and `addMeal(...)` call inside one canonical write-lock scope without widening beyond that cron path.
- `mergeVaultSyncImportIntoVault(...)` performs target-vault planning reads and `applyCanonicalWriteBatch(...)` inside one canonical write-lock scope so the plan cannot drift before commit.
- Focused regression coverage proves the lock-scope invariants for all three seams.
- Required verification and completion audits are green, or any unrelated blocker is named precisely.

## Scope

- In scope:
- `packages/core/src/scheduled-logs.ts`
- `packages/core/src/vault-sync.ts`
- `packages/assistant-engine/src/assistant/cron/food-auto-log.ts`
- directly coupled regression tests in `packages/core/test/{scheduled-logs.test.ts,vault-sync.test.ts}` and `packages/assistant-engine/test/assistant-cron-runtime.test.ts`
- coordination artifacts for this task
- Out of scope:
- unrelated scheduled-log feature work, CLI/query/contracts changes, or broader canonical-lock refactors
- hosted vault-sync/session control-plane code outside the already-owned merge path
- unrelated assistant cron/runtime behavior beyond the food auto-log dedupe seam

## Constraints

- Technical constraints:
- Preserve unrelated dirty-tree work and do not revert or restage overlapping active rows.
- Keep worker write scopes disjoint; shared regression-test integration stays in the parent thread.
- Do not weaken existing public mutation boundaries or bypass canonical write infrastructure.
- Product/process constraints:
- Follow the repo high-risk workflow: plan + ledger, coverage-bearing verification, required audit passes, and a scoped commit if code changes land.

## Risks and mitigations

1. Risk: A local fix narrows the race in one seam but leaves pre-write reads outside the lock in another path.
   Mitigation: Trace each seam from its public entrypoint through the exact dedupe/planning reads and add explicit regression coverage for lock scope.

2. Risk: Broader lock wrapping could accidentally deadlock or duplicate existing lock ownership.
   Mitigation: Reuse `withCanonicalWriteLockScope(...)` and `acquireCanonicalWriteLock(...)` only around the minimal public entrypoints that need serialized read-modify-write behavior.

3. Risk: The branch already contains unrelated dirty work across assistant and hosted packages.
   Mitigation: Keep the diff limited to the three owner files plus directly coupled tests and inspect staged paths carefully before commit.

## Tasks

1. Confirm the current seam behavior locally and identify the minimal lock-scoping changes.
2. Delegate the three production-code slices to GPT-5.4 high workers with disjoint file ownership.
3. Integrate the worker patches, add shared regression coverage, and review the combined diff.
4. Run required verification and completion-workflow audits, then create a scoped commit.

## Decisions

- Keep the shared regression coverage local in the parent thread so worker edits stay disjoint and merge-clean.
- The scheduled-log lock fix was already present at `HEAD`; preserve it with a focused regression assertion instead of widening the production diff there.
- Remove worker-added overreach (`vault-sync` preview validation and food-auto-log no-op lock fallback) so the landing stays on the requested minimal lock-scope fix.

## Verification

- Commands to run:
- `pnpm typecheck`
- `bash scripts/workspace-verify.sh test:diff packages/core/src/vault-sync.ts packages/assistant-engine/src/assistant/cron/food-auto-log.ts packages/assistant-engine/test/assistant-cron-runtime.test.ts packages/assistant-engine/test/assistant-cron-thresholds.test.ts packages/core/test/high-value-seam-regressions.test.ts packages/assistant-engine/test/high-value-seam-regressions.test.ts`
- `pnpm test:smoke`
- Expected outcomes:
- The three lock-scope regressions are covered and the scoped diff-aware lane is green.

## Results

- Landed production fixes in `packages/core/src/vault-sync.ts` and `packages/assistant-engine/src/assistant/cron/food-auto-log.ts`.
- Added focused seam regressions in `packages/core/test/high-value-seam-regressions.test.ts` and `packages/assistant-engine/test/high-value-seam-regressions.test.ts`.
- Updated assistant cron mock coverage in `packages/assistant-engine/test/{assistant-cron-runtime,assistant-cron-thresholds}.test.ts` so the food auto-log tests expose the real core lock-helper surface.
- `pnpm --dir packages/core exec vitest run test/high-value-seam-regressions.test.ts test/scheduled-logs.test.ts --config vitest.config.ts --no-coverage`: passed.
- `pnpm --dir packages/core exec vitest run test/vault-sync.test.ts --config vitest.config.ts --no-coverage -t "adds missing records and raw files without overwriting hosted text conflicts|preserves raw and JSONL conflicts without clobbering hosted values|rejects JSONL import records that are not objects"`: passed.
- `pnpm --dir packages/assistant-engine exec vitest run test/assistant-cron-runtime.test.ts test/assistant-cron-thresholds.test.ts test/high-value-seam-regressions.test.ts --config vitest.config.ts --no-coverage -t "food auto log|auto-log food|runFoodAutoLogCronJob|foodAutoLog|local one-shot|nutrition|local jobs removed"`: passed.
- `pnpm test:smoke`: passed.
- `git diff --check -- agent-docs/exec-plans/active/COORDINATION_LEDGER.md agent-docs/exec-plans/active/2026-04-23-canonical-lock-race-fixes.md packages/core/src/vault-sync.ts packages/assistant-engine/src/assistant/cron/food-auto-log.ts packages/assistant-engine/test/assistant-cron-runtime.test.ts packages/assistant-engine/test/assistant-cron-thresholds.test.ts packages/core/test/high-value-seam-regressions.test.ts packages/assistant-engine/test/high-value-seam-regressions.test.ts`: passed.
- `pnpm typecheck`: blocked by unrelated pre-existing `packages/query` dirty work (`packages/query/src/browser-replica.ts` and `packages/query/test/wearables-source-health-final.test.ts` reference `estimatedVo2Max`).
- `bash scripts/workspace-verify.sh test:diff ...`: blocked by that same unrelated `packages/query` typecheck failure when the diff-aware lane reaches `packages/assistant-runtime`.
Completed: 2026-04-23
