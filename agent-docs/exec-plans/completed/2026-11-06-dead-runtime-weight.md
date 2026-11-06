# Remove obsolete clinical caches and unused hot snapshot producer

Status: completed
Created: 2026-11-06

## Outcome and invariants

Remove only superseded extraction cache directories through ordinary bounded idle
maintenance. Preserve extraction-v4, pending index, job records, canonical evidence,
and legacy snapshot readers. Delete the unused hot snapshot producer and its private
exclusions, budgets and tests; preserve the separately used restore/clear surfaces.

## Evidence and decisions

- Fresh origin/main at acf0dc8960 matches the starting checkout. The hot producer has
  only test references; its exclusion predicate has no other caller.
- Clinical cache reads and writes derive extraction-v4 through extractionCachePath.
  The broad non-rebuildable descriptor protects retrieval checkpoints and accepted
  jobs, not superseded disposable extraction caches. Clarify that owner contract.
- Staged pruning is excluded. WriteBatch.create and mutate precede commit's lock;
  neither has a maximum lifetime. The in-process write queue waits before the
  cross-process timeout begins. Age plus lock ownership cannot prove abandonment.
  Do not add writer leases, flags or a new state owner to solve that separate problem.
- Inbox recovery enumerates sibling stage directories, accepts nonterminal operation
  metadata, and reads receipt-verified staged JSONL payloads (`inboxd/indexing/persist.ts`).
  `vault.ts` reports staged operations as unresolved; validation is not expiry or
  abandonment authority. Commit persists `committing` before applying actions,
  but that ordering alone does not establish that an old staged writer is dead.

## Implementation and proof

1. Hydrate and build the affected dependency closure.
2. Observe a failing idle-maintenance cache cleanup test and failing retired-export assertion.
3. Implement small abortable cache deletion within the existing idle maintenance budget;
   remove the unused producer while preserving full snapshot and legacy restore tests.
4. Run complete affected and consumer package suites, workspace typecheck, complexity diff.
5. Review the diff and privacy, close this record, make one scoped local commit.

## Rollout and rollback

Roll out only after extraction-v4 readers/writers are established in every runner
sharing these workspaces. No rollback to earlier extraction semantics after deletion;
reverting this cleanup on a v4-capable runner is safe but does not restore removed caches.
No schema change or current-cache retention change. Parent owns push, review and deploy.

## Verification

Internal storage cleanup only; no member-visible changelog. Full source/diff review
preserves the clear/restore surfaces and the shared rollout scan limit. Runtime-state
and vault-usecases are the changed library owners; assistant-runtime is the only
consumer of the changed surfaces (new prune call and unused test imports). Unchanged
exports do not require rerunning every transitive dependency consumer's full suite;
workspace typecheck covers those consumers.

- `pnpm install --prefer-offline`: EXIT=0.
- Dependency-closure build: EXIT=0. Final affected builds: EXIT=0.
- Failing-first idle cleanup regression: EXIT=1 before, EXIT=0 after.
- Retired-export assertion through the real runtime-state node entrypoint:
  EXIT=1 before, EXIT=0 after. Kept no implementation-mirroring absence test.
- Cache cancellation/resumption and symlink tests: 2 passed, EXIT=0.
- Retained hosted-bundle tests: 57 passed, EXIT=0.
- Full runtime-state suite: 31 files; 280 passed, 19 skipped; EXIT=0.
- Full vault-usecases suite: 57 files; 539 passed; EXIT=0.
- Initial full assistant-runtime suite: 194 files passed, one failed, one skipped;
  4,340 tests passed, one failed, seven skipped; EXIT=1. The sole failure was the
  unchanged-cleanup warning-count test's nonexistent vault root, which correctly
  triggered an additional cleanup warning. Replaced that fixture with a temporary
  directory; no production correction was needed. This was not a load timeout.
- Complete idle-maintenance test file after fixture correction: 55 passed, EXIT=0.
- Final full assistant-runtime suite: 194 files passed, one failed, one skipped;
  4,339 tests passed, two failed, seven skipped; EXIT=1. The changed idle-maintenance
  file passed. An unrelated dense-retention case hit ENOENT under its fixed
  temporary vault, and an unrelated slow-log case timed out after 60 seconds.
  Both cases passed in the first complete run. The final isolated selection passed
  all five selected cases with one worker, EXIT=0 (65 ms executing tests).
  Treat the isolated timeout as host load, as requested; do not claim a green
  full-suite exit. The fixed temporary-root collision risk is recorded in Frog
  entry `20261106174628-hosted-maintenance-tests` and included in this commit.
- Final `pnpm typecheck` and `pnpm complexity:diff` after the fixture correction:
  both EXIT=0.
- `pnpm typecheck`: EXIT=0 (workspace packages and apps).
- `pnpm complexity:diff`: EXIT=0; no added complexity debt or increased maxima.
- Synthetic live-writer experiment: EXIT=0. Under the canonical lock, pruning
  with an eight-day future boundary retains the staged batch. The original live
  batch then commits successfully and `validateVault` returns valid.
- Staged expiry's requested deletion/status matrix is deliberately not implemented
  or claimed: the abandonment prerequisite failed. No core pruning code changed.
- External review, CI, live workspace cleanup and production drain remain parent
  work; this lane makes one local commit only.

Updated: 2026-11-06
Completed: 2026-11-06
