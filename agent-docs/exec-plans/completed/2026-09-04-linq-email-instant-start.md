# Linq email-handle instant start

Status: completed
Created: 2026-09-04
Updated: 2026-09-04

## Outcome

Let a genuinely unknown person who sends a provider-authenticated direct
iMessage from an email handle enter the existing instant-start experience:
one starter grant, one canonical member, and one answer to the original message
without receiving the signup link first.

## Product UX

- Effort: Product change. This expands who receives an existing onboarding
  behavior and changes the first-contact response for email-handle senders.
- The admitted new email-handle sender receives immediate typing feedback and
  a useful first answer through the same direct chat.
- Phone-handle instant start remains unchanged, including its prefix policy.
- Blocked, fail-open, group, SMS/RCS, conflicting-account, replay, and
  enrollment-failure paths remain closed or retain their existing recovery.
- A later Privy verification of the same email attaches to the existing member;
  the provider-observed handle is not called a verified account email before
  that verification succeeds.

## Architecture

- Keep `HostedMember` and its existing identity row as the sole member owner.
- Add the smallest durable unique email-handle identity claim needed to survive
  pending-route promotion and prevent a different chat from minting another
  member or starter grant for the same handle.
- Reuse the existing provider-attested contact lock, event-scoped model allow,
  pending Linq route, instant-start invite token, starter-usage enrollment,
  activation, mailbox, and home-route promotion owners.
- Do not add a service, queue, alternate entitlement, implicit verified-email
  fact, or email-to-phone inference.
- Verified Privy email reconciliation may consume the matching Linq email claim
  only when all identity authorities converge on one member. Conflicts fail
  closed for explicit support instead of silently merging accounts.

## Implementation

1. Extend instant-start and speculative first-turn eligibility to direct
   iMessage email handles while retaining the phone-prefix check for phones.
2. Make new-member resolution return an explicit creation winner for email
   handles and let only that winner attach the exact admission event to the
   instant-start invite.
3. Persist and resolve the durable unique Linq email-handle identity across
   activation, new chats, key rotation, and later verified-email login.
4. Add a deploy-safe migration and update durable architecture, security,
   reliability, messaging, and testing contracts.
5. Preserve the existing fallback for older finalized signup-link events;
   production remediation of a historical member is a separate authorized
   operation.

## Verification

- Deterministic unit coverage: email eligibility, direct/plain-text first turn,
  phone behavior unchanged, and groups/SMS/RCS remain ineligible.
- Planner and service coverage: model allow produces enrollment, starter grant,
  activation, original-input append, one reply, and no signup-link delivery.
- PostgreSQL concurrency coverage: duplicate email events and concurrent new
  chats converge on one member, one instant-start token, and one starter grant.
- Identity coverage: another chat resolves the active email-handle member;
  matching verified Privy email attaches to it; cross-owner conflicts fail
  closed; no verified email is written from the Linq webhook alone.
- Migration checks, Prisma generation, focused Web typecheck/tests, complexity,
  whitespace, and privacy review pass.
- Add and run one focused production-derived real-Codex journey with synthetic
  data, then inspect the actual member-visible reply and owned effects.
- Push the candidate, open a PR, run required exact-head CI concurrently with
  the final ReviewGPT gate, resolve every finding, and prove current-base
  mergeability.

## Coordination

- ReviewGPT authors the initial patch and returns it as an attachment.
- The parent owns patch inspection, integration, Product UX replay, required
  verification, final review, PR evidence, and finding disposition.
- Avoid the production prompt and real-Codex test edits currently owned by the
  separate first-onboarding-reply PR until that lane is merged or an explicit
  handoff is available; keep this patch focused on Web onboarding and
  deterministic proof first.

## Result

- Direct iMessage email handles now share the admitted instant-start path while
  phone prefix policy and unsupported channels remain unchanged.
- A unique blinded identity claim, shared email-contact lock, migration
  conflict gates, and Privy reconciliation keep Linq routing identity separate
  from verified email authorization and converge concurrent owners safely.
- The migration applied through the complete local migration chain. Five
  opt-in PostgreSQL cases proved backfill rejection boundaries and one-member
  concurrency; 430 focused Web tests, full Web typecheck, lint, the migration
  guard, changelog rendering, and the complexity ratchet passed.
- The required shared real-Codex journey file remains exclusively owned by the
  separate open first-onboarding-reply PR. This task did not duplicate or edit
  that active lane; its final PR evidence records the live-journey Hold and the
  deterministic proof used here.
- ReviewGPT supplied the identity and migration design. Its generated patch
  attachment was empty in two captures, so the parent implemented the reviewed
  design locally and retained final exact-head ReviewGPT as the independent
  candidate gate.
Completed: 2026-09-04
