# Add Vercel Analytics and Speed Insights to hosted web layout

Status: completed
Created: 2026-04-08
Updated: 2026-04-08

## Goal

- Add Vercel Analytics and Speed Insights to the hosted web app so the root layout emits both providers across the site.

## Success criteria

- `apps/web/package.json` declares `@vercel/analytics` and `@vercel/speed-insights`.
- `apps/web/app/layout.tsx` renders both providers without disturbing the existing page shell.
- Required hosted-web verification completes, or any unrelated failure is documented with evidence.

## Scope

- In scope:
  - hosted web dependency manifest and lockfile updates for the two Vercel packages
  - root layout wiring for analytics and speed insights
- Out of scope:
  - unrelated hosted-web layout, footer, metadata, or styling changes
  - Vercel project configuration beyond package installation and root-layout rendering

## Constraints

- Technical constraints:
  - keep the integration additive and aligned with the existing server-component layout
  - import the Vercel components directly unless an existing local wrapper is already required
- Product/process constraints:
  - preserve unrelated in-progress `apps/web` work
  - follow the required `apps/web` verification and completion workflow

## Risks and mitigations

1. Risk: dependency additions can expand the lockfile or overlap with other hosted-web work.
   Mitigation: keep the manifest change minimal, regenerate only the necessary lockfile entries, and review the final diff for isolation.

## Tasks

1. Update the coordination artifacts and keep the scope narrow.
2. Add the Vercel packages to `apps/web/package.json` and refresh `pnpm-lock.yaml`.
3. Render `Analytics` and `SpeedInsights` from `apps/web/app/layout.tsx`.
4. Run the required verification, complete audit, and commit the scoped diff.

## Decisions

- Render both providers at the end of `<body>` from the root layout so they cover the full hosted app without route-level changes.
- Use the packages' Next-specific exports: `@vercel/analytics/next` and `@vercel/speed-insights/next`.

## Verification

- Commands to run:
  - `pnpm typecheck`
  - `pnpm test:coverage`
  - `pnpm --dir apps/web lint`
- Expected outcomes:
  - required hosted-web verification passes for the scoped change
- Outcomes:
  - `pnpm typecheck` failed in pre-existing unrelated hosted-onboarding files: `apps/web/src/lib/hosted-onboarding/webhook-receipt-engine.ts:89` and `apps/web/test/hosted-onboarding-shared.test.ts:44`
  - `pnpm test:coverage` failed in pre-existing unrelated CLI tests: `packages/cli/test/assistant-service.test.ts`
  - `pnpm --dir apps/web lint` passed with warnings only and no new errors
Completed: 2026-04-08
