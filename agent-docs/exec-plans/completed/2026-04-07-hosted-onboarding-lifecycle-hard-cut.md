# Hosted Onboarding Lifecycle Hard Cut

Status: completed
Created: 2026-04-07
Updated: 2026-04-07

## Goal

- Hard-cut hosted onboarding to the simplest long-term lifecycle model.
- Keep the privacy-preserving split tables intact while removing redundant lifecycle enums and duplicated durable truth.

## Success criteria

- `HostedMember` keeps only entitlement/admin state plus relations; onboarding progression no longer lives on the member row.
- `HostedInviteStatus`, `HostedMemberStatus`, and `HostedBillingMode` are removed.
- `HostedBillingStatus` becomes entitlement-only and no longer includes `checkout_open`.
- Invite lifecycle truth is reduced to minimal metadata (`inviteCode`, `channel`, `sentAt`, `expiresAt`, timestamps kept only if still justified after the hard cut).
- One canonical helper derives hosted onboarding UI stage from invite, identity, billing, and suspension facts.
- GET/read invite status paths become pure and stop mutating invite state.
- Hosted onboarding, billing, share, and messaging consumers use the new canonical lifecycle and entitlement helpers.
- Focused hosted-web tests and required verification pass.

## Scope

- `apps/web/prisma/**`
- `apps/web/src/lib/hosted-onboarding/**`
- `apps/web/src/lib/hosted-share/**`
- `apps/web/app/api/hosted-onboarding/**`
- hosted-onboarding/share tests under `apps/web/test/**`
- durable docs touched only where architecture/runtime truth changes

## Constraints

- Greenfield hard cut: do not preserve staged compatibility for removed lifecycle fields.
- Preserve the privacy split across `HostedMemberIdentity`, `HostedMemberRouting`, and `HostedMemberBillingRef`.
- Keep verified email out of Postgres.
- Treat auth, billing, invite, and share boundaries as high-risk.
- Preserve unrelated dirty-tree edits elsewhere in the repo.

## Key decisions

- Remove invite lifecycle status entirely rather than keeping it as a cached projection.
- Remove invite `openedAt`, `authenticatedAt`, and `paidAt` as redundant/non-canonical lifecycle markers.
- Replace member lifecycle enum with suspension-only admin state.
- Keep checkout attempt lifecycle in `HostedBillingCheckout`; do not mirror it into member entitlement.
- Add one explicit derived onboarding stage helper; product/UI reads that helper instead of inferring state ad hoc.

## Verification

- `pnpm typecheck`
- `pnpm test:coverage`
- `pnpm --dir apps/web lint`
- Focused hosted-web Vitest runs during iteration as needed

## Notes

- Update `ARCHITECTURE.md` and hosted-web docs if the lifecycle ownership model changes their current wording.
- Completed local hard-cut implementation for schema, lifecycle derivation, checkout truth ownership, and access gates.
- Verified:
  - `pnpm --dir apps/web prisma:generate`
  - `pnpm --dir apps/web typecheck:prepared`
  - `./apps/web/node_modules/.bin/eslint src/lib/hosted-onboarding src/lib/hosted-share src/components/hosted-onboarding test/hosted-onboarding-entitlement.test.ts test/join-invite-client.test.ts test/hosted-onboarding-request-auth.test.ts test/hosted-onboarding-member-service.test.ts test/hosted-onboarding-member-identity-service.test.ts test/hosted-onboarding-privy-invite-status.test.ts` from `apps/web`
  - `./node_modules/.bin/vitest run apps/web/test/hosted-onboarding-entitlement.test.ts apps/web/test/join-invite-client.test.ts apps/web/test/hosted-onboarding-request-auth.test.ts apps/web/test/hosted-onboarding-member-service.test.ts apps/web/test/hosted-onboarding-member-identity-service.test.ts apps/web/test/hosted-onboarding-privy-invite-status.test.ts --config apps/web/vitest.workspace.ts --no-coverage`
- Full hosted-web Vitest run still reports failures in older Stripe/privacy-split and webhook payload-ref suites. Current failing examples include:
  - legacy payment-mode / invite-paid expectations in `apps/web/test/hosted-onboarding-stripe-event-reconciliation.test.ts`
  - billing-ref private-state expectations in `apps/web/test/hosted-onboarding-billing-service.test.ts`
  - staged Cloudflare dispatch-ref expectations in webhook receipt tests
Completed: 2026-04-07
