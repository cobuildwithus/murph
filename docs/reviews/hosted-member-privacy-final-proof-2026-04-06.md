# Hosted-member privacy final proof note

Last updated: 2026-04-06

## Purpose

This note records the final greenfield state reached after the hosted-member privacy cutover batches and hard cut landed in the live tree.

## Landed

### Billing refs now route through the additive billing-ref surface

- `apps/web/src/lib/hosted-onboarding/billing-service.ts` now reads and binds Stripe customer ids through `hosted-member-store` billing-ref helpers instead of writing Stripe refs directly in the service layer.
- `apps/web/src/lib/hosted-onboarding/stripe-billing-policy.ts` now resolves Stripe customer/subscription lookups through the additive billing-ref helper surface and writes Stripe freshness snapshots through `writeHostedMemberStripeBillingRef(...)`.
- `apps/web/src/lib/hosted-onboarding/stripe-billing-policy.ts` now reads one canonical hosted-member aggregate for activation, billing freshness, and first-contact dispatch, and `skipIfBillingAlreadyActive` now only suppresses activation when the reloaded member is already active.
- `apps/web/src/lib/hosted-execution/usage.ts` and `apps/web/src/lib/hosted-execution/stripe-metering.ts` now source Stripe customer ids from `HostedMemberBillingRef` instead of the core `HostedMember` row.

### `HostedMember` is now entitlement-only

- `apps/web/prisma/schema.prisma` keeps only `id`, `status`, `billingStatus`, `billingMode`, timestamps, and the split-table relations on `HostedMember`.
- `apps/web/prisma/migrations/2026040606_hosted_member_privacy_hard_cut/migration.sql` drops the legacy phone, Privy, wallet, Stripe, Linq, and Telegram columns from `hosted_member`.
- `apps/web/src/lib/hosted-onboarding/member-identity-service.ts` now creates and refreshes core members separately from `HostedMemberIdentity`, instead of mirroring identity state through the core row.
- `apps/web/src/lib/hosted-onboarding/{authentication-service,invite-service,billing-service}.ts` now consume identity or billing-ref state through the split ownership lanes instead of treating `HostedMember` as a person-shaped record.

### Routing no longer durably stores Telegram usernames

- `apps/web/app/api/settings/telegram/sync/route.ts` writes Telegram linkage through `upsertHostedMemberTelegramRoutingBinding(...)`.
- `apps/web/src/lib/hosted-onboarding/webhook-provider-{linq,telegram}.ts` resolve routing through the additive routing/identity helpers.
- `apps/web/prisma/schema.prisma` and the cleanup migration drop `telegram_username` from `HostedMemberRouting`.
- The UI still displays the current Telegram username from the live sync payload, not from durable Postgres routing state.

### Verified email still stays out of Postgres

- The hard cut keeps verified email outside the hosted web account model; `HostedMember`, `HostedMemberIdentity`, `HostedMemberRouting`, and `HostedMemberBillingRef` do not own email identity fields.
- The verified-email path remains `Privy verified email -> hosted execution user env -> Cloudflare verified-sender and route state`.
- `apps/web/test/hosted-member-email-runtime-boundary.test.ts` and `apps/web/test/settings-email-sync-route.test.ts` still prove that the email sync path does not introduce a durable Prisma identity field.

### `HostedSession` is removed

- Direct proof before removal:
  - `rg -n "HostedSession|hostedSession" apps/web/src apps/web/test packages` found no non-test runtime readers or writers under `apps/web/src`.
  - The only in-repo reference outside Prisma was a test-harness stub in `apps/web/test/hosted-onboarding-stripe-event-reconciliation.test.ts`.
- Landed cleanup:
  - `apps/web/prisma/schema.prisma` no longer defines `HostedSession` or the related Prisma relations.
- `apps/web/prisma/migrations/2026040605_hosted_member_privacy_cleanup/migration.sql` drops `hosted_session`.
- `apps/web/scripts/local-reset-hosted-onboarding.ts` no longer expects a `sessions` relation count.

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
