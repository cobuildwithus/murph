# Hosted Checkout Success Reconciliation

## Goal

Use Stripe Checkout's returned `session_id` to reconcile hosted billing immediately after redirect so paid users do not wait passively for webhook-driven state to appear.

## Scope

- Add one verified hosted billing success route for post-checkout reconciliation.
- Reuse the existing hosted Stripe billing and activation helpers instead of creating a second state machine.
- Wire the hosted success page to call that route once when `session_id` is present.
- Update focused tests for the new route, success client behavior, and billing reconciliation.

## Constraints

- Preserve webhook reconciliation as the backstop and idempotent source of truth.
- Keep the implementation limited to hosted onboarding billing/success surfaces and tests.
- Preserve unrelated dirty worktree edits in active Cloudflare and hosted-settings lanes.

## Verification

- Run truthful `apps/web` scoped verification for touched files.
- Add focused tests for successful redirect reconciliation and member/session ownership checks.

## Notes

- The success page currently receives `session_id` in the URL but ignores it, so the UX waits for webhook timing even when Stripe already has enough canonical billing state to reconcile safely.
Status: completed
Updated: 2026-04-13
Completed: 2026-04-13
