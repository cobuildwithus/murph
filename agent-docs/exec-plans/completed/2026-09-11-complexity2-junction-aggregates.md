# Simplify Junction daily and temporal aggregation

Status: completed
Created: 2026-09-11
Updated: 2026-09-11

## Goal

Reduce repeated source/day identity and accumulation logic in Junction daily normalization while preserving canonical facts, temporal facets, and accepted-provider-record receipts.

## Success criteria

- Shared source/day keys, aggregate initialization, and count/sum/clock accumulation have one private implementation.
- Provider-day facts and authorized vault-day temporal facets retain their separate authority, bounds, and publication behavior.
- Focused Junction importer regressions, importer typecheck, and complexity guard pass with lower debt and maximum complexity.

## Scope

Only the importer Junction daily-aggregation seam and focused proof. Device provider execution, Core writes, schema, policy, dependencies, and persisted state remain unchanged.

## Protected invariants

Preserve source/provider instance identity, normalization and diagnostic precedence, units, floating and explicit clocks, dense revision selection, sparse selected-row admission, dedupe counts, provider day versus vault day, stable receipts, authoritative empty sets, input/output caps, and ordinary-empty no-tombstone behavior. The accepted-provider-record counter must continue using the same parser as canonical daily facts.

## Design

Derive dense/sparse resource classification once. Reuse one source/day key, aggregate seed, and sample count/sum/clock updater; retain daily sum-square and extrema behavior and temporal extrema semantics explicitly. Give temporal accumulation and capped publication named private boundaries within the same owner. Do not introduce a generic aggregation framework or shared mutable policy state.

## Verification

Run the focused Junction importer suites with one worker, importer typecheck, and cyclomatic diff against the task base. Existing core-backed tests cover replay, offset and floating day ownership, strict source-day rejection, exact duplicates, stable revisions, sparse corrections, temporal caps, and canonical output. Also run scenario-manifest integrity; exact-head integration CI remains parent-owned.

## Completion

Implemented shared source/day identity, aggregate seed, and count/sum/clock accumulation, with resource classification derived once. Temporal collection and capped publication retain their original owner and order. Daily initial sums and extrema remain distinct from temporal extrema to preserve numeric behavior. An over-cap throw cannot expose partial accumulators because both maps remain local until post-loop publication.

- Focused Junction normalization, activity-resource, missing-resource, and snapshot-validation suites pass with one worker.
- Importer typecheck passes.
- Scenario integrity passes: 205 scenarios, 12 sample inputs, and 29 golden-output directories.
- Cyclomatic diff passes against task base: file debt 153 to 129; maximum/function complexity 98 to 74. All added helpers are at or below 20. Remaining normalization/revision branches and unrelated resource hotspots retain their established owners; further broad decomposition is outside this shared-aggregation seam.
- Diff whitespace and privacy inspection pass. No new dependency, public API, persisted representation, or product behavior.

Parent owns final candidate review, Ready admission, required CI, ReviewGPT, and merge.
Completed: 2026-09-11
