# Linq Error Message Logging

## Goal

Ensure hosted webhook Linq send failures log the sanitized error message text alongside the existing structured diagnostic fields.

## Scope

- `apps/web/src/lib/hosted-onboarding/webhook-transport.ts`
- `apps/web/test/hosted-onboarding-linq-transport.test.ts`

## Constraints

- Keep the logged message sanitized and safe for logs.
- Do not widen into unrelated hosted onboarding or first-contact changes.
- Preserve overlapping work from the active hosted-onboarding lane.

## Verification Target

- `pnpm --dir ../.. exec vitest run apps/web/test/hosted-onboarding-linq-transport.test.ts --config apps/web/vitest.workspace.ts --no-coverage --project hosted-web-onboarding-integrations`
- `pnpm --dir apps/web lint`
- `pnpm typecheck`

## Outcome

- Hosted webhook Linq delivery failures now log a sanitized `errorMessage` alongside the existing structured Linq diagnostic fields.

## Verification Result

- Passed: `pnpm --dir ../.. exec vitest run apps/web/test/hosted-onboarding-linq-transport.test.ts --config apps/web/vitest.workspace.ts --no-coverage --project hosted-web-onboarding-integrations`
- Passed with warnings only: `pnpm --dir apps/web lint`
- `pnpm typecheck` failed for unrelated active hosted-onboarding transaction-ownership work in `apps/web/src/lib/hosted-onboarding/billing-service.ts`, `apps/web/src/lib/hosted-onboarding/billing-success-service.ts`, and related tests; this logging-only diff does not touch those files
Status: completed
Updated: 2026-04-15
Completed: 2026-04-15
