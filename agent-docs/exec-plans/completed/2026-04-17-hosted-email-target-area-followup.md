## Goal

Land the supplied hosted-email follow-up patch so hosted reply aliases normalize route config, remove redundant stored sender identity, hard-cut the route-record schema to v2, and preserve inbound owner-only resolution.

## Scope

- `apps/cloudflare/src/hosted-email/**`
- focused `apps/cloudflare/test/hosted-email-*.test.ts`

## Constraints

- Preserve owner-only hosted email routing policy and current public-sender rules.
- Do not broaden the change into unrelated hosted runner or onboarding paths.
- Treat the supplied patch as intended behavior, but reconcile it against the current tree instead of force-overwriting drift.

## Verification

- `pnpm typecheck`
- truthful `pnpm test:diff apps/cloudflare/src/hosted-email apps/cloudflare/test/hosted-email-config.test.ts apps/cloudflare/test/hosted-email-routes.test.ts` if available
- direct scenario proof for hosted email config normalization, alias formatting/parsing, route-record shape, and inbound resolution
Status: completed
Updated: 2026-04-17
Completed: 2026-04-17
