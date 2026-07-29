# Simplify group newsletter statistics and delivery settlement

Status: completed
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
- Preliminary specialist ReviewGPT found that parent acceptance needed to reach
  cron before provider completion, that this boundary needed a real
  notification integration test, and that the empty-stat explanation needed
  one categorical rule. All three findings are addressed: the existing
  callback now reports acceptance immediately, cron gives that durable pending
  state precedence over later turn errors while retaining the error on the run,
  the integration test covers successful, malformed, and terminal provider
  outcomes after a real prepare/send pair, and prompt plus skill guidance agree
  that sync and permissions are never inferred.
- The downloaded specialist coverage patch was test-only, applied manually
  after a clean applicability check, and expanded to cover the two
  post-acceptance error paths.
- The remediation's five focused test files pass with 250 tests, assistant
  typecheck passes, and the diff is whitespace-clean.
- The real pinned Codex App Server measurement on stable representative inputs
  leaves the Individual request unchanged. The final Group request is 20,220
  tokens and 90,134 bytes versus 20,170 tokens and 89,871 bytes at the base:
  +50 tokens (+0.25%) and +263 bytes (+0.29%). Transport-only
  `client_metadata`, `prompt_cache_key`, and HTTP headers are excluded; the
  temporary measurement harness was removed.
- The required product-experience rereview returned no findings after checking
  the immediate acceptance callback, post-acceptance error precedence,
  pre-acceptance retry, rolling-day summary, and categorical empty-stat rule.
  Remaining production-faithful gaps are an induced turn-persistence failure,
  the complete hosted cold/restart/backlog delivery chain, and live-model
  empty-stat copy.
- Documentation drift and the final focused suite pass. Exact-head CI, plan
  closure, and final ReviewGPT remain pending.
Completed: 2026-07-29
