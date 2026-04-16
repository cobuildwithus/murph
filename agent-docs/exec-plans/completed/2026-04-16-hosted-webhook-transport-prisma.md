## Goal

Make hosted webhook dispatch enqueue use explicit Prisma transaction ownership instead of runtime shape detection.

## Why

- The current webhook transport path guesses "root Prisma client vs transaction client" by checking for `$transaction`.
- That is not a canonical Prisma boundary and risks nested or overlapping transaction behavior on the same underlying Postgres client.
- Production logs show a `pg` deprecation warning about concurrent `client.query()` calls during hosted onboarding webhook handling.

## Scope

- `apps/web/src/lib/hosted-onboarding/webhook-transport.ts`
- `apps/web/src/lib/hosted-onboarding/webhook-receipt-types.ts`
- Targeted `apps/web/test/**` coverage for webhook dispatch enqueue behavior only.

## Guardrails

- Keep the behavior change narrow and avoid unrelated hosted onboarding logic.
- Do not change webhook product behavior or outbox payload semantics.
- Preserve overlapping active onboarding work already in flight.

## Verification target

- Truthful scoped `apps/web` verification for touched files.
- Focused test coverage proving explicit root-client and transaction-client paths.
Status: completed
Updated: 2026-04-16
Completed: 2026-04-16
