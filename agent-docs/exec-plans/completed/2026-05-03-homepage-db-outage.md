# Homepage DB Outage Fallback

## Goal

Keep the public homepage (`/`) rendering when hosted Postgres is unavailable, misconfigured, or missing app-session tables. Success means database/session lookup failures degrade to the signed-out homepage instead of throwing a Next.js error response.

## Constraints

- Preserve fail-closed behavior for protected/authenticated surfaces.
- Do not expose database errors, identifiers, secrets, or raw request state to users or logs.
- Keep changes scoped to hosted-web homepage/session read behavior and focused tests.

## Plan

1. Trace the homepage and `HostedWebSession` read path.
2. Add a narrow fallback for public homepage session reads.
3. Cover missing-table or connection-failure behavior with focused tests.
4. Run required hosted-web verification and completion audits.
5. Close this plan through the repo commit helper.

## Verification

- Passed: `pnpm --dir ../.. exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/page-auth.test.ts apps/web/test/page.test.ts apps/web/test/layout.test.ts` (3 files, 16 tests).
- Passed: `pnpm typecheck`.
- Passed: `git diff --check -- apps/web/src/lib/hosted-onboarding/page-auth.ts apps/web/test/page-auth.test.ts agent-docs/exec-plans/active/2026-05-03-homepage-db-outage.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md`.
- Partial: `pnpm test:diff apps/web/src/lib/hosted-onboarding/page-auth.ts apps/web/test/page-auth.test.ts` reached hosted-web verify; dependency policy, workspace boundary checks, hosted run stale-name guard, raw health log payload guard, legal PDF generation, Prisma generate, dev smoke, lint, and `next build` passed. The Vitest lane failed on unrelated dirty tests in `apps/web/test/hosted-phone-auth.test.ts` and `apps/web/test/device-sync-messaging-return-route.test.ts`.
