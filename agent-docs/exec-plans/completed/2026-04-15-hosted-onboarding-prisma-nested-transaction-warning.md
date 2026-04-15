# Hosted Onboarding Prisma Nested Transaction Warning

## Goal

Remove the `pg` same-client query queue warning from the Stripe hosted-onboarding path without widening the architecture or refactoring unrelated onboarding flows.

## Why

- Stripe reconciliation runs hosted onboarding inside Prisma interactive transactions.
- Shared hosted-onboarding helpers currently decide whether to open a transaction with a runtime `"$transaction" in prisma` check.
- Prisma transaction clients still expose `$transaction` at runtime, so nested helper calls can silently open nested interactive transactions even when an existing transaction client was passed in.
- That extra nesting is the most direct explanation for the `pg` warning seen during `invoice.paid` reconciliation.

## Scope

- `apps/web/src/lib/hosted-onboarding/shared.ts`
- `apps/web/test/hosted-onboarding-shared.test.ts`
- targeted verification in `apps/web/test/**`

## Constraints

- Keep the fix minimal and local to hosted-onboarding transaction ownership.
- Do not disturb concurrent dirty work in `apps/web/src/lib/hosted-onboarding/member-activation.ts`, `linq-home-routing.ts`, or `hosted-member-routing-store.ts`.
- Preserve existing top-level transaction behavior for callers that pass a Prisma client instead of a transaction client.

## Plan

1. Harden the shared transaction helper so it can distinguish a Prisma interactive transaction client from a top-level Prisma client at runtime.
2. Add focused tests that cover the runtime shape Prisma uses for nested transaction clients.
3. Run targeted hosted-onboarding tests and app typecheck, then finish with the required repo workflow.

## Verification Target

- `pnpm --dir apps/web test apps/web/test/hosted-onboarding-shared.test.ts apps/web/test/hosted-onboarding-stripe-billing-policy.test.ts`
- `pnpm --dir apps/web typecheck`
Status: completed
Updated: 2026-04-15
Completed: 2026-04-15
