# Hosted-member privacy final proof note

Last updated: 2026-04-06

## Purpose

This note records the state reached after the hosted-member privacy cutover batches were integrated in the live tree.
It captures both what is now proven safe and what is still explicitly deferred.

## Landed

### Billing refs now route through the additive billing-ref surface

- `apps/web/src/lib/hosted-onboarding/billing-service.ts` now reads and binds Stripe customer ids through `hosted-member-store` billing-ref helpers instead of writing Stripe refs directly in the service layer.
- `apps/web/src/lib/hosted-onboarding/stripe-billing-policy.ts` now resolves Stripe customer/subscription lookups through the additive billing-ref helper surface and writes Stripe freshness snapshots through `writeHostedMemberStripeBillingRef(...)`.
- `apps/web/src/lib/hosted-execution/usage.ts` and `apps/web/src/lib/hosted-execution/stripe-metering.ts` now source Stripe customer ids from `HostedMemberBillingRef` instead of the core `HostedMember` row.

### Routing no longer durably stores Telegram usernames

- `apps/web/app/api/settings/telegram/sync/route.ts` writes Telegram linkage through `upsertHostedMemberTelegramRoutingBinding(...)`.
- `apps/web/src/lib/hosted-onboarding/webhook-provider-{linq,telegram}.ts` resolve routing through the additive routing/identity helpers.
- `apps/web/prisma/schema.prisma` and the cleanup migration drop `telegram_username` from `HostedMemberRouting`.
- The UI still displays the current Telegram username from the live sync payload, not from durable Postgres routing state.

### `HostedSession` is removed

- Direct proof before removal:
  - `rg -n "HostedSession|hostedSession" apps/web/src apps/web/test packages` found no non-test runtime readers or writers under `apps/web/src`.
  - The only in-repo reference outside Prisma was a test-harness stub in `apps/web/test/hosted-onboarding-stripe-event-reconciliation.test.ts`.
- Landed cleanup:
  - `apps/web/prisma/schema.prisma` no longer defines `HostedSession` or the related Prisma relations.
  - `apps/web/prisma/migrations/2026040605_hosted_member_privacy_cleanup/migration.sql` drops `hosted_session`.
  - `apps/web/scripts/local-reset-hosted-onboarding.ts` no longer expects a `sessions` relation count.

## Explicitly deferred

### Full identity-column removal from `HostedMember`

This hard cut is still not safe in the live tree.

- `apps/web/src/lib/hosted-onboarding/member-identity-service.ts` still creates and refreshes members with phone, Privy, and wallet fields on `HostedMember`, then mirrors them into `HostedMemberIdentity`.
- `apps/web/src/lib/hosted-onboarding/billing-service.ts` and related auth flows still consume `member.walletAddress` and `member.normalizedPhoneNumber` on the core member object.
- `apps/web/src/lib/hosted-onboarding/authentication-service.ts` still relies on `(invite.member.identity ?? invite.member).normalizedPhoneNumber` during reconciliation.

Required stance:

- Keep the additive split and helper ownership in place.
- Do not claim the core row is entitlement-only yet.
- Treat the remaining identity-column removal as a follow-up migration after those live readers are cut over.

## Verification

- `pnpm --dir apps/web exec prisma format --config prisma.config.ts`
- `pnpm --dir apps/web exec prisma generate --config prisma.config.ts`
- `pnpm exec tsc -p apps/web/tsconfig.json --pretty false`
- `pnpm --dir apps/web lint`
- `pnpm exec vitest run --config apps/web/vitest.workspace.ts apps/web/test/hosted-onboarding-member-store.test.ts apps/web/test/hosted-onboarding-privacy-foundation-migration.test.ts apps/web/test/hosted-execution-control.test.ts apps/web/test/hosted-member-email-runtime-boundary.test.ts apps/web/test/settings-email-sync-route.test.ts apps/web/test/hosted-onboarding-request-auth.test.ts apps/web/test/hosted-onboarding-privy-service.test.ts apps/web/test/hosted-onboarding-privy-invite-status.test.ts apps/web/test/settings-telegram-sync-route.test.ts apps/web/test/hosted-onboarding-telegram-dispatch.test.ts apps/web/test/hosted-onboarding-webhook-idempotency.test.ts apps/web/test/hosted-onboarding-member-service.test.ts apps/web/test/hosted-execution-usage.test.ts apps/web/test/hosted-execution-stripe-metering.test.ts --no-coverage`
- `pnpm exec vitest run --config apps/web/vitest.workspace.ts apps/web/test/hosted-onboarding-stripe-event-reconciliation.test.ts --no-coverage`
- `pnpm exec vitest run --config apps/web/vitest.workspace.ts apps/web/test/hosted-onboarding-linq-dispatch.test.ts apps/web/test/settings-sync-helpers.test.ts --no-coverage`
- `pnpm exec vitest run --config apps/web/vitest.workspace.ts apps/web/test/hosted-onboarding-billing-service.test.ts apps/web/test/hosted-onboarding-routes.test.ts --no-coverage`

Notes:

- `apps/web` lint still reports the same pre-existing warnings outside this lane; there are no lint errors.
- The hosted-web Vitest workspace emits the existing mixed-exports warning for `apps/web/vitest.workspace.ts`, but the targeted suites above pass.
