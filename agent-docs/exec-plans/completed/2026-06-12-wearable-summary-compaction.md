# Wearable summary projection compaction

## Goal

Shrink `query_wearable_summaries` in the rebuildable query projection
(`vault/.runtime/projections/query.sqlite`) by at least 45% by compacting the
stored `summary_json`, without changing the public summary JSON read output.

Success criteria:

- Stored rows omit empty metric envelopes and redundant constant/defaulted
  envelope fields; the read path resynthesizes the exact prior shape.
- Public read output is byte-equivalent to today's output, proven by a
  round-trip test on a rich fixture covering empty, direct, fallback, and
  conflicting envelopes.
- `QUERY_PROJECTION_SQLITE_VERSION` bumps 7 -> 8 so existing projections
  rebuild; no migration code.
- Measured `SUM(LENGTH(summary_json))` reduction reported per summary kind on
  a representative fixture (full year activity, ~216 days sleep + recovery).

## Constraints

- Stacks on branch `query-projection-drop-dead-columns` (PR #142); PR base is
  that branch.
- Keep the codec one coherent seam in `packages/query/src/projection`; no
  speculative encoding layers; stay plain JSON for debuggability.
- Read equivalence is gated by byte-identity checks: only omit what the read
  path provably resynthesizes to the same bytes.

## Approach

1. Add a stored wearable summary codec next to the existing public-json
   helpers: write side replaces byte-identical empty metric envelopes with
   `null` markers and drops constant/derivable envelope fields; read side
   rebuilds the canonical envelope shape and key order.
2. Wire the projector write path and the compose read path through the codec.
3. Bump `QUERY_PROJECTION_SQLITE_VERSION` to 8.
4. Round-trip equivalence tests plus before/after size measurement on a
   representative fixture.

## State

Active.
Status: completed
Updated: 2026-06-12
Completed: 2026-06-12
