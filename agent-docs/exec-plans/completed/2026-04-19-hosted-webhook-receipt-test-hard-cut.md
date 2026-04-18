## Goal

Align the `apps/web` hosted webhook receipt/Linq/route tests to the final greenfield hard-cut architecture after receipt deletion and event-gate replacement.

## Scope

- `apps/web/test/**` covering hosted webhook receipts, Linq control-plane, webhook transport, hosted execution routes, and hosted webhook idempotency
- Delete receipt-only tests entirely when their source ownership has been removed

## Constraints

- Do not edit `apps/web` source or schema files owned by another worker unless a tiny test-only import/fixture seam is unavoidable.
- Preserve unrelated in-flight `apps/web` edits.
- Keep assertions high-signal: direct Linq send path, ignored marker/event-gate behavior, route removal if applicable.

## Verification

- Focused `apps/web` Vitest coverage for the touched webhook/Linq/route tests
- `apps/web` typecheck or broader verify only if the focused lane is blocked or insufficient

## Outcome

- Deleted the obsolete receipt-only hosted webhook tests.
- Reworked `linq-control-plane` and hosted webhook idempotency coverage onto the ingress event-gate seam.
- Left partially updated `hosted-onboarding-linq-transport` and `hosted-execution-routes` tests alone after confirming they pass in the focused lane.

## Verification Results

- `pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/test/linq-control-plane.test.ts apps/web/test/hosted-onboarding-linq-transport.test.ts apps/web/test/hosted-execution-routes.test.ts apps/web/test/hosted-onboarding-webhook-idempotency.test.ts`
- `pnpm --dir apps/web typecheck:prepared`
Status: completed
Updated: 2026-04-19
Completed: 2026-04-19
