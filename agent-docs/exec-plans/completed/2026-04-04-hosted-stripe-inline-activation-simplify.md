# Hosted Stripe Inline Activation Simplify

## Goal

Reduce internal complexity in the hosted Stripe activation flow by separating the webhook's single-event inline reconcile path from the generic Stripe recovery queue drain, without changing product behavior or the recovery contract.

## Why

- The current webhook happy path reuses the generic queue-drain API, which forced queue-oriented "detailed result" plumbing into code that only needs one event outcome.
- Recovery cron and inline webhook processing have different responsibilities and should not share more surface area than necessary.
- The simplest long-term shape is: durable fact row, dedicated inline reconcile for that fact, then generic recovery drain for backlog/failures.

## Constraints

- Keep `execution_outbox` as the only durable Cloudflare async boundary.
- Preserve Stripe fact recording and retry semantics for cron recovery.
- Keep subscription activation on `invoice.paid`, and keep RevNet gating unchanged.
- Preserve the immediate best-effort outbox drain plus deterministic welcome-send behavior.

## Intended Changes

1. Add a dedicated helper for reconciling one recorded Stripe event by `eventId`.
2. Use that helper from the webhook path instead of the generic queue drain.
3. Keep the generic queue drain focused on recovery/batch cron work.
4. Remove queue-detail result plumbing that only existed to serve the webhook happy path.

## Verification Target

- Focused hosted onboarding tests for webhook orchestration and queue recovery.
- `pnpm --dir apps/web typecheck:prepared`
- `pnpm --dir apps/web lint`
- Repo-wide `pnpm typecheck`, `pnpm test`, `pnpm test:coverage` unless unrelated pre-existing failures remain.
Status: completed
Updated: 2026-04-04
Completed: 2026-04-04
