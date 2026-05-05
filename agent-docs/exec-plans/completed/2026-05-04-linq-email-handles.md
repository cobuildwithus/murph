# Hosted Linq Email Handles

## Goal

Support Linq/iMessage first-contact onboarding when the participant handle is an email address instead of a phone number, without treating the provider-observed handle as verified identity until Privy verifies it.

## Scope

- `apps/web/prisma/schema.prisma`
- `apps/web/prisma/migrations/**`
- `apps/web/src/lib/hosted-onboarding/linq-webhook.ts`
- `apps/web/src/lib/hosted-onboarding/webhook-provider-linq.ts`
- `apps/web/src/lib/hosted-onboarding/hosted-member-routing-*`
- `apps/web/src/lib/hosted-onboarding/invite-service.ts`
- `apps/web/src/lib/hosted-onboarding/authentication-service.ts`
- `apps/web/src/components/hosted-onboarding/**`
- `packages/hosted-execution/src/**`
- `packages/assistant-runtime/src/hosted-runtime/**`
- focused hosted onboarding tests under `apps/web/test/**`
- focused hosted-execution and assistant-runtime tests

## Constraints

- Keep phone-number onboarding behavior unchanged.
- Store provider-observed Linq email handles as pending routing contact claims, not verified email authorization.
- Store contact handles through encrypted private columns plus blind indexes; do not log or fixture real contact identifiers.
- Only Privy-verified email may populate hosted verified email authorization.
- Preserve existing webhook verification, idempotency, and no-retry ignored-response behavior.
- Preserve legacy hosted-execution Linq payload parsing for already-queued `phoneLookupKey` wakes while emitting generic contact payloads for new wakes.
- Preserve unrelated active work in the checkout.

## Verification

- `pnpm --dir apps/web prisma:generate`
- `pnpm --dir packages/hosted-execution typecheck`
- `pnpm --dir packages/assistant-runtime typecheck`
- `pnpm --dir apps/web typecheck`
- `pnpm --dir packages/hosted-execution test`
- `pnpm --dir packages/assistant-runtime test`
- `pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts --no-coverage test/hosted-runtime-workspace-entrypoint.test.ts`
- `pnpm --dir apps/web exec vitest run --config vitest.workspace.ts --no-coverage test/hosted-onboarding-linq-dispatch.test.ts test/hosted-onboarding-member-activation.test.ts test/hosted-onboarding-member-store.test.ts test/hosted-onboarding-privy-invite-status.test.ts test/hosted-onboarding-member-identity-service.test.ts test/hosted-onboarding-linq-home-routing.test.ts test/hosted-onboarding-member-channel-sync.test.ts test/hosted-account-data-service.test.ts test/hosted-onboarding-linq-transport.test.ts`
- `pnpm --dir apps/web verify`
- `pnpm test`
- `pnpm typecheck`

## Handoff

- Implemented; Linq-scoped and repo-level verification passed.
- Scoped commit was prepared by staging only the Linq email-handle hunks from overlapping hosted runtime/execution files.
Status: completed
Updated: 2026-05-04
Completed: 2026-05-04
