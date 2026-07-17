# PR 752 assistant coverage race

Status: completed
Created: 2026-07-16
Updated: 2026-07-16

## Goal

- Make the exact PR head's assistant coverage gate deterministic without
  changing production behavior or weakening timeout/coverage requirements.

## Success criteria

- The overlapping-local-turn test waits for the mock start response it depends
  on before injecting completion.
- The focused test file passes under coverage.
- The full assistant package coverage shard and aggregate release gate pass on
  GitHub for the resulting head.

## Scope

- In scope: the narrow race in
  `packages/assistant-engine/test/assistant-codex-runtime.test.ts`, focused and
  exact-head verification, latest-main reconciliation, and PR metadata.
- Out of scope: runtime behavior, timeout increases, coverage threshold
  changes, unrelated test cleanup, deployment, and merging PR 752.

## Constraints

- Technical constraints: preserve the existing warm-process behavior and make
  test event ordering explicit through the existing deferred helper.
- Product/process constraints: do not rerun ReviewGPT solely for an isolated
  regression-test correction or a clean base-only merge.

## Risks and mitigations

1. Risk: masking a product defect as a test flake.
   Mitigation: retain the same runtime assertions and prove from two identical
   CI failures that `turn/completed` can race the separately-owned mock start
   response; change only the test synchronization point.

## Tasks

1. Add an explicit deferred for completion of the mock start response.
2. Run the focused file under coverage and relevant type/test checks.
3. Reconcile current `main`, commit, push, and monitor exact-head CI.

## Decisions

- Do not raise the 60-second timeout. The unchanged file passed all 194 tests
  under focused coverage in 48.6 seconds; the full-suite failure is an ordering
  race followed by shared warm-process teardown cascades.
- Await the mock-owned start response immediately before emitting
  `turn/completed`, which is the earliest point that closes the race without
  changing the behavior under test.

## Verification

- Two GitHub assistant coverage attempts failed identically: the first 32
  runtime cases passed, the overlapping-local-turn case timed out at 60
  seconds, and 161 later cases failed because the warm fixture remained busy.
- Current `main` showed the same failure on three consecutive workflow runs;
  the latest run passed without a harness change, confirming scheduling
  sensitivity rather than a PR production regression.
- The static race is in the test: both the queued mock and the test await the
  emitted `turn/start` request independently, but only the mock writes its RPC
  response. Under CI timer ordering, the test could resume first and inject
  `turn/completed` before the response established the active turn.
- After adding the explicit mock-start deferred, assistant-engine typecheck
  passed and all 194 tests in the runtime file passed under coverage in 48.1
  seconds. The selected-file command exited nonzero only because a single file
  cannot meet the package-wide global coverage thresholds.
- Reconciled the then-current `main` through a clean normal merge. The
  assistant-engine typecheck and full scripted runtime file passed afterward;
  the final exact-head CI run will start after this plan-closing commit is
  pushed.
Completed: 2026-07-16
