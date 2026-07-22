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
- After a clean merge of current `origin/main`, a third canonical diff run
  passed every guard and affected typecheck, 2,602 Assistant Engine tests, 128
  Assistant CLI tests, 1,791 Assistant Runtime tests, and 40 Assistantd tests.
  Its CLI aggregate had 1,079 passing tests and one failure in the unchanged
  release-script audit: current main's ReviewGPT policy now allows a
  discretionary 6.5-to-7.5-minute response window, while the audit still
  requires the deleted blanket under-7.5-minute sentence. Both the policy and
  audit files are byte-identical to `origin/main` in this branch.
- `pnpm verify:acceptance` passed repository guards, all workspace typechecks,
  hosted-execution coverage (381 tests), Assistant Engine coverage (2,602
  tests), Assistant Runtime coverage (1,791 tests), and the other reported
  package/app suites. It reproduced the same current-main CLI policy assertion.
  It also exposed two exact Cloudflare route expectations that omitted the new
  prior-version boolean; adding that expected field changed no production code.
  The exact route file then passed 90 tests and the full Cloudflare node suite
  passed 106 files and 1,857 tests.
- `pnpm docs:drift` and `git diff --check` passed.
- Final ReviewGPT and exact-head CI are pending.
