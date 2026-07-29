# PR 932 Signup Delivery Restart Remediation

Status: completed

## Goal

Make the group-aware signup-link reply restart-safe when Web stops after the
delivery claim commits but before the Linq provider call begins, without adding
a scheduler, state machine, or second persistence owner.

## Proven gap

`invite_signup` and `invite_signup_fallback` currently claim
`HostedLinqDelivery` as `provider_dispatch_started`. Ordinary webhook delivery
cannot reclaim that state, so a restart in the pre-provider window leaves later
same-day replies at `notice_in_flight` forever. The provider idempotency key and
message seed are already stable for the attempt.

## Decision

Provider correlation, not the pre-call database claim, is the non-reclaimable
boundary. Signup-link delivery will retain a reclaimable `attempted` claim
during the ambiguity window and replay the same immutable payload under the
same provider idempotency key after the existing stale threshold. Provider
idempotency owns ambiguous acceptance. A webhook retry or later same-day
inbound remains the continuation owner.

## Scope

- `apps/web/src/lib/hosted-onboarding/webhook-transport.ts`
- `apps/web/src/lib/hosted-onboarding/linq-delivery-store.ts` only if the shared
  claim policy needs a narrow clarification
- focused Web unit and real-PostgreSQL recovery tests
- `agent-docs/operations/imessage-deliverability.md`
- PR retrospective and verification evidence

## Invariants

- Replays use the original attempt identity, group context, signup payload, and
  provider idempotency key.
- Ambiguous provider acceptance produces at most one provider effect.
- Accepted delivery consumes the exact outreach reply context once.
- Stale receipts and both account-deletion orderings remain safe.
- No new scheduler, queue, state machine, or persistence owner.

## Verification

- Focused transport, delivery-store, group-outreach, receipt, and deletion tests
- Production-faithful PostgreSQL crash/retry lifecycle proof
- Web typecheck and lint
- `pnpm test:diff apps/web`
- `pnpm verify:acceptance`
- Exact-head ReviewGPT continuation and CI

Updated: 2026-07-25
Completed: 2026-07-25
