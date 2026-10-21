# Lock the member before the root in Telegram ingress and Family acceptance

Status: completed
Created: 2026-10-08
Updated: 2026-10-08

## Goal

- Telegram direct ingress and Telegram Family invite acceptance take a member's
  row lock before that member's domain-root authority lock, like activation,
  Starter enrollment, sign-in, device-sync, and (since #4106) Linq direct
  admission.

## Evidence

- A lock-order audit of every domain-root caller found two Telegram owners that
  took the control root first:
  - Direct ingress revalidated its prepared control root and then tried the
    member row with `FOR UPDATE SKIP LOCKED`. Under contention it returned a
    retryable 503 instead of waiting, which is the shape #4106 removed from Linq.
    Telegram volume is low (77 webhooks and no 503s in 30 days), so this was
    latent.
  - Family invite acceptance provisioned the member's control root and then
    blocked on the member row inside `acceptHostedFamilyInviteTx`. That could
    deadlock with any member-first owner of the same member.
- The domain-root store itself never locks member rows.

## Success criteria

- Direct ingress waits for activation's member lock, then appends one message on
  the same delivery without a retry. The real-PostgreSQL proof fails on the
  previous order.
- Family acceptance provisions the control root only after the accepted member
  row is locked, on the normal, replay, and error-binding paths.

## Scope

- In scope: the two lock orders, their focused tests, and the test-map row.
- Out of scope: Linq first-contact paths that reach a root before a member lock
  only through a narrow identity race, and root-only paths that insert
  member-referencing rows.

## Constraints

- Keep owner-then-member order inside `acceptHostedFamilyInviteTx`.
- No new helper, timeout, retry, or state.

## Risks and mitigations

1. Risk: a Family acceptance for a brand-new member now provisions the control
   root while holding the new member row. Mitigation: the row is uncommitted
   and invisible to other transactions, so nothing can wait on it.

## Tasks

1. Lock the member before revalidating the prepared control root in direct
   ingress and delete the `SKIP LOCKED` helper.
2. Move Family control-root provisioning into the binding write, which every
   path reaches after the member lock.
3. Update the real-PostgreSQL activation proof, the Telegram dispatch tests,
   and the Family ordering assertion.

## Decisions

- Move the root after the member instead of moving the member lock earlier. An
  earlier member lock would invert `acceptHostedFamilyInviteTx`'s
  owner-then-member order.

## Verification

- Telegram activation, routing, and better-auth Telegram PostgreSQL proofs,
  each run alone with `MURPH_TEST_POSTGRES_CONCURRENCY=1`; Telegram dispatch and
  Family plan unit files; Web typecheck; focused lint; `pnpm complexity:diff`;
  `pnpm docs:drift`.

## Progress

- Telegram activation proof: 2 of 2 pass. On the previous order, ingress
  rejects immediately instead of waiting.
- Telegram routing (5) and better-auth Telegram (23) proofs pass, run one file
  at a time; they share synthetic Telegram ids, so running them together in one
  database collides on identity.
- Telegram dispatch and Family plan suites: 322 pass. The two deleted dispatch
  tests asserted the removed skip-and-retry behavior. The Family ordering
  assertion fails on the previous order.
- Web typecheck, focused lint, and `pnpm complexity:diff` pass (Telegram planner
  debt 77 → 76).
Completed: 2026-10-08
