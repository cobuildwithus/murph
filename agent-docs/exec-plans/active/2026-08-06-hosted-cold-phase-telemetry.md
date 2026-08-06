# Hosted cold-path phase telemetry

Status: active
Created: 2026-08-06
Updated: 2026-08-06

## Goal

- Partition the remaining hosted cold interval from completed mailbox import to
  provider start into exact, non-overlapping phase timings.
- Use the evidence to select only deletion, deferral, or overlap changes that
  improve end-to-end p50 without weakening durability, provider authority,
  current-input authority, or recovery behavior.
- Keep every benchmark and proof local; do not deploy or merge this work.

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
- Pending: exercise the telemetry fields through the benchmark overlay, push an
  exact review candidate, run both required ReviewGPT stages, and require green
  exact-head CI.
