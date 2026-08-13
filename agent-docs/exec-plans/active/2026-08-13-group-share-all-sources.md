# Group Share All-Source Projections

## Goal

Preserve every bounded, available health-data observation in group-share
projections and attach a public source tag to each observation, without
changing permission choices, consent authority, or member-facing share flows.

## Success criteria

- Every group health-share scope that can contain multiple provider
  observations returns all of them instead of choosing one provider winner.
- Source tags use the existing public provider identity boundary and never
  expose provider account identifiers or raw vendor payloads.
- Existing group-share permissions, activation generations, encrypted snapshot
  ownership, retention, and revocation behavior remain unchanged.
- Already-persisted snapshots and rolling Web/runtime deploy skew remain safe
  and readable while new projections move to the all-source contract.
- Projection work remains bounded by the existing lookback, record, source,
  and encrypted snapshot limits; no table, queue, cache, or second projector is
  introduced.
- Focused tests prove multiple sources survive projection for daily metrics,
  sleep, workouts, and every other source-bearing group-share shape.

## Constraints and decisions

- Keep permission kinds and member-facing copy unchanged.
- Keep source provenance explicit in the shared value shape; downstream
  condensation is deliberately outside this change.
- Reuse the current vault-share snapshot and public source-label owners.
- Treat old persisted projection shapes as a real rollout boundary, not as a
  reason to keep selecting a preferred source in newly projected data.
- Do not encode private production evidence or member identifiers in source,
  tests, docs, changelog copy, or review artifacts.

## Work

1. Inventory every projection scope, source-bearing read path, parser, and
   group consumer; confirm payload and database-load bounds.
2. Ask ReviewGPT for a minimal cross-scope architecture and patch, then inspect
   each proposed hunk against repository ownership and simplicity rules.
3. Implement the accepted all-source contract, projection reads, consumer
   rendering, focused coverage, durable contract docs, and changelog entry.
4. Run focused tests, affected typechecks, privacy/diff checks, and direct
   multi-source projection proofs.
5. Commit and push the candidate, open the PR, then run the preliminary
   completion-specialists ReviewGPT pass and final full-patch ReviewGPT gate in
   parallel with required CI on the exact pushed head.
6. Resolve accepted findings, repeat exact-head review when required, prove
   current-base mergeability, archive this plan with `scripts/finish-task`, and
   hand off the merge-ready PR.

## Evidence

- Pending.
