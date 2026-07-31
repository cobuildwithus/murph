# Close PR 1110 retry and group-status gaps

Status: completed
Created: 2026-07-30
Updated: 2026-07-30

## Goal

- Preserve rich-link recovery through repeated ambiguous attempts and keep
  two-part group deliveries out of direct-message missing-receipt warnings.

## Success criteria

- A one-identity rich-link checkpoint remains non-confirmable across later
  ambiguous failures until a normal success returns both ordered identities.
- A successful primary response without an identity cannot advance to the link
  request or create a link-only recovery checkpoint.
- New and recovered two-part group deliveries retain
  `sent_no_receipt_expected` while their children remain nonterminal.
- Focused retry, callback-failure, adapter, persistence, receipt, latency, and
  hosted-local proofs pass before the next exact-head review.

## Scope

- In scope: assistant outbox failure transitions, both Linq adapters, Web
  delivery aggregation, focused tests, delivery documentation, PR evidence,
  and merge-readiness gates.
- Out of scope: new queues or state owners, generic delivery confirmation
  semantics, receipt-policy redesign, or unrelated Linq lifecycle changes.

## Risks and mitigations

1. Risk: preserving non-confirmability could suppress legitimate completion.
   Mitigation: limit the sticky rule to a carried one-identity Linq checkpoint;
   the ordinary successful two-identity result remains the completion path.
2. Risk: retrying a primary response without an identity could duplicate text.
   Mitigation: reuse the existing deterministic primary key and do not issue the
   link request until the primary identity is proven.
3. Risk: preserving group status could hide real child failure or delivery.
   Mitigation: preserve only the nonterminal `accepted` aggregate; continue to
   advance the parent to `failed` or `delivered` from child receipts.

## Tasks

1. [x] Add failing tests for repeated ambiguous retries, callback failure,
   identity-less primary acceptance, and group aggregate status.
2. [x] Implement the smallest transition and adapter corrections.
3. [x] Run focused package, database, latency, hosted-local, typecheck, lint,
   and diff proof.
4. [x] Prepare the exact correction candidate. Push, PR evidence refresh, the
   next exact-head final review, CI, and PR-head preflight remain post-plan gates.

## Decisions

- Accept both final ReviewGPT round 7 findings as production-reachable.
- Keep the non-confirmability bit sticky in the existing outbox state owner.
- Require a known primary provider identity before sending the rich-link part.
- Preserve the existing group no-receipt status only for a recomputed accepted
  aggregate; do not weaken terminal child outcomes.

## Verification

- Assistant outbox runtime, hosted callback, Web Linq adapter/store/route,
  PostgreSQL delivery lifecycle, hosted-runtime latency, and hosted-local Linq
  journey tests.
- Relevant package typechecks, targeted lint, `git diff --check`, exact-head
  GitHub Actions, final ReviewGPT correction round, and PR-head preflight.

## Evidence

- Reproduced the stale one-identity promotion with two failing outbox cases,
  then passed all 81 outbox runtime tests across ambiguous primary replay and
  required accepted-callback failure.
- Passed all 43 operator Linq adapter tests and 48 Web Linq HTTP tests,
  including identity-less primary responses that never issue the link and a
  same-key primary retry that returns both ordered identities.
- Passed 124 Web observability-store tests plus 26 isolated PostgreSQL cases;
  new and recovered two-part group sends retain `sent_no_receipt_expected`,
  while mixed child receipts still advance the parent to failed or delivered.
- Passed 209 hosted runtime callback tests and 225 focused Web HTTP, delivery,
  route, persistence, and latency tests.
- Passed assistant engine, operator config, assistant runtime, Web, and
  Cloudflare typechecks, targeted Web ESLint, and `git diff --check`.
- Rebuilt the complete runner bundle: the vault CLI remained under its 9 MB
  budget, entry and static closure stayed within their existing tolerances, and
  the measured 9,974,019-byte total passed the ratcheted total budget.
- Passed the hosted-local Linq first-contact journey with ten scenarios green,
  including restart recovery and no late replay.

Completed: 2026-07-30
Completed: 2026-07-30
