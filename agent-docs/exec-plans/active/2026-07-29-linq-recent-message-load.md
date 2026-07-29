# Hosted Linq recent message load balancing

Status: active
Created: 2026-07-29
Updated: 2026-07-29

## Goal

- Route genuinely new Hosted Linq conversations toward the least recently busy
  eligible line, so a line carrying a high-volume group chat does not continue
  winning assignments merely because it started few new conversations today.
- Keep canonical delivery and provider-event ledgers as the only message-load
  owners; add no counter, bucket, queue, cache, or backfill lifecycle.

## Success criteria

- Automatic non-preferred line selection compares an exact trailing 168-hour
  inbound-plus-accepted-outbound effect count before today's proactive count.
- Sticky/preferred routes, health and egress eligibility, hard daily capacity,
  active-member target fallback, assignment weight, and stable tie-breaking
  preserve their current semantics.
- The aggregation is candidate-bounded, parameterized, supported by narrow
  partial indexes, and directly proven with PostgreSQL query-plan evidence.
- Focused unit and PostgreSQL tests, canonical diff verification, acceptance,
  preliminary specialist ReviewGPT, parent review, final ReviewGPT when
  eligible, CI, and mergeability proof are complete with no actionable finding.

## Scope

- In scope: Hosted Linq line-store read helper, shared chooser input and
  precedence, home-assignment and group-outreach callers, partial-index
  migration, focused tests, and the durable iMessage routing note.
- Out of scope: moving existing chats, burst shutdown, new persistent load
  projections, generalized balancing infrastructure, or guessed historical
  line attribution.

## Constraints

- Technical constraints: use server-owned timestamps and canonical dedupe
  owners; count only accepted outbound deliveries and admitted inbound message
  events already bound to candidate line keys; cap the query to the existing
  assignable candidate set.
- Product/process constraints: clean, simple, composable ownership with minimal
  complexity; privacy-safe observability only; preserve all product-critical
  onboarding and reply flows.

## Risks and mitigations

1. Risk: the aggregation adds latency while routing transactions hold locks.
   Mitigation: add covering partial indexes first, query only candidate keys and
   the 168-hour range, and verify the real PostgreSQL plan and focused timings.
2. Risk: outbound provider echoes or retries inflate the signal.
   Mitigation: count accepted delivery rows for outbound and only inbound
   `message.received` provider events; rely on their existing durable dedupe.
3. Risk: the new signal accidentally overrides sticky or hard-cap behavior.
   Mitigation: keep recent load solely inside the final automatic comparator and
   add precedence regression tests for both routing callers.

## Tasks

1. Trace canonical line identity, event, delivery, and chooser call paths.
2. Add the partial-index migration and bounded recent-effect query.
3. Thread the result through the shared selector and both automatic callers.
4. Add focused unit, store, integration, and PostgreSQL query-plan proof.
5. Update the durable deliverability routing note.
6. Run canonical verification, reviews, PR publication, CI, and mergeability.

## Decisions

- Derive an exact trailing 168-hour count from existing canonical ledgers.
- Count inbound and accepted outbound effects equally, with no group multiplier.
- Do not backfill because the source rows already contain the trailing window.

## Verification

- Commands to run: focused Vitest suites, PostgreSQL routing/store tests with
  `EXPLAIN`, Prisma validation/generation as required, `pnpm test:diff` for the
  touched owners, `pnpm verify:acceptance`, preliminary specialist ReviewGPT,
  parent diff review, applicable final ReviewGPT, CI, and merge-tree proof.
- Expected outcomes: exact metric and precedence behavior pass; PostgreSQL uses
  the new indexes on a bounded candidate query; no regression in sticky routing,
  health filters, daily caps, or group-outreach selection.
