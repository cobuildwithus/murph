# Prevent runtime wake and cleanup churn; surface interrupted streams

Status: completed
Created: 2026-09-18
Updated: 2026-09-18

## Goal

Allow an admitted finite media-retention invocation to finish its checkpoint
without being interrupted by its own orchestration recheck. Surface abnormal
incomplete provider-stream closes in the existing diagnostic warning channel.

## Outcome and protected invariants

Postgres remains the sole runtime admission owner. Exact runner identity and
native liveness remain required before reporting an owner active. Foreground
work retains the existing retention preemption path. Unknown liveness preserves
ownership; elapsed time never proves a runner stopped. Provider transport,
accounting, cancellation and Codex recovery behavior remain unchanged.

## Evidence and smallest correction

A same-mode retention recheck currently invokes the mutating wake operation.
The finite retention checkpoint rejects pending wakes, so its own recheck can
interrupt checkpointing and cause repeated replacement. Acknowledge the exact healthy
active retention invocation in the existing container wake owner before TCP
dispatch. Preserve its earlier abort and cleanup guards and all uncertain or
pointerless recovery paths.
No new scheduler, durable state, retry loop, RPC or deadline is needed.

The provider logger warns on abnormal closes before any response frame, but
an interrupted active generation after partial frames is logged at debug level.
Use existing request association, generation, inspection and terminal metadata
to classify that incomplete abnormal close as a warning. Completed, normal,
prewarm and ambiguous closes retain their existing classification.

Cleanup health probes use the SDK auto-starting transport even after the native
container has stopped while cached lifecycle state still says running. Reuse the
existing native TCP observation path for health reads and honor native stopped
state before cleanup health. Fresh readiness retains its explicit startup path.
Synthetic stale-state and stopped-during-probe cases must prove no startup occurs.

## Scope and ownership

- Processing lane: container wake implementation and focused owner tests.
- Cleanup lane: observational health transport and native-stopped proof.
- Proxy lane: existing provider diagnostic classification and Workers tests.
- Completion owner: durable README, plan, candidate review, scoped commit,
  exact-head ReviewGPT and CI, protected deployment and bounded live checks.
- Device-sync and cold-start investigations are evidence-only unless another
  independent reproducible defect is established. No duplicate merged fixes.

## Design decision

The orchestration liveness reader deliberately reports preserved uncertain
operations as active. Substituting that read would bypass the exact wake path's
failed-cleanup recovery. Keep the correction inside the container wake owner,
where healthy invocation state is already distinguished from uncertainty.
Pointerless recovery remains unchanged; this patch does not claim to eliminate
all checkpoint interruption after a Durable Object restart.

## Failure and deployment

Use the existing accepted/retry/retirement results and fail-closed identity
checks. A Worker-only release supports retained runner images and current Web
readers because health and logging fields already exist. Mixed old Workers may
still issue retention wakes until convergence; no migration or repair is added.
Only a separately authorized rollback could restore an older Worker version.

## Tasks

1. Reproduce each changed boundary with synthetic focused regressions.
2. Implement the three small owner-local corrections and review the combined diff.
3. Run focused tests, app typecheck, docs drift and complexity checks.
4. Close the plan, commit, push a draft PR, then start ReviewGPT concurrently
   with exact-head CI once the candidate is Ready.
5. Complete protected deployment and verify serving identity, smoke and bounded
   natural-traffic observations; report remaining provider/platform gaps.

## Verification and implementation outcome

- Retention regression failed on the original code. Both cleanup transport
  regressions failed before the correction. Final container/orchestration suite:
  276 tests passed, including identity, uncertain cleanup and foreground controls.
- Provider close classification regression failed before its correction; seven
  classification/control cases and the complete 18-test Workers file passed.
  The 42-test Node relay suite also passed. One existing fixture now joins its
  final diagnostic writes; a public-safe Frog entry records that teardown bug.
  Two other existing image-denial fixtures still emit native teardown noise
  while passing; no production claim is inferred from that noise.
- Cloudflare typecheck passed after declared Prisma client generation.
- Docs drift and whitespace checks passed.
- Complexity guard passed: container debt 68 to 67, maximum 73 to 72;
  provider interceptor debt 20 to 20. The wake identity guard reuses the existing
  exact-operation matcher instead of duplicating its three identity checks.
- Product UX: internal Patch, Ready for scoped review. Exact healthy retention
  preserves its checkpoint; foreground still preempts it; stale/uncertain owners
  keep recovery; stopped containers are not restarted by observation; interrupted
  provider diagnostics do not change cancellation, recovery or delivery promises.
- Parent reviewed source, tests, documentation, privacy and compatibility.
  No assistant prompt, tool, reply or provider-input assembly changed.

Implementation is complete. Exact-head ReviewGPT, CI and protected production
release remain completion gates; their final receipts belong in the PR because
this completed implementation plan is immutable historical evidence.

Completed: 2026-09-18
