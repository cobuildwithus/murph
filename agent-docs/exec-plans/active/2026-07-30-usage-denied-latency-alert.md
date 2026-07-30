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
- Mark only fresh, unconsumed conversation traces above the existing
  import/consume replay floor.
- Keep the diagnostic write best-effort and outside user-visible reply
  ownership.
- Preserve invalid or missing marker data as alertable.

## Plan

1. Add one assign-once usage-denial timestamp to the existing mailbox item.
2. Add one bounded Web store update for fresh unconsumed conversation rows.
3. Invoke that update after authoritative mailbox-fetch or mutating
   reconciliation denial, without changing gate behavior.
4. Exclude valid marked rows before latency grouping so mixed deliveries retain
   alert coverage for unblocked rows.
5. Add focused store, denial-boundary, phase-schema, and monitor regressions.
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

Review candidate prepared.

- The denial fact is stored on the mailbox item rather than the latency trace so
  direct-wake denial cannot race the trace's intentional post-response creation.
- Both authoritative denial boundaries reuse one assign-once mailbox update.
- The monitor filters valid denial facts per row before grouping and leaves
  impossible chronology alertable.
- Focused Web tests, Prisma validation, Web typecheck, and scoped source lint
  pass.
