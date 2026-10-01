# Container CPU efficiency

Status: completed

## Outcome and scope

Reduce measured CPU work in container bootstrap and device imports so a future
one-vCPU deployment can preserve responsiveness. Production sizing remains
unchanged. Mailbox, scheduling, orchestration, and wake ownership are excluded
because another task owns those surfaces.

Production aggregate timing diagnostics identify canonical writes and event
identity preparation as import hotspots. Private rows and payloads stay out of
this plan and all benchmark fixtures.

## Architecture and invariants

Optimize the existing core/importer and bundle owners. Prefer removing repeated
work, bounded batching, and invocation-local derivation over new state owners,
dependencies, background processes, or caches with independent invalidation.
Preserve canonical-write locks, atomicity, crash recovery, deduplication,
version ordering, corrections, retractions, and exact imported data.

## Product UX patch

- Outcome: preserve current imported data and responsiveness with less CPU work.
- Reaches: initial backfills, incremental updates, repeated imports, and cold
  container starts; foreground scheduling and messaging remain unchanged.
- Proof: synthetic production-path Docker reproduction at one and two vCPUs,
  canonical readback, focused regression tests, and affected typechecks/builds.

## Work

1. Trace aggregate production latency to existing owners and inspect overlap.
2. Create a bounded synthetic Docker benchmark; capture unmodified baselines
   and CPU profiles using the same filesystem and resource limits.
3. Implement only profile-supported simplifications and prove data equivalence.
4. Repeat the same benchmark at one and two vCPUs; inspect bootstrap separately
   without moving latency from readiness into first useful work.
5. Run focused proof, parent review, scoped commit, draft PR, and required
   exact-head CI and final ReviewGPT. Record limits of local-to-production proof.

## Progress

- Created an isolated task branch from current main.
- Docker is available. Existing native runner base images can support local
  synthetic benchmarking without production credentials.
- Read aggregate import timings from the runtime-log database and cold-start
  timings from the primary latency diagnostics store. Cloudflare CLI
  authentication is unavailable, but the database owners provide direct phase
  evidence without production secret access.
- Docker CPU profiles proved repeated ICU timezone validation dominates the
  synthetic history scan. Reuse up to 64 successful explicit-zone resolutions
  at the existing contracts owner, clearing on overflow. Mixed-zone Docker
  evidence showed why retaining only the last result was insufficient. This
  immutable process-local derivation introduces no independent invalidation
  or persisted state.
- Three unprofiled alternating runs at the original two-vCPU quota versus the
  candidate one-vCPU quota preserved semantic hashes and canonical readback.
  Initial-import and history-scan medians improved substantially; small
  cache-hit operations remain noisy. Details and reproduction live in
  `packages/core/bench/README.md`; these emulated measurements do not approve
  production downsizing.
- Focused contracts tests (21), core import tests (239), importer tests (258), contracts/core
  typechecks, and the complexity guard passed. The guard's existing timestamp
  parser hotspots are unchanged and unrelated to the measured redundant ICU
  work; rewriting them is not justified.
- Full runner assembly passed. The assembled entrypoint reached listen,
  healthy heavy-runtime hydration, and clean shutdown in network-disabled
  Docker at both CPU quotas. Whitespace minification reduced bytes but did not
  reliably improve hydration, so it was rejected. Existing hydration,
  durability, scheduling, and admission owners remain untouched.
- Final scoped tests, typechecks, full runner assembly, minimum-size Docker
  import, and final-artifact startup/hydration checks passed after the bounded
  mixed-zone update. The final startup pair remained slower at one vCPU; do
  not change production sizing based on the faster import benchmark alone.
- Parent review preserved the narrow contracts owner, bounded retained data,
  native alias/DST semantics, and unchanged durability boundaries. No new
  repository-actionable Frog friction was encountered. Changelog disposition:
  internal CPU-efficiency work; no changed cadence or end-to-end speed promise.
- Required exact-head CI and final ReviewGPT remain external PR gates. No
  merge, deployment, or production resource change is included.

## Deployment

No production resource or orchestration settings will change in this task.
Reassess compatibility and rollout evidence for the final implementation.
Updated: 2026-09-04
Completed: 2026-09-04
