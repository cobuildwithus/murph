## Goal

Refactor the canonical homepage at `/` so `apps/web/app/page.tsx` becomes a thin composition layer and the live homepage sections live in focused components again.

## Scope

- `apps/web/app/page.tsx`
- `apps/web/src/components/homepage/**`
- focused `apps/web/test/**` coverage for the canonical homepage render path

## Constraints

- Keep `/` as the only live homepage route; do not restore `/lp` or `old-homepage`.
- Preserve the current homepage copy, behavior, and auth wiring unless a component boundary requires a mechanical import change.
- Keep the local-run copy exactly as shipped: `Run Murph Locally` and `Up and running in one command.`
- Avoid touching unrelated hosted onboarding or shared runtime logic outside the homepage surface.

## Verification

- Focused hosted-web tests for `apps/web/app/page.tsx` and homepage auth controls
- Required `apps/web` lint and repo `pnpm typecheck`
- Truthful diff-scoped verification lane per repo policy
Status: completed
Updated: 2026-04-17
Completed: 2026-04-17
