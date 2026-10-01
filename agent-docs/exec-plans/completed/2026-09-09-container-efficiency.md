# Measure and reduce hosted runtime resource demand for smaller containers

Status: completed
Created: 2026-09-09
Updated: 2026-09-09

## Goal

Measure the message-latency and resource risks of a 1-vCPU, 3-GiB hosted runner, remove demonstrated unnecessary work, and produce a reproducible sizing decision.

## Success criteria

- Inspect bounded production timing and lifecycle aggregates and available native resource telemetry; distinguish observations from missing evidence.
- Run packaged hydration and real synthetic import/restore workloads in Docker at 2 vCPU / 6 GiB and 1 vCPU / 3 GiB, without swap.
- Cover foreground preparation and background competition where meaningful proof is possible.
- Preserve canonical writes, foreground priority, checkpoint authentication, process ownership, and delivery authority.
- Validate retained optimizations with focused correctness tests, relevant typecheck, and matched measurements.
- Report remaining native AMD64 and hosted canary requirements.

## Scope

Read-only production diagnostics, synthetic Docker workloads, profiling, measured work elimination, sizing documentation, and focused proof. Production rollout, production mutations, external messages, and secret-dependent local work are outside the current implementation.

## Constraints

- Baseline checkout: 58acfe349f. Original local main is older.
- Keep private rows, identifiers, screenshots, secrets, and host paths out of artifacts.
- One agent owns Docker timing runs; no overlapping task builds or benchmark containers.
- Docker host is ARM; AMD64 emulation cannot certify production latency.
- Reuse existing owners; do not introduce a scheduler or parallel state owner.

## Risks and mitigations

1. CPU bursts and background work may delay messages. Measure phase timing and contention while preserving preemption.
2. Memory includes Codex, children, and page cache. Capture cgroup peak/current memory and OOM events where available.
3. CPU allocation is not CPU billing. Separate RAM duration, actual CPU work, standby, and churn.
4. Synthetic tests omit external provider latency and production image loading. Scope claims and retain hosted validation as an explicit gap.

## Tasks

1. Inspect production telemetry and current lifecycle/cost owners.
2. Prepare actual runner image and reproducible Docker quota matrix.
3. Audit and reproduce foreground and background waste; profile the measured multi-second identity-index work at 50,000 events.
4. Retain demonstrated maintainable optimizations and regression proof.
5. Review changes, document results, run relevant verification, and create a scoped commit.

## Decisions

- Existing one-vCPU CI retains 6 GiB and does not establish 3-GiB headroom.
- Production sizing stays unchanged during investigation.
- Committed measurements use synthetic evidence only; production evidence is summarized privately.
- Retain measured ledger/index/query allocation savings and direct archive piping.
- Propagate the existing device-sync job signal through import preparation and
  yield during index scans. Abort only before canonical publication; committed
  progress keeps the existing acknowledgement and retry owner.
- Preserve the query SQLite snapshot cache: repeated rebuilds are expensive,
  and the measured fixtures do not demonstrate freelist bloat.
- Reject tool-fingerprint caching: small measured benefit does not justify
  changing the current mutable-catalog contract.
- Matched follow-up isolated a throughput cost from frequent native yielding.
  Removing periodic RSS sampling did not eliminate it. Evaluated coarser
  bounded cadences with both CPU and timer/lock-release proof before selecting
  the final interruption implementation.
- Both coarser-cadence candidates were rejected: visitor throughput did not
  improve and timer lag increased; index-only results were mixed. Retain the
  measured 256-unit cadence and document its throughput/preemption tradeoff,
  including both warmed and cold-seeded cancellation timings.
- This task produces a local reviewed candidate and scoped commit. No PR is
  opened or deployment performed; final ReviewGPT and exact-head CI apply when
  the candidate enters the PR lane. A member-facing release note must accompany
  a shipping PR once its final scope and evidence are established.

## Verification

Existing packaged hydration and canonical device-import assertions; authenticated encrypted restore and content readback; focused optimization correctness tests; relevant owner typechecks; complexity and privacy review; documentation checks. Apply the completion owner's final review route to retained hosted runtime changes. CI and deployment remain separate evidence.

Parent review: The complexity guard passes the new benchmarks after separating
context measurement from semantic verification. It still reports core mutation
debt 371 to 376, with the existing maximum unchanged at 135. The five added
branches are explicit cancellation/error-preservation/publication boundaries in
an existing large function. Retain those visible checks rather than introducing
helpers solely to move the score; no threshold or waiver was changed. This is a
reported guard failure, not a green check.

## Product UX patch plan

- Outcome: Reduce unnecessary runtime work while preserving message meaning, delivery, canonical state and query results.
- Reaches: Private follow-up preparation, canonical import history, and authenticated workspace archive work when a measured optimization is retained.
- Proof: Identical semantic hashes and canonical readback, focused failure/cancellation tests, and paired CPU/RAM measurements. Production latency remains Hold until native and hosted validation.

## Outcome and handoff

- Retained five small improvements: bounded ledger decoding, lower identity-index
  allocation, single-pass automation document parsing, direct tar-to-compressor
  piping, and foreground cancellation through sync preparation.
- Preserved canonical publication, replay identity, validated query results,
  snapshot authentication, and exact child cleanup in focused proof.
- Added maintained synthetic import, context, query, archive-creation, and
  resource-probe entrypoints. All production evidence remains outside committed
  artifacts; the sizing report contains synthetic measurements only.
- Measured unresolved query rebuilds near ten seconds at one CPU and large
  restore memory near the proposed limit. Preserve the current production shape
  pending native AMD64 and protected hosted latency/memory proof.
- Owner tests/typechecks, documentation drift, whitespace, and privacy checks
  passed. The intentional complexity-guard failure is explained above and in
  `packages/core/bench/container-sizing.md`; PR CI and external review have not
  run in this local investigation.
Completed: 2026-09-09
