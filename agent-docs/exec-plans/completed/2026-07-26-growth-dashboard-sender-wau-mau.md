# Growth dashboard sender WAU and MAU

Status: completed
Created: 2026-07-26
Updated: 2026-07-27

## Goal

- Count distinct people who sent Murph at least one inbound message in rolling weekly and monthly windows, including the individual senders inside personal and group chats.

## Success criteria

- A person who messages Murph directly counts once per rolling window.
- Each distinct sender inside a Linq/iMessage or Telegram group counts separately.
- A registered person who messages in personal and group chats, or in multiple groups, counts once.
- An unregistered Linq group participant is deduplicated by the existing server-keyed contact blind index without exposing their contact value.
- The scorecard labels the result as active users and clearly states the distinct-sender definition.
- Focused tests, canonical verification, responsive browser proof, and required completion reviews pass.

## Scope

- In scope: hosted growth activity query, encrypted group-message sender decoding, privacy-safe sender canonicalization, growth scorecard copy, design study, focused tests, and the existing PR.
- Out of scope: new persisted analytics tables, schema migrations, unauthenticated group-email sender attribution, public analytics, and other dashboards.

## Constraints

- Decrypt only retained group-container `conversation.message` payloads needed for the trailing thirty-day aggregate.
- Never return, log, or persist decrypted phone numbers, email addresses, Telegram ids, or sender-level rows from the ops metric.
- Use registered member ids as the cross-channel canonical identity when the existing blind indexes resolve uniquely.
- Use the current blind-index key as the fallback identity for unregistered Linq group senders.
- Treat missing, invalid, or ambiguous sender authority as an accuracy failure rather than silently counting the group container.

## Risks and mitigations

1. Risk: decrypting every message makes the dashboard slow.
   Mitigation: keep direct activity as database `groupBy` queries, decrypt only synthetic thread-container messages, and reuse the request-scoped domain-root unwrap cache.
2. Risk: one person is counted twice across direct and group chats.
   Mitigation: resolve group sender evidence to the registered member id before unioning it with direct-member ids.
3. Risk: blind-index rotation splits an unregistered sender.
   Mitigation: rebuild the current blind index from the decrypted, normalized sender value in memory and discard the value after aggregation.
4. Risk: unauthenticated group email is presented as a unique person.
   Mitigation: limit per-sender group attribution to route-authorized Linq/iMessage and Telegram thread containers.

## Tasks

1. Decode retained group-container mailbox messages and derive privacy-safe sender evidence.
2. Canonicalize registered group senders to member ids and unregistered Linq senders to blind keys.
3. Combine sender identities with direct active members for rolling 7-, prior-7-, and 30-day counts.
4. Update dashboard naming, explanatory copy, design study, and focused regression coverage.
5. Run required verification and reviews, push the revised exact head, update the existing PR, and close this plan.

## Decisions

- Use message sender identity rather than the synthetic group container as the unit of activity.
- Preserve the existing rolling-window and week-over-week semantics.
- Do not add a new analytics persistence surface for a metric that can be derived from retained mailbox evidence.

## Verification

- Focused hosted growth suite: 24 tests passed, including registered email
  deduplication and conflicting privacy-key-version rejection.
- Canonical `pnpm test:diff` passed on a fresh Blacksmith Testbox after the
  coverage remediation, including Web tests, typecheck, lint, build, and route
  smoke. An unrelated preference-handoff sweeper failure from the preceding
  local full-suite attempt passed immediately in isolation.
- Canonical `pnpm verify:acceptance` passed on a fresh Blacksmith Testbox.
- Responsive design-catalog proof passed at desktop and mobile widths for all
  scorecard states, including dedicated no-supporting-baselines captures and
  explicit horizontal-overflow checks. Four redacted synthetic screenshots were
  uploaded through the worktree-safe design-proof command and embedded in the
  PR.
- Product-experience review returned no findings. The preliminary specialist
  review found one owner-level coverage gap; the email and rotation-conflict
  regressions above resolve it.
- Read-only production aggregates confirmed retained attributable group traffic
  in both Linq and Telegram over the trailing thirty days without retrieving
  sender identifiers.
- The Claude UI double-check was attempted and stopped at explicit usage-credit
  exhaustion. The final cross-cutting PR review runs against the archived,
  pushed exact head.
Completed: 2026-07-27
