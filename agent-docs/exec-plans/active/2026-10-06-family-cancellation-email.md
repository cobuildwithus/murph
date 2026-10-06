# Family subscription cancellation follow-ups

Status: active
Created: 2026-10-06
Updated: 2026-10-06

## Outcome and invariant

Send the existing cancellation feedback email to the billing owner when either
an individual or Family subscription ends. Preserve recipient authorization,
canonical billing freshness, post-commit delivery, retries and subscription idempotency.
Do not send cancellation feedback to every family seat or on scheduled cancellation alone.

## Owner and evidence

The Family subscription reconciliation owner explicitly returned no email candidate.
Return its authoritative cancellation owner through the existing reconciliation
result, and validate the canceled Family and owner before the existing sender runs.
Personal billing status remains authoritative only for individual subscriptions.
No schema, provider API, queue, or dependency changes are needed.

## Product UX

Outcome: Family billing owners receive the same feedback and recovery invitation as individual subscribers.
Reaches: Authoritative ended subscriptions with an eligible owner email; no historical backfill.
Proof: Family cancellation and stale events, owner selection, sender/provider request,
individual regression, retries and durable send receipt.

## Tasks

1. Extend Family cancellation result and existing sender admission.
2. Prove end-to-end owner propagation, replay and recipient boundaries with synthetic tests.
3. Run focused tests, Web typecheck, complexity review and applicable final review.
4. Add the member-facing changelog entry and commit the scoped change.

## Deployment and failure

Web-only compatible change. No migration or Worker rollout dependency.
Existing Resend idempotency and Stripe receipt retries remain the delivery owners.
A deploy starts coverage for newly processed cancellations; it does not resend old receipts.

## Verification

Web typecheck passed. Four billing/email suites passed (449 tests before final
expiry and receipt-completion additions). Focused ESLint passed with five existing
unused-symbol warnings in the reconciliation suite. Complexity guard passed with
no increased hotspot debt. Final focused suite plus changelog render and external
review remain pending. Clipboard copy verified separately.

Parent review: existing email copy and recipient preference remain intact. The
Family owner result is emitted only after authoritative terminal billing work;
stale events and abandoned incomplete subscriptions cannot generate feedback.
The additional send-time query is one bounded primary-key group lookup outside
the billing transaction. No per-seat fanout, provider call under lock, or new state.
Product UX: Ready for candidate review; provider-shaped delivery/retry proof only,
with live production delivery not exercised.
