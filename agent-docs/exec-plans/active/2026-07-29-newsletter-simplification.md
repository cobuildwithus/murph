# Simplify group newsletter statistics and delivery settlement

Status: active
Created: 2026-07-29
Updated: 2026-07-29

## Goal

- Make every scheduled group newsletter receive a useful, schedule-independent
  snapshot of the seven most recent completed local calendar days.
- Stop rerunning the model after the durable newsletter parent intent has been
  accepted by the existing outbox.
- Remove recipient-retry planning from the model turn and leave delivery retry
  ownership with the existing outbox.

## Success criteria

- Monday and non-Monday schedules return the available records from the seven
  completed local days immediately before the run.
- An accepted newsletter parent intent puts the cron occurrence into the
  existing `delivery_pending` state and the deterministic reconciler settles it
  without another model turn.
- Newsletter outbox code no longer scans or recreates recipient intents during
  a later model turn.
- Focused tests, typecheck, preliminary specialist review, exact-head CI, and
  final ReviewGPT pass for the PR head.

## Constraints

- Reuse the existing query, outbox, and cron owners; add no scheduler, queue,
  retry manager, or persisted state.
- Preserve Web-owned authorization and recipient fanout boundaries.
- Preserve one-shot newsletter preparation and send capabilities.
- Do not copy production identifiers or transcript wording into repository
  artifacts.

## Tasks

1. Replace the newsletter-only current-week aggregation with a rolling
   seven-completed-day aggregation and add Monday regression coverage.
2. Expose the accepted parent intent ID inside the assistant runtime and route
   it into the cron owner's existing pending-delivery state.
3. Delete model-turn recipient reconciliation and retry creation.
4. Align the newsletter skill and durable architecture/product/reliability
   documentation with the simplified ownership.
5. Run focused verification, required reviews, PR CI, and final ReviewGPT.

## Evidence

- A Monday run currently excludes Monday and begins its range on Monday, making
  the comparison window empty by construction even when prior completed days
  exist.
- The accepted parent intent is already durable, while cron currently converts
  that accepted result into a failed occurrence and reruns the entire model
  turn.
- Web already persists recipient fanout intents from the parent, and the generic
  outbox already owns bounded delivery retries.
- A direct Monday invocation of the production query builder returned exactly
  the preceding Monday-through-Sunday dates and excluded both the older Sunday
  and the open Monday.
- Focused query, newsletter outbox, cron, notification, skill, prompt, hosted
  fanout, and package typecheck checks pass. The local product-experience review
  returned no findings.
- Preliminary specialist ReviewGPT, exact-head CI, parent final review, plan
  closure, and final ReviewGPT remain pending.
