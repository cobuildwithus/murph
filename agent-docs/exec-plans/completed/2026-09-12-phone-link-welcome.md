# Welcome members when they connect a phone

Status: completed
Created: 2026-09-12
Updated: 2026-09-12

## Goal and owner

Keep the email welcome and send the existing welcome to a subsequently verified phone. Reuse Web authentication completion, line assignment, encrypted mailbox notifications, runtime first-contact suppression, and outbox/provider idempotency. No new database state, scheduler, activation, or message copy.

## Evidence and decisions

The current activation selects one available destination. Later identity reconciliation does not append a welcome, and the original delivery key spans channels. Add a distinct phone welcome identity while retaining the original key for existing queued work. Existing assigned text routes do not need another welcome. Web owns recipient authorization and line health; runtime owns delivery and first-contact suppression.

## Product UX

- Outcome: connecting a verified phone after signup opens the Murph text conversation, even after an email welcome.
- Entry and promise: authenticated mobile/web completion or Settings phone synchronization; the normal welcome is queued on the verified phone.
- Journeys: email then phone; repeated synchronization; existing text member; inactive/suspended member; line capacity unavailable; wake failure and mailbox recovery; first reply superseding a pending welcome.
- Done when: one text welcome can be delivered independently of the email, retry/reconnect does not duplicate it, and existing recipient/line authority stays enforced.
- No production backfill or manual messages are included.

## Tasks and proof

1. Extend existing welcome identity recognition and phone-link composition.
2. Prove admission, deduplication, runtime delivery, and wrong-member rejection with synthetic tests; run affected typechecks.
3. Review the complete diff and complexity, update durable documentation and changelog, and create a scoped commit.
4. Complete applicable final review and CI if a PR is opened.

## Deployment

The runtime readers must accept the new phone welcome identity before Web starts producing it. Existing notification shapes and original welcome keys remain valid, as covered by parameterized reader tests. Producer-first rollout is unsupported: old runtime readers do not classify the new identity as a required, retryable signup welcome. No schema migration is needed. This task prepares a local commit; deployment and production backfill are outside scope.

## Verification

Product UX: Ready. The production notification journey queues one email and one text with independent delivery identities; replay is silent. This exact-text path makes no model calls. Provider delivery is covered through synthetic callback/egress tests; no live member message was sent.

Passed verification:

- Hosted-execution build and Web Prisma generation.
- Web, assistant-runtime, and assistant-engine typechecks.
- Focused Web phone-welcome, shared authentication, Settings sync, Privy completion, companion access, Linq egress, and home-route tests.
- Runtime welcome retry tests and callback tests covering dispatch claims, provider authority, and suppression after a foreground reply, for both original and phone welcome keys.
- `pnpm test:assistant:live -- --test 'queues email and later phone welcomes independently through the production notification turn'`.
- Changelog generation and fragment/page tests.
- `pnpm complexity:diff`, `pnpm docs:drift`, and `git diff --check`; no new complexity debt.

Review: the phone-link helper composes existing owners, assigns the line and appends the welcome atomically under the member lock, and signals runtime after commit. It rechecks verified identity, access, suspension, and existing routing under the lock. Encryption roots are prepared outside the transaction, and the existing cache-only guard prevents provider calls under locks. No new storage, job, activation, or follow-up machinery. The complete source/test/documentation diff was reviewed. PR review and exact-head CI remain applicable only if a PR is opened.
Completed: 2026-09-12
