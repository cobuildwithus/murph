# Reduce oversized hosted cold archives

Status: active
Created: 2026-08-20
Updated: 2026-08-20

## Goal

- Prevent terminal assistant delivery artifacts from inflating every hosted
  cold checkpoint while preserving active approval, retry, and delivery
  continuity.
- Re-evaluate the query-projection SQLite snapshot exception with measured
  compressed-size and foreground-latency evidence.
- Keep the checkpoint architecture explicit, composable, and minimal.

## Success criteria

- The supplied extreme workspace no longer carries completed generated-delivery
  payloads in its quiescent cold archive.
- Active generated deliveries still survive checkpoint and restore until their
  terminal state is durably established.
- The root cause is proved across generated-file creation, outbox transition,
  quiescence, cleanup, archive planning, and production-shaped checkpointing.
- The SQLite exception is retained, narrowed, or removed from evidence rather
  than raw file size alone, with no new foreground contention owner.
- Focused tests, affected package typechecks, ReviewGPT gates, and required PR
  CI pass on the exact pushed head.

## Scope

- In scope: assistant generated-delivery residue, outbox terminal-state
  semantics, hosted checkpoint cleanup and archive inclusion, query projection
  snapshot/restore policy, aggregate size/latency proof, focused docs and tests.
- Out of scope: deleting canonical ledger or raw health evidence, redesigning
  delivery, adding another lifecycle manager, changing encryption, or creating
  a second cache/freshness owner.

## Constraints

- Canonical vault history remains the authority; runtime projections remain
  disposable and freshness-validated.
- Active one-time delivery files remain portable until approval, retry, and
  confirmation obligations are terminal.
- Checkpoint work stays bounded and lower priority than foreground replies.
- Private vault contents and production rows remain local, aggregate-only
  evidence and never enter commits, docs, tests, or PR text.
- Prefer deletion, ordering, and existing owner boundaries over new state or
  abstractions.

## Product UX

- Effort: Patch.
- Outcome: a member keeps the same reliable generated-file delivery while
  later cold starts stop carrying already-completed delivery payloads.
- Reaches: existing hosted members after a generated file is delivered and the
  workspace checkpoints, cold-restores, or is replaced; pending approval and
  retry journeys stay unchanged.
- Proof: a production-shaped externalized-file checkpoint retains the active
  payload, removes the terminal payload, and produces a smaller archive without
  changing delivery state.

## Tasks

1. Send the private workspace and current repository to ReviewGPT for an
   architecture, simplicity, and bug-hunt audit with a focused patch request.
2. Prove why a terminal generated-delivery payload can remain in production
   snapshots despite the current cleanup function deleting it in isolation.
3. Measure archive contributions and query projection rebuild/read tradeoffs on
   the supplied workspace using aggregate-only output.
4. Implement the smallest invariant-preserving correction and focused
   regression coverage.
5. Update the durable snapshot/runtime contract only where behavior changes.
6. Run focused verification, parent review, PR CI, preliminary specialist
   ReviewGPT, final ReviewGPT, and any required remediation rounds.

## Risks and mitigations

1. Risk: eager cleanup loses a file whose provider delivery is still uncertain.
   Mitigation: derive retention from durable outbox obligation state and test
   approval, sending, retryable, and confirmation-pending cases.
2. Risk: removing SQLite restores multi-second query rebuild latency.
   Mitigation: compare compressed transport cost with measured cold-query cost;
   keep the existing exception unless a simpler non-contending rebuild path is
   proved.
3. Risk: background rebuild competes with model startup on one vCPU.
   Mitigation: do not add opportunistic parallel work without direct scheduling
   and foreground-latency proof.
4. Risk: cleanup and archive planning observe different runtime states.
   Mitigation: preserve one quiescent checkpoint boundary and make archive
   inclusion fail safe for live obligations.

## Verification

- Focused assistant residue, runtime-state bundle, snapshot bridge, and restore
  tests for terminal versus active generated-delivery files.
- Affected workspace package typechecks.
- Aggregate-only replay of the supplied workspace before and after the change.
- Exact pushed-head GitHub Actions plus required preliminary and final
  ReviewGPT passes.

## Decisions

- Root cause proved locally and against aggregate production evidence: legacy
  skipped-inline files are materialized after quiescent residue cleanup, so a
  cold-restored terminal generated-delivery file is absent when cleanup scans
  and is reintroduced immediately before archive planning.
- Preserve runtime-owned operator-home symlink pruning before materialization;
  only the state-aware cleanup that requires a complete physical inventory
  moves after materialization.
- Retain the query SQLite snapshot exception unless ReviewGPT produces stronger
  evidence. Its compressed checkpoint cost is materially smaller than its raw
  size, while the original one-vCPU measurement avoids a multi-second cold
  foreground query rebuild. Do not add an eager competing rebuild owner.
