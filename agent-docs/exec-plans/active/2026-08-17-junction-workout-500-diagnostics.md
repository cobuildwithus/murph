# Junction workout-stream 500 diagnostics

## Goal

Make recurring Junction workout-stream HTTP 500 failures diagnosable without
exposing provider or member identifiers, and report the actual durable job
disposition after each failed attempt.

## Proven production symptom

- Hosted runtime telemetry recorded repeated retryable Junction workout-stream
  failures across six connections after the current production deploy.
- The provider response is an HTTP 500 from the dedicated per-workout stream
  endpoint; bounded aggregate evidence cannot yet distinguish one poison
  workout from a broader provider defect.
- One retryable stream failure stops the current serial resource attempt, so
  later candidate workouts may wait behind it.
- `device-sync.job_failed` has multiple writers, while the worker-side entry
  currently derives `failureDisposition` from retryability instead of the
  durable queue result.

## Protected invariants

- Never log or persist raw member, connection, account, source-instance,
  workout, request payload, credential, or provider-response identifiers.
- Keep the existing bounded one-day index and serial stream-call limits.
- Do not silently skip retryable provider failures or add another retry,
  scheduler, queue, or state owner.
- Preserve job retry, continuation, canonical import, and source-disconnect
  behavior.

## Current owners and evidence gap

- `packages/device-syncd` owns candidate selection, provider egress, durable
  job attempts, retry scheduling, and terminal job disposition.
- `packages/assistant-runtime` owns hosted per-attempt runtime-log projection.
- Existing provider-request diagnostics identify endpoint kind and status but
  do not supply a privacy-safe candidate correlation seam or the actual
  post-failure durable job state.
- The next correction should extend those existing owners rather than create a
  parallel observability or retry subsystem.

## Implementation

1. Ask the existing ReviewGPT investigation to inspect the current exact source
   and return the smallest compilable diagnostics patch with focused tests.
2. Verify every returned hunk against the real job and logging paths; reject
   raw identifiers, inferred disposition, speculative retry-policy changes,
   and new state owners.
3. Apply only the accepted bounded diagnostics, then run focused device-sync
   and assistant-runtime tests, affected typechecks, and privacy-safe direct
   scenario proof.
4. Push an exact candidate, run required CI and ReviewGPT completion gates,
   resolve accepted findings, and close this plan with the final scoped commit.

## Verification

- A retryable failed attempt records whether the durable job was requeued or
  became terminal, including bounded attempt-budget facts from the existing
  store result.
- Provider-request evidence distinguishes the diagnostic origin and supplies
  only bounded candidate position and alias-source metadata from the existing
  privacy-safe owner.
- Focused tests prove no raw candidate identifier or provider payload enters
  runtime telemetry.
- Existing workout continuation, optional 404/422 retirement, retry, and
  terminal-failure tests remain green.

## Completed proof

- ReviewGPT returned a 19-file diagnostics patch against the exact task base;
  the parent inspected every hunk, verified its SHA-256, and proved the applied
  tree with a reverse apply check and `git diff --check`.
- Focused Vitest passed for importers (9 tests), device-syncd (450 tests),
  assistant-runtime (476 tests), and hosted Web authority (75 tests).
- Owner typechecks passed for importers, device-syncd, assistant-runtime, and
  hosted Web.
- Tests prove the fifth retryable attempt is reported as durably `dead`, earlier
  attempts are reported as `queued`, lease loss produces no fabricated
  transition, retained accepted work still extends its existing attempt fence,
  and raw workout/request/payload identifiers do not enter runtime telemetry.
- Final ReviewGPT round 1 returned `ROUND_OUTCOME: PASS` with no qualifying
  production-code, architecture, privacy, or purpose finding. It identified
  two overbroad coverage claims that matched the preliminary specialist pass.
- The preliminary specialist pass found missing executable proof for the
  runner-to-Web candidate-field projection boundary and the `checkpoint` and
  `device_activity_automation` failure origins. The accepted remediation adds
  only focused regression tests; production code and runtime architecture are
  unchanged.
- The two directly affected assistant-runtime test files pass all 396 tests,
  and the assistant-runtime owner typecheck remains green after remediation.
