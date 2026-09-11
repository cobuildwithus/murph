# Spread individual recovery wakes with bounded jitter

Status: active
Created: 2026-09-11
Updated: 2026-09-11

## Outcome and scope

Spread each selected user recovery operation over a stable zero-to-five-second window instead of starting the whole cohort immediately. Web owns both due-device wake append and shared mailbox recovery dispatch. Preserve the 25-item default, 250-item cap, five concurrent operations, exact durable pointers, authority checks, failure counts, and retry ownership. The private global Schedule phase change is independent.

Product UX effort: Patch. Outcome: reduce background recovery bursts. Reaches: scheduled device reconciliation and shared preference, device, runtime-control, and Clinical Records handoff recovery. Proof: timed execution through both existing sweeps, retry/deadline preservation, and maximum-cardinality concurrency. Direct ingress, exact reminders, provider retry timestamps, and per-user runtime timers are outside these sweep call paths and remain unchanged.

## Evidence and design

Both sweeps currently dispatch five operations immediately and refill their slots without pacing. Replace their duplicate executors with one bounded executor: stable SHA-256 user offsets, offset ordering before slot acquisition, monotonic elapsed time, and no cumulative delays. Wait before calling the existing transaction/signal owner. No new durable state, queue, configuration, or dependency. Preserve the existing handoff-work timeout by allowing its five-second pacing window separately. Two sequential sweep phases add at most ten seconds of intentional pacing to the existing 30-second callback budget; execution overhead and backpressure remain additional.

## Failure and deployment

Ordinary failures retain per-item accounting; unexpected worker failures drain started siblings before propagation. An interrupted request leaves existing durable due state or mailbox ownership for the next sweep. Duplicate attempts retain canonical dedupe and signal coalescing. Deploy Web independently, with no schema or wire changes; old Web remains compatible and only lacks pacing. Rollback removes pacing without rewriting state. No production mutation is authorized by this PR task.

## Tasks and proof

- [x] Trace owners, prove eager fan-out, and inspect callback/handoff budgets.
- [x] Implement bounded jitter and update the reliability owner.
- [x] Prove distribution, stable retries, maximum cardinality/concurrency, draining, timeout allowance, and both composed dispatch paths.
- [x] Run focused tests, Web typecheck, complexity guard, and parent review.
- [ ] Commit, open companion PR, run final ReviewGPT and exact-head CI, close this plan.

## Validation results

The five focused suites passed all 31 tests, including actual dispatch through both sweeps at 250-user cardinality. The helper cohort spans all five one-second bins, with more than 230 distinct millisecond dispatch times; slow work peaks at five active operations. Reversing the retry input preserves per-user offsets. Both new composed timing assertions fail against the original source because every start shares one instant. Existing consent, dedupe, orphaned-work identity, failure-accounting, and bounded hung-handoff tests pass.

Web dependency builds, Web typecheck, scoped ESLint, diff whitespace, and complexity guard passed. No changed function exceeds complexity 20. Parent Product UX walkthrough: Ready for eligible recovery timing; direct ingress and exact reminder/provider deadlines remain outside the executor. No measured production pressure reduction is claimed. Final ReviewGPT, exact-head CI, and plan closure remain pending.
