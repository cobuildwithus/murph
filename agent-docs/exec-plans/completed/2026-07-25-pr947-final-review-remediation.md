# PR #947 final-review remediation

## Goal

Resolve the final ReviewGPT findings without widening the PR's narrow Linq
ingress optimization:

- a failed pre-transaction unwrap must not trigger a second KMS request after
  the database transaction starts;
- `transactionMs` must measure only the Prisma transaction boundary.

## Invariants

- Successful established-route ingress still unwraps once before `BEGIN`.
- A failed warm attempt is reused only within the existing request-scoped
  warm/transaction composition. Ordinary failed unwraps remain evicted.
- A branch that never needs the root may still complete after a failed warm
  attempt.
- Plaintext key copies remain wiped by their existing owners.
- Direct-message and general KMS-in-transaction coverage remain out of scope.

## Work

1. Add narrow request-scoped failed-prewarm reuse at the hosted domain-root
   cache boundary.
2. Split warm duration from connection-held transaction duration.
3. Add production-faithful regression coverage for successful warm reuse,
   failed warm reuse, and no-encryption early return behavior.
4. Run focused verification, the canonical diff/acceptance lanes, correction
   ReviewGPT, and exact-head CI before merge.

## Status

Implementation and required verification complete.

Verification:

- `pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage
  apps/web/test/hosted-onboarding-linq-mailbox-root-prewarm.test.ts
  apps/web/test/hosted-crypto-domain-root-store.test.ts` — 24 tests passed.
- `pnpm --dir apps/web typecheck:prepared` — passed after regenerating the
  worktree's Prisma client.
- `pnpm test:diff apps/web/src/lib/hosted-crypto/domain-root-store.ts
  apps/web/src/lib/hosted-onboarding/webhook-service.ts
  apps/web/test/hosted-crypto-domain-root-store.test.ts
  apps/web/test/hosted-onboarding-linq-mailbox-root-prewarm.test.ts` — passed;
  the hosted-web owner lane completed 6,557 tests with 172 skipped, lint, dev
  smoke, and the production build.
- `pnpm verify:acceptance` — passed, including repository guards, workspace
  typechecks, package coverage, hosted-web verification and production build,
  and both Cloudflare test lanes.
Status: completed
Updated: 2026-07-26
Completed: 2026-07-26
