# Prepare fresh runner latency PR for merge

Status: completed
Created: 2026-09-06
Updated: 2026-09-06

## Goal

Prepare PR #2999 for merge with its member-facing release note, exact-head ReviewGPT and green required CI. The previous local implementation remains the candidate; deployment is outside this task.

## Product UX

Effort: Patch. Outcome: Less serial setup before a fresh runtime accepts work.
Reaches: Admitted fresh starts; existing warm-wake and failure behavior retained.
Proof: Existing 196 focused tests and paired setup benchmark; content-only changelog render proof. Production latency is not yet measured for this change.

## Tasks

1. Add the source-linked release note and complete review evidence.
2. Run focused changelog rendering and Web typecheck; keep existing runtime proof.
3. Push the stable head, mark Ready, run ReviewGPT concurrently with CI.
4. Resolve concrete findings, verify mergeability, close this integration plan and report readiness.

## Verification

Runtime implementation: 196 focused tests, Cloudflare typecheck, docs drift and complexity guard passed. Local setup benchmark: 951.19 ms base to 434.26 ms candidate. Changelog archive rendering passed 9 tests; Web typecheck passed. ReviewGPT and final-head CI pending.

## Boundaries

No new protocol, provider input, persistent state or deployment. Only synthetic benchmark evidence belongs in this public plan. Keep further latency experiments in their own owned checkout.

## Review and CI follow-through

ReviewGPT round 1 passed at `bd20e723fcb49d12e25f349e7620327a46238f3b`: zero qualifying findings. The Phlebas lane selected `gpt-6-pro`; response-model metadata confirms that exact model and response hash. The guarded full snapshot, exact committed turn and completion marker were validated. Response capture lasted about 306 seconds after send (323 seconds including draft staging), above the 270-second floor. The review traced admission, fresh/cold/retained allocation, failures, deadlines, membership, usage restrictions and attribution; source/test inspection was proportionate to the patch.

The first Cloudflare CI run found three alarm fixtures that assumed serial crypto loading. Their revised gates prove concurrent reads, expiration after fresh-fence acquisition, and exactly-once failure counting without advancing fake time while waiting for readiness. All 177 alarm tests and Cloudflare typecheck pass. This correction changes isolated tests only; the reviewed production tree is unchanged and needs no new substantive ReviewGPT round. The final pushed head still requires green CI before merge readiness is reported.
Completed: 2026-09-06
