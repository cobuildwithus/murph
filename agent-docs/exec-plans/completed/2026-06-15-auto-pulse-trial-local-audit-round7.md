# Auto Pulse Trial Local Audit Round 7

## Goal

Fix the local Codex audit findings for PR 173 before merge.

## Scope

- Keep `customer.subscription.resumed` conservative for expired Pulse Trial state until `invoice.paid` confirms conversion.
- Keep Stripe subscription list/create calls outside hosted member DB transactions.
- Rotate auto-trial subscription-create idempotency after terminal Stripe recovery artifacts.

## Validation

- Focused auto-trial and Stripe billing tests.
- `apps/web` typecheck.
- `apps/web` verify.
- Follow-up local audit/PR checks.

## Status

Active.
Status: completed
Updated: 2026-06-15
Completed: 2026-06-15
