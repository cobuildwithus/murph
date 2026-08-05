# Usage-Denied Reply-Latency Alert Exclusion

## Goal

Keep reply-latency operator email alerts focused on execution failures by
excluding Linq ingress traces that the existing AI usage gate intentionally
blocked.

## Constraints

- Reuse the existing Web-owned usage gate and mailbox work record; do not add
  another billing decision, table, queue, or scheduler.
- Cover both authoritative denial boundaries because the direct wake may reach
  mailbox fetch before Temporal reconciliation observes the same denial.
- Mark only fresh, unconsumed conversation traces inside the observed
  import/consume replay-floor and conversation-high-water window.
- Keep the diagnostic write best-effort and outside user-visible reply
  ownership.
- Preserve invalid or missing marker data as alertable.

## Plan

1. Add one assign-once usage-denial timestamp to the existing mailbox item.
2. Add one database-timed bounded Web store update for fresh unconsumed
   conversation rows.
3. Invoke that update immediately after authoritative mailbox-fetch or mutating
   reconciliation denial, before fallible notice delivery and without changing
   gate behavior.
4. Exclude valid marked rows before the bounded latency read and grouping so
   mixed deliveries retain alert coverage for unblocked rows.
5. Add focused store, denial-boundary, migration, monitor, and opt-in
   PostgreSQL snapshot regressions.
6. Run scoped tests and typechecks, complete the required reviews, and finish
   through the PR lane.

## Verification

- Focused hosted-execution runtime-control tests
- Focused hosted-Web latency store, monitor, internal-route, and reconciliation
  tests
- Relevant package and app typechecks
- Required preliminary specialist and final ReviewGPT gates
- Required GitHub Actions on the exact PR head

## State

Implementation and local validation complete; exact-head PR gates follow the
plan-closing commit.

- The denial fact is stored on the mailbox item rather than the latency trace so
  direct-wake denial cannot race the trace's intentional post-response creation.
- Both authoritative denial boundaries reuse one assign-once mailbox update.
- Preliminary ReviewGPT identified three accepted gaps: an unbounded
  post-snapshot write, notice failure preceding the marker, and truncation
  before valid-denial exclusion.
- The marker now uses database UTC time, the exact observed sequence window,
  and precedes notice delivery. The monitor applies its existing cap to the
  alertable population in one query while preserving impossible chronology.
- Focused Web tests pass (212 passed, 1 opt-in skipped); the opt-in real
  PostgreSQL snapshot proof passes separately. Prisma validation, Web
  typecheck, scoped lint, privacy scan, and diff checks pass. Exact-head CI and
  final ReviewGPT remain as the PR merge-readiness gates.
Status: completed
Updated: 2026-07-30
Completed: 2026-07-30
