# Hosted cold-path phase telemetry

Status: completed
Created: 2026-08-06
Updated: 2026-08-06

## Goal

- Partition the remaining hosted cold interval from completed mailbox import to
  provider start into exact, non-overlapping phase timings.
- Use the evidence to select only deletion, deferral, or overlap changes that
  improve end-to-end p50 without weakening durability, provider authority,
  current-input authority, or recovery behavior.
- Keep every benchmark and proof local. Do not deploy this work; merge is
  authorized once the required exact-head gates pass.

## Constraints

- Preserve Product-Critical Flow Preservation and all hosted runtime protocol
  invariants.
- Add no new state owner, queue, cache, service, or compatibility layer merely
  for performance.
- Keep production evidence aggregate and redacted. Never persist row contents,
  credentials, object keys, or direct identifiers.
- Preserve unrelated work and active R2 cutover, mailbox wake, runner image,
  and idle-compaction lanes.

## Tasks

1. Map the exact serial path and define monotonic spans whose sum closes the
   import-to-provider interval without nesting or double counting.
2. Add the smallest runtime telemetry surface and focused regression tests.
3. Exercise the telemetry with the local hosted stack for both first-contact
   and established-R2 cold restores, separating Node first-use from warm reuse.
4. Rank measured candidates by endpoint ceiling and implement only a simple,
   invariant-preserving candidate with credible material impact.
5. Run focused verification, open a PR, complete the preliminary specialist
   and final ReviewGPT gates, and require green exact-head CI.

## Verification log

- PASS: `pnpm typecheck` in `packages/assistant-engine`,
  `packages/assistant-runtime`, and `packages/hosted-execution`.
- PASS: provider-start partition utility, focused local-service handoff, and
  focused App Server ordinal-gating tests.
- PASS: full hosted-runtime maintenance test file (76 tests) and hosted-runtime
  control parser test file (32 tests).
- PASS: `git diff --check`; the changed-file privacy scan found no local paths
  or direct identifiers.
- PASS: local hosted-stack baseline pilot with stub providers: first-contact
  provider-start p50 3,636 ms (`n=3`) and established 14.1 MB v2-R2
  provider-start p50 5,600 ms (`n=3`). The local R2 object-fetch p50 was
  206 ms, so this proves mechanics but is not production-latency-equivalent.
- PASS: the exact telemetry overlay completed first-contact and established-v2-R2
  cohorts with one warmup and three measured samples each. The nine adjacent
  spans closed at 730 ms p50 for first contact and 572 ms p50 for established
  restore; local webhook-to-provider p50 was 3,667 ms and 5,791 ms respectively.
- ACCEPTED/FIXED: preliminary ReviewGPT found that one scan could pass the same
  invocation timing context to multiple provider-reaching groups because each
  group starts at provider ordinal zero. The scanner now retains the context
  across groups that exit before provider start and consumes it synchronously
  on the first actual provider-start hook, even when completion validation omits
  the timing. A three-group regression proves no-provider/first-provider/later-
  provider ownership, and the App Server test now proves both positive ordinal
  zero completion and nonzero omission.
- PASS after remediation: assistant automation plus partition tests (178),
  focused App Server production handoff (2), hosted-runtime maintenance (76),
  assistant-engine typecheck, and `git diff --check`.
- ACCEPTED/FIXED: final ReviewGPT round 1 found that the initial telemetry gate
  treated any conversation work as a foreground provider owner. A disabled-
  channel import or retryable-blocked-only import could therefore carry the
  timing into an older background reply. The gate now requires at least one
  actual fresh assistant-input ID; the broader conversation-work predicate is
  unchanged for its worker and checkpoint responsibilities.
- PASS after final-round remediation: the production entrypoint suite passed
  273 tests, including no-context regressions for imported-without-input and
  retryable-blocked conversation work plus the positive fresh-input case;
  assistant-runtime typecheck and `git diff --check` passed.
- FIXED: final review also corrected the PR-body hot-path count. A normal
  first-provider partition takes ten monotonic reads, not nine. If speculative
  App Server initialization fails and the existing warm fallback succeeds, the
  failed attempt's process stamp is replaced, so eleven raw reads still yield
  the same ten final boundaries. The hook checks its already-notified guard
  before taking any fallback tick, so a later `turn/started` notification adds
  no unused read. The 249-test App Server suite and assistant-engine typecheck
  passed.
- PASS: final ReviewGPT round 2 found no qualifying findings. Its explanatory
  follow-up clarified that a speculative App Server failure can cause eleven
  raw monotonic reads while still producing the same ten final boundaries.
- PASS after clean reconciliation onto `main`, including the completion-receipt
  change: the affected local-service provider split passes independently, the
  four affected assistant-runtime cases pass, the hosted runtime-control suite
  passes 32 tests, and assistant-engine, assistant-runtime, and hosted-execution
  typechecks pass.
- PASS: the combined four-file assistant-engine run completed 506 tests before
  the unrelated local-service worker exhausted the shared host's 4 GB heap; the
  exact affected local-service case passes in a fresh isolated process.
- NON-BLOCKING HARNESS LIMIT: broad shared-host runs exhausted the Vitest worker
  heap or timed out two unrelated long-running entrypoint cases under heavy
  parallel load. The exact changed tests pass in isolated fresh processes, and
  GitHub Actions owns the broad exact-head suite.
- PASS: exact-head GitHub Actions completed successfully on the reconciled
  candidate, including app verification, assistant/platform/CLI coverage,
  release build/typecheck, both CLI host matrices, frontend proof, artifact
  hygiene, and the runner permission sandbox gate.
- Authorized: merge after the plan-closure head passes exact-head CI. Deployment
  remains out of scope.
Completed: 2026-08-06
