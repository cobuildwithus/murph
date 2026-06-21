# Remove Signals Page And Webhook Health GETs

## Goal

Remove the hosted `/signals` dashboard page and remove public `GET` health responses from hosted Linq and Telegram webhook routes, while preserving the real webhook `POST` ingress paths.

## Scope

- Delete `apps/web/app/(dashboard)/signals/**`.
- Remove `/signals` tests and stale imports from dashboard page coverage.
- Remove `GET` exports from hosted Linq and Telegram webhook route handlers.
- Update docs/tests that explicitly list or prove those removed surfaces.
- Leave passkey settings code untouched.

## Constraints

- Preserve unrelated checkout work.
- Keep `POST /api/hosted-onboarding/{linq,telegram}/webhook` behavior unchanged.
- Do not remove browser-vault replica source-health generation; only the `/signals` UI route is being removed.

## Verification Plan

- Focused route/page tests for dashboard browser-vault pages and hosted webhook routes.
- `pnpm typecheck`.
- `pnpm test:diff` or a narrower truthful hosted-web lane if the fresh worktree needs bootstrap steps first.
- `git diff --check`.

## Status

- Implementation complete; verification passed.
- Focused web tests passed after generating Health Commons and Prisma artifacts:
  `pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/browser-vault-dashboard-pages.test.tsx apps/web/test/hosted-onboarding-linq-route.test.ts apps/web/test/hosted-onboarding-telegram-route.test.ts`.
- Focused harness tests passed:
  `pnpm --dir packages/hosted-local-harness exec vitest run --config vitest.config.ts --no-coverage test/dev-hosted-local/linq-webhook-tunnel.test.ts test/dev-hosted-local/stack.test.ts`.
- Fresh-worktree bootstrap required `pnpm build:workspace:incremental` before root typecheck.
- `pnpm typecheck` passed.
- `pnpm test:diff` passed; the Next build route table no longer lists `/signals`.
- `git diff --check` passed.
- Security/privacy review passed with no findings; residual risk is local-only Linq tunnel availability/debuggability after removing the GET probe.
- Frontend review passed with no findings; residual risk is direct old bookmarks now reaching normal not-found behavior.
- Deep review passed with no production-breaking findings; it noted the same local-only Linq tunnel availability tradeoff.
- Coverage-write added test-only negative proof for removed `/signals` files, missing webhook `GET` exports, and no local Linq target readiness fetch before registration.
- After coverage-write changes: focused web tests, focused harness tests, `pnpm typecheck`, `pnpm test:diff`, and `git diff --check` passed.
Status: completed
Updated: 2026-06-21
Completed: 2026-06-21
