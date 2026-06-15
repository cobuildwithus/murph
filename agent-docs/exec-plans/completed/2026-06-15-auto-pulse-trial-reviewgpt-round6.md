# Auto Pulse Trial ReviewGPT Round 6

## Goal

Fix the remaining ReviewGPT findings for PR 173 by making auto Pulse Trial enrollment durable against duplicate live Stripe subscriptions and ambiguous recovery state.

## Scope

- Serialize auto-trial subscription resolution behind the hosted member row lock.
- Reserve/bind the Stripe customer id before subscription creation.
- Use a stable subscription idempotency key for the member/customer/price/policy tuple.
- Fail supportably when recovery finds multiple live matching trial subscriptions.

## Validation

- Focused auto-trial enrollment service tests.
- `apps/web` typecheck.
- `apps/web` verify.
- Follow-up ReviewGPT pass on PR 173.

## Status

Active.
Status: completed
Updated: 2026-06-15
Completed: 2026-06-15
