# Hosted Signup Welcome Email

## Goal

Send one transactional email welcome to a newly activated hosted member when they have a verified email address, using Resend from server-side env configuration.

## Scope

- `apps/web/src/lib/hosted-onboarding/signup-welcome-email.ts`
- `apps/web/src/lib/hosted-onboarding/stripe-event-reconciliation.ts`
- `apps/web/test/hosted-signup-welcome-email.test.ts`
- `apps/web/test/hosted-onboarding-stripe-event-reconciliation.test.ts`
- `apps/web/.env.example`
- `apps/web/README.md`
- `ARCHITECTURE.md`
- `agent-docs/SECURITY.md`

## Constraints

- Do not commit personal sender identities or direct personal identifiers; sender address/display name must come from environment variables.
- Keep `RESEND_API_KEY` secret-only and never log it.
- Do not block member activation or hosted mailbox append on a Resend outage.
- Only target the verified member email already authorized in hosted onboarding state.
- Preserve unrelated active work in the checkout.

## Verification

- `pnpm --dir apps/web test -- test/hosted-signup-welcome-email.test.ts test/hosted-onboarding-stripe-event-reconciliation.test.ts` passed.
- `pnpm --dir apps/web exec eslint src/lib/hosted-onboarding/signup-welcome-email.ts src/lib/hosted-onboarding/stripe-event-reconciliation.ts test/hosted-signup-welcome-email.test.ts test/hosted-onboarding-stripe-event-reconciliation.test.ts` passed.
- `pnpm --dir apps/web typecheck` passed.
- `bash scripts/workspace-verify.sh test:diff ...` blocked on unrelated pre-existing raw log guard failures in `apps/web/src/lib/device-sync/wake-service.ts`.
- `pnpm typecheck` blocked on the same unrelated pre-existing raw log guard failures in `apps/web/src/lib/device-sync/wake-service.ts`.
- Required `security-privacy-review` audit found no issues.
- Required `coverage-write` audit added the no-verified-email sender skip test; focused checks passed after the addition.
- Required `task-finish-review` found no issues.
Status: completed
Updated: 2026-05-05
Completed: 2026-05-05
