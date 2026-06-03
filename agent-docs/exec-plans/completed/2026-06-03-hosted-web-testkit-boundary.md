# Hosted web testkit boundary

Status: completed
Created: 2026-06-03
Updated: 2026-06-03

## Goal

- Move hosted web E2E seed/orchestration helpers out of `apps/web/src` and into
  app-local test support while preserving hosted-local coverage.

## Success criteria

- Hosted web test harness exports live under `apps/web/test/support/**`, not
  `apps/web/src/**`.
- Hosted member E2E seed scripts import the app-local testkit.
- Tests do not need `resetPrismaClientForTest`; production Prisma exposes a
  reusable client factory and keeps the production singleton narrow.
- Hosted runtime signal helpers used by E2E can receive explicit Prisma and
  Temporal dependencies.
- A boundary guard fails if `apps/web/src/**` exports `*ForTest` /
  `*ForTesting` or imports app testkit modules.

## Scope

- In scope:
- `apps/web/src/lib/prisma.ts`, hosted runtime signal-client seams, app-local
  test support modules, hosted member seed scripts, and test aliases.
- Out of scope:
- Hosted runtime protocol changes, database schema changes, Cloudflare runner
  behavior changes, and broad dependency injection refactors.

## Constraints

- Preserve hosted-local E2E behavior and existing mailbox/workspace seed
  semantics.
- Keep production app source focused on product/runtime behavior.
- Preserve unrelated dirty Cloudflare/runtime changes in the current worktree.
- No new workspace package unless the app-local test support boundary is not
  enough.

## Risks and mitigations

1. Risk: E2E scripts depend on app-source dynamic import paths.
   Mitigation: Keep one `#hosted-web-testing` alias and update scripts to the
   app-local testkit path.
2. Risk: Removing singleton resets breaks tests that swap ephemeral database
   URLs.
   Mitigation: Add `createPrismaClient({ databaseUrl, poolMax })` and use it in
   test support instead of resetting production singleton state.

## Tasks

1. Move hosted web testkit exports into `apps/web/test/support`.
2. Add the production Prisma factory seam and remove the test reset export.
3. Add explicit Prisma/Temporal dependencies to the signal helpers used by the
   testkit.
4. Update scripts, aliases, and focused tests.
5. Add and run the boundary guard.
6. Run scoped verification, required audits, and commit via `scripts/finish-task`
   if unrelated dirty work does not block a safe scoped commit.

## Verification

- Passed:
  - `pnpm --dir apps/web test:prepared apps/web/test/source-boundary.test.ts apps/web/test/hosted-orchestration-signal-runtime.test.ts apps/web/test/prisma-store-client.test.ts apps/web/test/hosted-orchestration-temporal-client.test.ts apps/web/test/hosted-orchestration-temporal-client-cache.test.ts`
  - `pnpm --dir apps/cloudflare test:node apps/cloudflare/test/hosted-web-testing-helper.test.ts`
  - `pnpm --dir apps/web lint` (existing unrelated warning in `apps/web/test/device-sync-hosted-runtime-authority.test.ts`)
  - `pnpm --dir apps/web typecheck`
  - `pnpm --dir apps/cloudflare typecheck`
  - `pnpm docs:drift`
  - `bash scripts/workspace-verify.sh test:diff .github/workflows/cloudflare-hosted-e2e.yml agent-docs/index.md agent-docs/references/testing-ci-map.md apps/web/README.md tsconfig.base.json apps/cloudflare/test/hosted-web-testing-helper.test.ts apps/cloudflare/vitest.shared.ts apps/web/scripts/seed-hosted-active-linq-member.ts apps/web/scripts/seed-hosted-active-member.ts apps/web/src/lib/hosted-onboarding/hosted-member-test-seed.ts apps/web/test/support/hosted-member-seeds.ts apps/web/src/testing.ts apps/web/test/support/hosted-web-testkit.ts apps/web/src/lib/hosted-orchestration/signal-runtime.ts apps/web/src/lib/hosted-orchestration/temporal-client.ts apps/web/src/lib/prisma.ts apps/web/test/prisma-store-client.test.ts apps/web/test/hosted-orchestration-temporal-client.test.ts apps/web/test/hosted-orchestration-temporal-client-cache.test.ts apps/web/test/hosted-orchestration-signal-runtime.test.ts apps/web/test/source-boundary.test.ts`
- Audits:
  - Security/privacy review: no findings.
  - Coverage-write: added source-boundary alias proof and signal-runtime explicit
    dependency proof.
  - Simplify/final review findings for eager Temporal creation and static
    app-Prisma import were fixed; follow-up final review returned no findings.
Completed: 2026-06-03
