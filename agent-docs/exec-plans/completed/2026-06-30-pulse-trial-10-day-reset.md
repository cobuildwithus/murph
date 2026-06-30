Goal (incl. success criteria):
- Make the hosted Pulse Trial default last 10 days for new enrollments.
- Provide a safe operator path to reset eligible existing Pulse Trial members to a fresh 10-day window in Postgres and Stripe together.
- Verify the policy, Stripe metadata, and reset path with focused tests.

Constraints/Assumptions:
- Keep Pulse Trial as a checkout offer on Pulse, not a new plan.
- Preserve old 7-day policy records so in-flight or historical trial state remains interpretable.
- Do not print secrets, decrypted identifiers, local usernames, or home paths in scripts, tests, docs, commits, or handoff.
- Production mutation must be explicit and bounded; dry-run by default.

Key decisions:
- Use a new current trial policy version for the 10-day default.
- Add an operator script instead of a Prisma SQL data migration because Stripe trial_end must be updated with the DB rows.

State:
- Implementation complete; live reset not applied from this environment because `STRIPE_SECRET_KEY` is not configured locally.

Done:
- Read repo routing, architecture, security, reliability, app, and Pulse Trial docs.
- Confirmed existing default is 7 days and auto-trial/card checkout both use the shared constant.
- Switched the current Pulse Trial policy to 10 days.
- Added a dry-run-by-default reset operator script that updates Stripe before Postgres in apply mode.
- Updated tests and docs for the 10-day policy and legacy 7-day policy acceptance.
- Ran focused hosted billing/reset tests and `apps/web` typecheck.

Now:
- Ready for scoped commit.

Next:
- Deploy the web change, then run `pnpm --dir apps/web pulse-trial:reset -- --apply` from a production-capable web environment with DB access, hosted crypto access for member private fields, and the Stripe billing secret.

Open questions (UNCONFIRMED if needed):
- Production reset remains unapplied from this shell because `STRIPE_SECRET_KEY` is not configured locally.

Working set (files/ids/commands):
- `apps/web/src/lib/hosted-onboarding/billing-plans.ts`
- `apps/web/src/lib/hosted-onboarding/billing-service.ts`
- `apps/web/src/lib/hosted-onboarding/auto-trial-enrollment-service.ts`
- `apps/web/scripts/reset-pulse-trials.ts` (new)
- `apps/web/test/*billing*`, reset script test (new or existing)
Status: completed
Updated: 2026-06-30
Completed: 2026-06-30
