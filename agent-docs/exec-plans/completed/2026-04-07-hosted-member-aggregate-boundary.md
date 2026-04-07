# Hosted Member Aggregate Boundary

Status: completed
Created: 2026-04-07
Updated: 2026-04-07

## Goal

- Finish the hosted member persistence boundary after the lifecycle hard cut.
- Keep the privacy-preserving split tables intact while making the hosted member store the only owner for member-core, identity, routing, and billing-ref reads and writes.

## Success criteria

- Hosted onboarding/share flows stop calling `prisma.hostedMember.*` directly outside the store except where an explicit store-owned transaction seam remains unavoidable.
- The store owns narrow member-core read/write helpers in addition to the existing identity, routing, and billing-ref helpers.
- The resulting API stays small and purpose-built; do not replace ad hoc queries with one giant always-loaded aggregate.
- Focused hosted-web verification passes and any durable docs stay aligned with the new ownership model.

## Scope

- `apps/web/src/lib/hosted-onboarding/**`
- `apps/web/src/lib/hosted-share/**`
- related hosted-web tests under `apps/web/test/**`
- durable docs only if the ownership model wording changes materially

## Constraints

- Preserve the greenfield lifecycle hard cut and do not reintroduce invite/member lifecycle duplication.
- Preserve the privacy split across `HostedMemberIdentity`, `HostedMemberRouting`, and `HostedMemberBillingRef`.
- Prefer narrow store methods over broad aggregate abstractions.
- Treat hosted auth, billing, share, and Stripe boundaries as high-risk.
- Preserve unrelated dirty-tree edits elsewhere in the repo.

## Key decisions

- Centralize persistence ownership, not query shape: the store may expose small purpose-built helpers instead of forcing every caller through one aggregate fetch.
- Member-core create/read/update belongs with the existing store because it is part of the same hosted member boundary as identity, routing, and billing-ref state.
- Invite and checkout ownership remain separate unless a concrete persistence leak requires a store seam there too.

## Verification

- `pnpm --dir apps/web typecheck:prepared`
- `pnpm --dir apps/web lint`
- focused hosted-web tests for the touched onboarding/share flows

## Notes

- Start by mapping every remaining direct `HostedMember` Prisma access in hosted onboarding/share and replace only the ones that still leak persistence ownership outside the store.
- Implemented narrow store-owned member-core helpers and cut the remaining runtime callers over without introducing a broader aggregate abstraction.
- Direct proof: `rg -n "\\.hostedMember\\.(findUnique|findFirst|findMany|create|update|updateMany|upsert|delete|deleteMany)" apps/web/src/lib apps/web/app` now returns only store-local call sites in `hosted-member-store.ts`.
- Verified:
  - `pnpm --dir apps/web typecheck:prepared`
  - `./node_modules/.bin/eslint src/lib/hosted-onboarding/hosted-member-store.ts src/lib/hosted-onboarding/member-identity-service.ts src/lib/hosted-onboarding/billing-service.ts src/lib/hosted-onboarding/stripe-billing-policy.ts src/lib/hosted-share/link-service.ts test/hosted-onboarding-member-identity-service.test.ts` from `apps/web`
  - `./node_modules/.bin/vitest run apps/web/test/hosted-onboarding-member-service.test.ts apps/web/test/hosted-onboarding-member-identity-service.test.ts apps/web/test/hosted-onboarding-billing-service.test.ts apps/web/test/hosted-share-service.test.ts apps/web/test/hosted-onboarding-privy-service.test.ts --config apps/web/vitest.workspace.ts --no-coverage`
  - `pnpm --dir apps/web lint` (warnings only; no errors)
  - `pnpm typecheck`
- Broader known-red checks on the current branch:
  - `pnpm test:coverage` still fails before apps/web in `packages/cli/scripts/verify-package-shape.ts` with the unrelated `@murphai/gateway-core` package-shape assertion.
  - `pnpm --dir apps/web test` still fails in older Stripe and webhook suites outside this refactor (`hosted-onboarding-stripe-event-reconciliation`, `hosted-onboarding-webhook-idempotency`, `hosted-onboarding-linq-dispatch`, `hosted-onboarding-telegram-dispatch`).
- Audit results:
  - Simplify pass found no cut-back changes beyond deriving `HostedMemberCoreState` from the Prisma select shape, which was applied.
  - Final completion review found no blocking issues.
Completed: 2026-04-07
