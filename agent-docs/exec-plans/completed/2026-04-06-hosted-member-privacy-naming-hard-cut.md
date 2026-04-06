## Goal

Rename the hosted-member privacy identifiers so the schema and code describe what is actually stored: blind-index lookup keys and masked hints, not raw contact data.

## Success Criteria

- `HostedMemberIdentity.normalizedPhoneNumber` is renamed to `phoneLookupKey`.
- `HostedMemberRouting.telegramUserId` is renamed to `telegramUserLookupKey`.
- The physical `phone_number` storage name is replaced with `masked_phone_number_hint`.
- Hosted-onboarding runtime code, scripts, and tests use the new names consistently.
- The hosted-web verification lane passes for the renamed surfaces.

## Scope

- `apps/web/prisma/**`
- `apps/web/src/lib/hosted-onboarding/**`
- `apps/web/scripts/local-reset-hosted-onboarding.ts`
- hosted-onboarding-related tests under `apps/web/test/**`
- durable proof docs if they mention the renamed fields

## Constraints

- Greenfield assumption still applies.
- Preserve unrelated worktree edits.
- Keep email out of Postgres.

## Verification

- `pnpm --dir apps/web exec prisma format --config prisma.config.ts`
- `pnpm --dir apps/web exec prisma generate --config prisma.config.ts`
- `pnpm exec tsc -p apps/web/tsconfig.json --pretty false`
- `pnpm --dir apps/web lint`
- focused hosted-onboarding and hosted-member tests covering store, auth, billing, routing, and Stripe reconciliation
Status: completed
Updated: 2026-04-06
Completed: 2026-04-06
