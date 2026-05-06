# Usage Limit Upgrade Banner

## Goal

When hosted AI usage is exhausted, Murph should give the user a direct upgrade path:

- Text-message quota notices include `https://withmurph.ai/home`.
- The authenticated `/home` page shows a simple, on-brand usage-limit banner with an upgrade path.

## Scope

- `apps/web/src/lib/hosted-execution/usage-allowance.ts`
- `apps/web/app/(dashboard)/home/page.tsx`
- `apps/web/src/components/home/**`
- Focused tests for quota notices and the home page.

## Constraints

- Keep usage/account facts web-owned.
- Do not expose identifiers, message contents, or secrets in logs, tests, docs, or handoff.
- Preserve unrelated dirty work in the checkout.
- The next Cloudflare deploy must also restore the production hosted assistant model configuration.

## Verification

- Focused hosted-web tests for usage allowance and `/home`.
- Hosted-web typecheck or scoped equivalent.
- Deploy through `pnpm cf:deploy:immediate` after the scoped change is committed to `main`.

## Result

- Usage gate notices now include `https://withmurph.ai/home`.
- `/home` shows a usage-limit upgrade banner only when the hosted usage gate denies the active member for exhausted AI usage.
- Verification passed:
  - `pnpm exec vitest run --config apps/web/vitest.workspace.ts apps/web/test/hosted-execution-usage-allowance.test.ts apps/web/test/hosted-execution-usage-gate-route.test.ts apps/web/test/dashboard-home-page.test.tsx apps/web/test/hosted-onboarding-linq-dispatch.test.ts --no-coverage`
  - `pnpm exec vitest run --config apps/cloudflare/vitest.config.ts apps/cloudflare/test/user-runner-alarm.test.ts --no-coverage`
  - `pnpm --dir apps/web typecheck`
  - `pnpm --dir apps/web lint`
  - `pnpm --dir apps/cloudflare typecheck`
Status: completed
Updated: 2026-05-06
Completed: 2026-05-06
