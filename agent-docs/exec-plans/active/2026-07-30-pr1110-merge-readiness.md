# Prepare PR 1110 for merge

Status: active
Created: 2026-07-30
Updated: 2026-07-30

## Goal

- Make PR #1110 safe to merge so a terminal HTTPS URL sent over Linq renders as
  a native link preview without duplicating an already accepted reply after a
  partial delivery or runner restart.

## Success criteria

- The branch contains current `origin/main` and merges cleanly.
- A failed rich-link follow-up stamps the exact answered mailbox rows consumed
  once the primary provider request has been accepted.
- Uppercase HTTPS schemes receive the same native-preview behavior as lowercase
  schemes.
- Focused Web, runtime, operator-config, contract, migration, and type checks
  pass.
- Required product, preliminary specialist, parent, final ReviewGPT, and
  exact-head CI gates have no unresolved accepted findings.
- The final worktree is clean and matches the pushed PR head.

## Scope

- In scope: PR #1110 conflict reconciliation, partial-delivery replay safety,
  HTTPS parsing consistency, focused proof, PR description refresh, and required
  merge-readiness gates.
- Out of scope: broader Linq delivery refactors, new retry owners, unrelated
  line-health behavior, and unrelated active work on `main`.

## Constraints

- Technical constraints: preserve current main's later Linq line-health,
  recovery, runtime callback, migration, and bundle-budget behavior; keep Web
  and Cloudflare rollout compatibility explicit; reuse the existing mailbox
  consumption owner and rich-link partial failure code.
- Product/process constraints: preserve the open PR worktree, use focused local
  proof plus exact-head CI, run the required ReviewGPT sequence, and do not
  expose private identifiers or provider data.

## Risks and mitigations

1. Risk: conflict resolution could silently drop newer delivery or recovery
   behavior from `main`.
   Mitigation: merge current `origin/main`, inspect every conflict against both
   parents, and run focused owner tests for each reconciled surface.
2. Risk: treating a partial delivery as consumed could suppress a reply that
   never reached the provider.
   Mitigation: allow consumption only for the typed post-primary rich-link
   partial outcome, whose transport contract proves provider entry and disables
   automatic replay.
3. Risk: two provider message identities could diverge from the single logical
   delivery lifecycle.
   Mitigation: retain the existing child-message aggregation and PostgreSQL
   receipt-ordering proof; change only the exact mailbox stamp condition.

## Tasks

1. Merge current `origin/main` and resolve the five known conflict surfaces.
2. Add failing regression proof for partial-delivery mailbox consumption and
   uppercase HTTPS splitting, then implement the smallest owner-level fixes.
3. Run focused verification and a direct crash/replay state-transition proof.
4. Run product experience and preliminary specialist review; resolve findings
   and perform the parent final review.
5. Finish the plan, push the final candidate, run final ReviewGPT concurrently
   with exact-head CI, and execute merge-readiness preflight.

## Decisions

- Keep the existing multipart delivery table and aggregation; the missing
  mailbox stamp is a condition bug, not evidence for another state owner.
- Treat the current PR as stale but not superseded; later main changes must be
  preserved during reconciliation.
- Preserve generic failed-outcome behavior: only the exact typed
  `ASSISTANT_LINQ_RICH_LINK_PARTIAL_DELIVERY` outcome may carry answered mailbox
  identities through the signed callback and consume them at `failedAt`.
- Treat that typed partial as provider-accepted for the existing synchronous
  outcome-write gate whenever it carries answered mailbox identities. A
  best-effort callback cannot close the interruption window because checkpoint
  or container loss may occur before Web stores the consume stamp.
- Continue the existing PR after its prior five-round ReviewGPT pass because
  the merge-readiness audit found two narrow correctness gaps and the requested
  outcome remains cohesive; record the round-cap retrospective before the next
  final-gate run rather than resetting the immutable first-reviewed baseline.

## Verification

- Commands to run: focused Vitest suites for contracts, Web Linq transport and
  delivery route/store, operator-config Linq runtime, assistant runtime/outbox,
  Prisma migration proof, relevant typechecks, `git diff --check`, PR conflict
  proof, exact-head GitHub Actions, ReviewGPT gates, and final PR-head preflight.
- Expected outcomes: all focused and required checks pass; typed partial
  delivery consumes only its exact answered rows; ordinary failed delivery does
  not; uppercase HTTPS links split into native link parts; no merge conflicts or
  unresolved accepted review findings remain.

## Evidence so far

- Merged current `origin/main` and resolved all five conflicts while retaining
  newer line-health, group recovery, migration-order, and runner-budget changes.
- Proved the two gaps with failing focused tests before implementation.
- Passed 357 relevant runtime/package tests, 376 focused Web tests, 25
  production-faithful PostgreSQL partial-delivery tests, and 34 Cloudflare
  bundle-entrypoint tests.
- Passed typechecks for Web, Cloudflare, contracts, assistant engine, assistant
  runtime, and operator config.
- Assembled the complete runner bundle successfully within all entrypoint,
  static-closure, and total-size budgets.
- Product review found one material replay gap in the best-effort partial
  callback. The corrected branch now waits for the existing required writer;
  focused tests prove both pending-write ordering and callback-failure
  propagation before the delivery can settle.
