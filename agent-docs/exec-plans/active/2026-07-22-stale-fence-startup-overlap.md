# Stale-fence startup diagnostics

Status: active
Created: 2026-07-22
Updated: 2026-07-22

## Goal

Add latency-neutral diagnostics that distinguish prior-version fences and
preserve same-call elapsed durations, so the next latency change can target a
measured owner without weakening cache, deletion, or command-budget semantics.

## Success criteria

- Existing orchestration telemetry records prior-version classification and
  local elapsed durations without adding an awaited log, database, or network
  operation.
- Fresh-start preparation preserves the existing sequential workspace
  validation, exact workspace-version fence bind, and runtime-store ensure.
- Focused tests prove diagnostic parsing and the prior-version replacement
  path.

## Constraints and invariants

- UserRunner SQLite remains the sole runtime-fence owner.
- Do not skip or weaken the exact old-container no-child proof.
- Do not start a speculative replacement container before fence replacement.
- Do not add persisted product state, a lifecycle callback, service, queue,
  dependency, or timeout setting.
- Do not parallelize runtime-store loading ahead of signed workspace validation;
  doing so widens deletion invalidation and absolute-budget races.
- Reuse the existing trace payload; diagnostics must be local clock reads and
  scalar/boolean fields only.
- Preserve unrelated work and avoid `runner-container.ts`, which has an active
  lifecycle lane.

## Plan

1. Add self-contained active-wake, replacement-clear, and sequential
   preparation timing fields plus a prior-version fence bit to the shared
   latency contract.
2. Preserve the current workspace-read, ownership-check, exact fence-bind, and
   runtime-store ordering.
3. Add focused Cloudflare and shared-contract regressions.
4. Run routed verification, the required preliminary specialist review, final
   review, exact-head ReviewGPT gate, and CI before handoff.

## Evidence

- The existing fresh-start path already overlaps container readiness with
  invocation preparation.
- Existing direct and Temporal trace merging can pair timestamps from different
  callers, so same-call elapsed scalars are required for reliable attribution.
- Adversarial review rejected an additional workspace/runtime-store overlap:
  an in-flight store refresh can outlive deletion cache invalidation, and lock
  contention can consume more than the caller's absolute command budget.

## Verification

- `apps/cloudflare/test/user-runner-alarm.test.ts`: 90 tests passed.
- `packages/hosted-execution` test suite: 381 tests passed.
- Affected Cloudflare and hosted-execution typechecks passed.
- `pnpm test:scenario-integrity`: 204 scenarios passed integrity checks.
- Two independent read-only concurrency audits found no new async work and
  confirmed the sequential workspace, fence-bind, and store-load order.
- Preliminary specialist ReviewGPT found one coverage gap: the tests asserted
  only the types of the five elapsed fields. Its exact test-only patch was
  inspected and applied; the fake clock was then anchored to the observed
  preparation start so the test proves exact same-call arithmetic without
  depending on unrelated timer advancement. The user-runner suite remained
  green at 90 tests.
- The first `pnpm test:diff <touched paths>` passed affected typechecks plus the
  large Assistant Engine and Assistant Runtime suites, then encountered
  unrelated CLI artifact-preparation failures. Generating the ignored Health
  Commons artifact and preparing the CLI runtime made both exact failed files
  pass: 36 experiment-expansion tests and 38 assistant CLI tests.
- A second canonical diff run passed affected typechecks, 2,600 Assistant
  Engine tests, 1,791 Assistant Runtime tests, 128 Assistant CLI tests, 40
  Assistantd tests, the 1,080-test CLI aggregate, 45 cloudflare-hosted-control
  tests, and 381 hosted-execution tests. It then exposed a missing
  `packages/assistant-runtime/dist` prerequisite in the unchanged hosted-local
  harness. Building that package and rerunning the harness alone passed 24
  files and 406 tests with one skip.
- Final exact-current-main verification and final ReviewGPT are pending.
