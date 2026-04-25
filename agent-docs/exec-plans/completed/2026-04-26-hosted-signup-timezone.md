Goal (incl. success criteria):
- Persist a new hosted signup user's validated IANA timezone into the canonical hosted vault on first `member.activated` bootstrap.
- Keep hosted Postgres as transient activation state only by clearing the pending timezone when the activation wake is materialized.
- Preserve hosted execution ownership boundaries: `apps/web` owns signup/control facts, `apps/cloudflare`/assistant-runtime only consumes the signed activation wake.

Constraints/Assumptions:
- Timezone is sensitive-enough location-adjacent data and must not become a long-lived hosted user profile column.
- Activation may occur from Stripe/webhook flow without a live browser request, so the value must survive until activation unless a cleaner in-repo durable handoff exists.
- Use validated IANA timezone strings only; fall back to platform geo timezone or UTC when no valid browser value exists.
- Preserve unrelated dirty work in the shared checkout.

Key decisions:
- Add a nullable pending activation timezone on the hosted member row and clear it in the same transaction that appends `member.activated`.
- Add optional `timeZone` to `member.activated` hosted execution wake/event contracts.
- Pass `timeZone` into hosted vault initialization only when the hosted vault is first created.

State:
- Implemented; verification completed with one unrelated repo-wide blocker.

Done:
- Read repo routing, architecture, security, reliability, verification, Next, Prisma, and Cloudflare guidance.
- Confirmed current hosted runtime initializes the vault without an explicit timezone and falls back to runtime/system defaults.
- Added browser timezone capture on hosted Privy completion, validated IANA normalization, and Vercel timezone-header fallback.
- Added transient `HostedMember.pendingActivationTimeZone` state guarded to activation-pending billing states only.
- Added activation-only member read shape, `member.activated.timeZone` hosted execution contract parsing/building, and vault bootstrap timezone initialization with explicit `UTC` fallback.
- Cleared the transient hosted DB timezone in the activation transaction before materializing the activation wake, including idempotent already-active activation retries.
- Narrowed generic hosted member auth/page/share/routing shapes so the pending timezone is not selected outside the activation path.
- Added focused route, service, activation, parser, client payload, and hosted runtime tests.
- Ran required privacy/security, coverage, and task-finish review passes; addressed their findings.
- Verification passed:
  - `pnpm --filter @murphai/hosted-web exec vitest run --config vitest.workspace.ts --no-coverage test/hosted-onboarding-privy-complete-route.test.ts test/hosted-onboarding-privy-service.test.ts test/hosted-onboarding-member-activation.test.ts test/hosted-phone-auth.test.ts test/hosted-onboarding-member-store.test.ts test/hosted-onboarding-billing-seam.test.ts test/hosted-onboarding-request-auth.test.ts test/hosted-onboarding-stripe-billing-lookup.test.ts test/hosted-onboarding-billing-success-service.test.ts test/hosted-onboarding-stripe-checkout-completed.test.ts test/hosted-onboarding-member-identity-service.test.ts test/hosted-onboarding-privy-invite-status.test.ts test/page-auth.test.ts test/hosted-share-service.test.ts`
  - `pnpm --filter @murphai/hosted-execution exec vitest run --config vitest.config.ts --no-coverage test/hosted-wake-parsers.test.ts test/hosted-execution-parsers-coverage.test.ts`
  - `pnpm --filter @murphai/assistant-runtime exec vitest run --config vitest.config.ts --no-coverage test/hosted-runtime-context.test.ts`
  - `pnpm --filter @murphai/hosted-web run typecheck`
  - `pnpm --filter @murphai/hosted-execution run typecheck`
  - `pnpm --filter @murphai/assistant-runtime run typecheck`
  - `git diff --check`

Now:
- Prepare final handoff and avoid unsafe scoped commit in the shared dirty checkout.

Next:
- Commit/close this lane when the shared dirty ledger and overlapping active hosted files are safe to stage.

Open questions (UNCONFIRMED if needed):
- `pnpm verify:acceptance` is blocked by unrelated assistant-engine transcript-audit type errors in an active lane.

Working set (files/ids/commands):
- `apps/web/app/api/hosted-onboarding/privy/complete/route.ts`
- `apps/web/src/components/hosted-onboarding/hosted-privy-auth-support.ts`
- `apps/web/src/lib/hosted-onboarding/member-activation.ts`
- `apps/web/src/lib/hosted-onboarding/member-identity-service.ts`
- `apps/web/src/lib/hosted-onboarding/hosted-member-store.ts`
- `apps/web/src/lib/hosted-onboarding/time-zone-hint.ts`
- `apps/web/prisma/schema.prisma`
- `packages/hosted-execution/src/{contracts,builders,parsers}.ts`
- `packages/assistant-runtime/src/hosted-runtime/context.ts`
- `apps/web/prisma/migrations/20260426000000_hosted_member_pending_activation_timezone/migration.sql`
- Focused tests listed in Done.
Status: completed
Updated: 2026-04-26
Completed: 2026-04-26
