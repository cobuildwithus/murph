# Device-sync snapshot import bottleneck

Status: active
Created: 2026-08-25
Updated: 2026-08-25

## Goal

- Make large hosted Junction device-sync backlogs converge without repeatedly
  exhausting the bounded system-mailbox pass, while preserving foreground
  priority, durable per-slice progress, and the existing Web/Cloudflare/runtime
  ownership boundaries.

## Success criteria

- A production-faithful focused test or benchmark reproduces the measured
  snapshot-import bottleneck and proves the fix materially reduces its cost.
- Slow Junction resource work reports enough metadata-only timing to separate
  provider/source time from local snapshot import time without exposing member,
  provider-record, payload, credential, or filesystem identifiers.
- The worst observed backlog progresses without repeated pass-timeout yields
  after deployment, or live evidence isolates a remaining external bottleneck
  with no local performance defect left unaddressed.
- Foreground interruption, retry/checkpoint semantics, and partial-progress
  durability remain covered and green.

## Scope

- In scope: hosted device-sync resource/reconcile execution, canonical snapshot
  import, focused telemetry, tests/benchmarks, exact-head review, deployment,
  and post-deploy convergence proof.
- Out of scope: a second scheduler or queue, wider provider-policy changes,
  unbounded pass duration, and unrelated device connection/setup behavior.

## Constraints

- Technical constraints: Web stays the control-plane owner, Temporal stays the
  pointer/retry owner, Cloudflare stays the execution owner, and the system
  mailbox remains finite and preemptible. Preserve replay-safe checkpoints and
  do not hold database transactions across provider or artifact I/O.
- Product/process constraints: foreground conversation work retains priority;
  production evidence and logs remain metadata-only and privacy-safe; complete
  the normal worktree, ReviewGPT, CI, merge, deploy, and live-proof workflow.

## Risks and mitigations

1. Risk: batching or caching snapshot work could weaken replay correctness.
   Mitigation: keep the canonical importer as the sole state owner and prove
   restart/checkpoint behavior around every optimized boundary.
2. Risk: timing telemetry could expose health or member data.
   Mitigation: emit only bounded categories, counts, elapsed milliseconds, and
   stable error classes already allowed by the runtime logging contract.
3. Risk: a longer timeout could hide rather than remove the bottleneck.
   Mitigation: retain the bounded timeout and require measured before/after
   import cost plus live queue-convergence evidence.

## Tasks

1. [x] Correlate live slow-pass telemetry with current snapshot-import and
   Junction resource code, active plans, and recent changes.
2. [x] Build a production-faithful focused reproduction and prove the root
   bottlenecks.
3. [x] Implement the smallest durable performance fix while preserving
   checkpoint and foreground-preemption behavior.
4. [ ] Run focused and broad verification, Product UX walkthrough, privacy and
   diff audits, and commit the candidate.
5. [ ] Run specialist and final ReviewGPT, required CI, merge and deploy safely,
   then verify the affected backlog and fleet converge.

## Decisions

- Raising the pass deadline from 90 seconds to 120 seconds was useful for
  throughput and timing visibility but did not clear the slowest backlog. Two
  consecutive timeout-yielded passes spent roughly three quarters of their
  time importing one active-calorie resource snapshot, while a mindfulness
  resource spent most of its remaining time outside measured source read and
  snapshot import. Timeout growth alone is therefore not the primary fix.
- Seventy paired production passes showed snapshot-import cost scaling with
  workspace bytes (correlation about 0.72 and roughly 477 ms/MiB). Yielded
  passes averaged about 99 seconds of import time versus about 15 seconds for
  completed passes. The canonical importer was reparsing every historical
  event-ledger row for each nonempty resource snapshot.
- Reuse is intentionally pass-local and correctness-fenced. A cached baseline
  is used only for non-overlapping identities and authoritative scopes, and
  only while the live event-ledger metadata fingerprint is unchanged. Samples,
  overlap, structural Junction alias repair, external writes, and failures
  either leave the cache untouched or force a full scan.
- Hosted maintenance now asks the existing worker owner for one bounded drain,
  instead of one single-job drain call per loop iteration. The worker retains
  the existing between-job foreground-yield fence and reports cumulative
  processed rows so timeout/error accounting does not lose partial progress.
- Product UX Patch: the reachable experience is background freshness for
  connected-device data; there is no new visible control or copy. Success is
  observable as current device facts arriving without conversation latency or
  repeated runtime alerts.

## Verification

- Focused reproduction before the fix: a 10,000-event, 4.2 MiB ledger required
  about 2.58 seconds for one incremental import, matching the production slope.
  With the guarded session, the first scan took about 3.25 seconds and a
  disjoint follow-up index lookup took about 70 ms (roughly 46x less index
  work); total follow-up import time fell from about 3.68 seconds to 0.69
  seconds. The checked-in regression uses a smaller deterministic fixture and
  asserts cache miss/hit, overlapping correction, external-write invalidation,
  and sample-only behavior without timing thresholds.
- Commands to run: focused device-sync/runtime tests and benchmark, affected
  package typechecks, diff-aware repository verification, privacy/logging
  guards, ReviewGPT exact-head audits, required GitHub checks, deployment
  fingerprint/smoke probes, and bounded production telemetry aggregates.
- Expected outcomes: local import time falls materially for the reproduced
  workload, all correctness gates pass, the exact reviewed commit deploys, and
  live slow-lane passes complete or expose only a remaining provider-owned wait.

## Product UX walkthrough

- Outcome: an established member with a large connected-health history receives
  fresher device facts without that background catch-up repeatedly consuming the
  whole hosted maintenance pass.
- Reaches: the existing scheduled device-sync wake, bounded worker drain,
  canonical snapshot import, and later member-visible health context. No control,
  copy, permission, audience, or provider selection changes.
- Proof: the production-shaped benchmark demonstrates the local import reduction;
  focused service/runtime tests prove between-job yielding, cumulative durable
  progress, and privacy-safe diagnostics; post-deploy runtime evidence will prove
  the ordinary hosted path reaches timely canonical imports.
- Walkthrough result: `Ready` for review. Sparse histories keep the same path,
  overlapping corrections still force authoritative rescans, and failures retain
  the existing retry/recovery owner rather than presenting a false completion.

## Completed local checks

- Core import-session regression: 3 tests passed, covering disjoint reuse,
  correction and external-write invalidation, sample-only behavior, and a
  throwing timing observer.
- Device-sync, Junction, importer, assistant-runtime, and hosted-execution
  focused suites: 14 selected tests passed across 7 test files.
- Affected package typechecks passed for Core, Importers, Device Sync,
  Assistant Runtime, and Hosted Execution.
- Hosted Web changelog component proof passed all 9 selected tests for the new
  member-facing reliability item.
- `scripts/frog list` reported no unresolved repository friction.
