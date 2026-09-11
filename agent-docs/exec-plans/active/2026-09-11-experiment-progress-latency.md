# Reduce experiment progress query latency

Status: active
Created: 2026-09-11

## Outcome and invariant

Progress and progress cards should read current evidence without rebuilding
unrelated search indexes. Preserve metric selection, projection privacy,
anchors, adherence, corrections, and sparse-data behavior.

## Owners and scope

Query owns a request-local canonical snapshot and lazy metric projection.
Vault usecases retain lookup, metric requirements, errors, and result envelopes.
Canonical writes and ordinary SQLite/search remain unchanged. Skip schema
validation only for absent origin metadata and reuse candidate-base parsing.
No new persisted cache, TTL, scheduler, dependency, or provider-input change.
Per-day wearable selection remains unchanged; its provenance equivalence does
not need to be redesigned for the measured improvement.

## Product UX patch

- Outcome: faster progress answers with current evidence and unchanged meaning.
- Reaches: progress, cards, reminder readback; sparse, rich, anchored, corrected,
  and legacy-origin evidence.
- Proof: composed usecases, direct/SQLite parity, current-write readback, no
  query-cache creation, synthetic baseline/candidate timing and result hashes.

## Work

1. Add absent-origin fast return and reuse candidate-base origin parsing.
2. Add a query-owned snapshot reader for progress/card reads, retaining metric
   filtering, ordering, limits, and stored provenance projection.
3. Add parity and readback tests; run focused suites, builds, typechecks, and
   a synthetic benchmark against the baseline.
4. Update architecture and changelog, review complexity and the full diff,
   commit and open the PR, then run external review concurrently with CI.

## Risks

Direct raw metrics carry more provenance: reuse stored payload normalization
and prove complete point parity. Measure warm and post-write paths because
source reads can cost more than a fresh index. Keep metrics lazy when unneeded.
Capture canonical source files under the existing reentrant write lock so
concurrent persistence or rollback finishes first; release before analysis.
Reuse the same loaded evidence for the model and metrics. Each new request rereads writes.

## Status

Implementation and parent candidate review complete. Query: 102 focused tests;
vault usecases: 37; changelog: 10. Query and vault-usecases builds/typechecks and
Web typecheck passed. Complexity guard passed with no increased debt; existing
hotspots retain their branches. Cross-process commit/rollback and reentrant
reader tests preserve write ordering. Synthetic benchmark output hashes match
at base and candidate; methodology and timing live in the benchmark README.

Product UX: Ready for progress, cards, sparse/anchored evidence, correction and
deletion readback, and reminder progress reuse. Provider input and result
contracts are unchanged; no stochastic model journey is needed for the timing
change. Parent review retained the existing canonical write lock for capture
and releases it before metric analysis. No new state or authority owner.

PR publication, exact-head CI, and required external review remain the
completion steps. No production deployment.
