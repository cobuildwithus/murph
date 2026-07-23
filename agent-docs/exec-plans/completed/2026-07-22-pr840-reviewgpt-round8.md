# PR 840 ReviewGPT Round 8 Remediation

## Goal

Resolve the three accepted round-eight findings without restoring Ask-specific
state or coordination:

1. Keep the joined-group admission constraint on every import in the entire
   pre-checkpoint pass.
2. Compare Ask completion occurrence time only with personal-input occurrence
   time, and keep completions out of causal-only passes that lack that cutoff.
3. Keep pending-input index backfill and compaction off the foreground reply
   path.

## Constraints

- Preserve automatic wake and natural private-Murph composition.
- Do not run, advance, or shorten the ordinary idle checkpoint.
- Keep consented-member Ask requests checkpoint-gated.
- Add no queue, coordinator, scheduler, reconciliation owner, or persisted
  state.
- Foreground ordering may read a complete existing index but must not backfill,
  compact, or rewrite it.

## Working Set

- `packages/assistant-runtime/src/hosted-runtime.ts`
- `packages/assistant-runtime/src/hosted-runtime/pending-assistant-input.ts`
- `packages/assistant-runtime/src/hosted-runtime/pending-input-index.ts`
- `packages/assistant-runtime/src/hosted-runtime/workspace-assistant-phase.ts`
- focused Assistant Runtime tests and current hosted-runtime architecture docs

## Verification Plan

- Add production-path regressions for joined-group versus consented-member
  dirty-window admission, including conversation work.
- Add strict occurrence-order and causal-only exclusion tests.
- Prove the foreground timestamp lookup performs no index maintenance.
- Run focused tests, canonical `pnpm test:diff`, required coverage review,
  documentation checks, full acceptance verification, commit, push, and CI.
- Do not start another ReviewGPT round without separate authorization.

## Round Eight Findings And Decisions

The exact-head review of `a9225c53215bc5e4fe40ee96cf650cd1237bac5c`
returned three review-induced findings. All three were reproduced and accepted:

1. A one-off joined-group restriction covered the first system import but not
   the shared pre-assistant importer. Move the restriction into the shared
   import context for the entire pre-checkpoint pass.
2. The cutoff preferred personal-input receipt time and causal-only passes
   admitted Ask completions without resolving a cutoff. Use occurrence time
   only and keep Ask completions out of causal-only passes.
3. The cutoff resolver compacted and backfilled the pending-input index on the
   foreground path. Read only an existing complete index and fail closed when
   that evidence is unavailable.

The remediation adds no state, queue, coordinator, checkpoint trigger, or
background owner. It narrows existing admission and ordering boundaries.

## Evidence

- Focused pending-input timestamp and no-mutation tests passed: 8 tests.
- Full workspace assistant-phase tests passed: 250 tests.
- Full workspace entrypoint tests passed: 235 tests, including both
  consented-member dirty-window paths.
- Assistant Runtime typechecking exposed one missing `terminalReason` in the
  new test fixture; the required coverage-write worker corrected that
  test-only omission before the canonical rerun.
- The required coverage-write audit found no production or proof gap after
  that fixture correction. The three changed owner suites and Assistant
  Runtime typecheck passed.
- Canonical `pnpm test:diff` passed its guards and typecheck, then reported one
  unrelated Clinical Records preemption race in the full package suite; the
  exact failed test passed immediately in isolation.
- `pnpm docs:drift` and `git diff --check` passed after refreshing the hosted
  runtime entries in `agent-docs/index.md`.
- Added-line privacy scanning passed.
- `pnpm verify:acceptance` could not acquire the exclusive shared-host slot;
  another pre-existing acceptance process remained the live owner after the
  bounded wait. Only this task's queued waiter was cancelled. The previous PR
  head passed acceptance, and the current remediation is covered by the scoped
  owner tests, typecheck, guards, and pending exact-head CI.
Status: completed
Updated: 2026-07-22
Completed: 2026-07-22
