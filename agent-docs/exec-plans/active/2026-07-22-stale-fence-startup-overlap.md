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
- `pnpm test:diff <touched paths>` passed affected typechecks plus the large
  Assistant Engine and Assistant Runtime suites, then encountered unrelated
  CLI timeouts and experiment-expansion failures outside this diff. Its final
  CLI worker remained idle after reporting those failures and the exact
  session-owned verification process was stopped after a bounded grace period.
- Preliminary specialist review, final verification, and final ReviewGPT are
  pending.
