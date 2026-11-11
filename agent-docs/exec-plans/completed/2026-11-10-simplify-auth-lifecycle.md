# Remove obsolete invite phone-code lifecycle

Status: completed
Created: 2026-11-10
Updated: 2026-11-10

## Goal

Remove the unused invite send-code reservation/confirmation lifecycle after
first-party authentication retirement, preserving current OTP and invite admission.

## Success criteria

- Current phone/email login, resend, verification and invite binding keep their owners.
- Three obsolete routes, their state transitions and three stored attempt fields are removed.
- Focused regression tests, Web typecheck and complexity review pass.
- Contract cleanup follows the deployed Web function drain; no production mutation runs locally.

## Scope

- In scope: invite phone-code routes, service/storage helpers, schema contraction,
  fixture cleanup, authentication owner documentation and focused validation.
- Out of scope: referral missions, instant first turn, tapbacks, frontend activation
  states, billing UI and new authentication machinery.

## Architecture and evidence

Current first-party authentication sends through `/api/auth/otp/send` and verifies
through `/api/auth/otp/verify`. Repository-wide source search finds only the old
three routes calling the retired lifecycle. The authentication migration owner
records first-party-only Web retirement. The old route exposes a saved phone
number to the invite bearer although current UI asks for contact entry.

Keep canonical phone/signup-phone identity fields. Drop only the old code-send
attempt identity, attempt time and sent time. Better Auth verification and rate
limits remain authoritative. New Web ignores the old nullable columns; the
existing postdeploy contract migration owner drops them after old functions drain.

## Risks and mitigations

- Old SDK clients are outside the current supported authentication protocol and
  must refresh/update. No native first-party protocol calls these browser routes.
- Old deployed Web functions still select these Prisma columns. Contraction runs
  only after the existing production-alias/drain gate; this Web is the rollback floor.
- Billing missing-phase compatibility, Stripe retry ownership and the constant
  legacy deletion response need separate proof before any behavior change.

## Tasks

1. Remove retired routes, lifecycle, state and redundant proof fixtures.
2. Add postdeploy contraction and update the current owner.
3. Run focused auth/identity/invite tests, Web typecheck, complexity and diff review.
4. Commit and open a draft PR; parent owns readiness, ReviewGPT, CI and merge.

## Verification

- `pnpm --dir apps/web test:prepared -- test/better-auth-request-boundaries.test.ts test/better-auth-login-client.test.tsx test/better-auth-contact-code-client.test.tsx test/hosted-onboarding-member-store.test.ts test/hosted-onboarding-member-service.test.ts test/hosted-onboarding-routes.test.ts test/hosted-onboarding-privacy-foundation-migration.test.ts test/linked-account-removal.test.ts test/hosted-onboarding-member-channel-sync.test.ts test/hosted-onboarding-member-activation.test.ts test/hosted-crypto-domain-root-store.test.ts`: 11 files, 319 tests passed.
- Isolated local database prepared with all normal Prisma migrations.
- `MURPH_TEST_POSTGRES_CONCURRENCY=1` with the local test database and
  `pnpm --dir apps/web test:prepared -- test/better-auth-member-postgres-concurrency.test.ts test/better-auth-telegram-postgres-concurrency.test.ts test/better-auth-sms-postgres-concurrency.test.ts test/invite-phone-code-retirement-postgres.test.ts`:
  4 files, 142 tests passed before contract cleanup. The contraction proof preserves
  canonical identity and succeeds on replay.
- Applied only this contract SQL to that isolated local database, then repeated
  the three auth composition suites: 3 files, 141 tests passed after cleanup.
- `pnpm --dir apps/web typecheck:prepared`: passed after the final code/test edits.
- `pnpm complexity:diff`: passed, 14 changed source files, no hotspots above 20.
- `pnpm docs:drift` and `git diff --check`: passed.
- Source diff reviewed for canonical identity preservation, stale imports, privacy,
  migration ordering and accidental adjacent behavior. No external provider or
  production mutation was performed. Parent owns final ReviewGPT, CI and merge.

## Finding dispositions

- Old invite OTP machine: deleted with staged schema contraction and current-auth proof.
- Missing paid phase: preserve until exact accepted-payment normalization and
  old-writer drain can be demonstrated; a missing phase alone cannot prove payment.
- Stripe retry policy: retained. Database reconciliation marks the event completed
  before the workflow retries its required activation wake; cron excludes completed
  events. Removing that workflow retry would lose recovery. The pre-notification
  signal is best effort and only applies to some events. No new state was added
  merely to remove the existing mechanism.
- Constant Privy deletion result: retained for the documented old open-client
  response contract; no client-drain evidence justifies a response-shape break.
- Referral missions: retained by explicit user direction.
Completed: 2026-11-10
