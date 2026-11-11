# Bound game reminder writes at maximum cardinality

Status: active
Created: 2026-11-11
Updated: 2026-11-11

## Outcome and scope

Outcome: saving game reminder choices completes at the admitted 1,000-ID limit.
Reaches: Settings and both game reminder tools through `saveGameReminders`.
Proof: real PostgreSQL 17 command, receipt replay, mixed choices, omitted cadence,
finished games, other actors, late seats, and activation/save contention.

Frog autofix issue: #4842. Only the existing reminder write owner and its proof
change. Transaction timeouts, admission, schema, deployment and review gates stay
with their current owners. This production database change requires human merge.

## Diagnosis and decision

The exact PostgreSQL 17 CI image reproduced the transaction expiry with synthetic
1,000-game input. PostgreSQL estimated one receipt row but read 1,000, choosing a
nested loop that repeated a large ID-list bitmap scan 1,000 times. The slow update
took about 25 seconds; the unchanged transaction budget is 15 seconds. There was
no lock wait or JIT compilation. Fresh fixture statistics alone did not fix it,
because new choice receipts enter inside the measured transaction.

Keep the ordered receipt insert and its game foreign-key locks. Replace four
partitioned writes with one parameterized update: use the existing live-game,
member and receipt predicates to admit rows, then derive both flags from the
input arrays in assignment expressions. Omitted cadence preserves its prior
value; an explicit empty array clears it. No new state or cached authority.

## Risks and proof

- Preserve live receipt authority for seats admitted after choice recording.
- Preserve independent off/daily choices, unrelated actors, and settled games.
- Preserve activation/save serialization, atomic rollback, and idempotent facts.
- Existing one/1,000-game query bound and single pool acquisition remain intact.
- Validate the exact PG17 before/after behavior, focused Web tests/typecheck,
  changelog rendering, complexity, parent review, required CI. The user opted out of external ReviewGPT for this run; the parent owns final review.
- No schema or protocol change: old/new Web versions share identical row meaning;
  normal Web rollout is sufficient and rollback restores the previous query.

## Progress

- Root cause reproduced and parent reviewed the proposed dataflow.
- Source correction and focused regression cases implemented. Fresh PostgreSQL 17
  private-activation and reminder suites passed 43 cases; the additional late-seat
  regression and unchanged 1,000-game proof passed in a focused follow-up.
- The candidate uses seven datastore round trips and one pool acquisition for both
  one and 1,000 games. The measured bulk update fell from 24.7 seconds to
  0.4–0.6 seconds; aggregate database time was 2.55 seconds on first save and
  1.35 seconds on replay in the bounded local diagnostic runtime.
- Focused command/eligibility tests passed 38 cases (one opt-in case unselected).
  Web typecheck and source complexity checks passed.
- Changelog, PR, parent final review and exact-head checks pending; no merge or deployment authority.
