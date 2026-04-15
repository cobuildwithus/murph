# Hosted Onboarding Prod Debug Logs

Status: completed
Created: 2026-04-13
Updated: 2026-04-13

## Goal

- Improve production-safe hosted onboarding warning logs so remaining `TypeError`/`RangeError` `400` responses are diagnosable from Vercel logs.

## Success criteria

- Hosted onboarding warning-level route failures log a sanitized error message in production.
- Existing default JSON helper behavior for warning logs remains unchanged outside the opted-in hosted onboarding surface.
- Focused tests cover the new warning-detail behavior and redaction.

## Scope

- `apps/web/src/lib/http.ts`
- `apps/web/src/lib/hosted-onboarding/http.ts`
- `apps/web/test/http.test.ts`
- `apps/web/test/hosted-onboarding-routes.test.ts`

## Constraints

- Keep logs redaction-safe.
- Do not change user-visible API responses.
- Do not touch the unrelated active local-hosted-dev lane.

## Verification

- `pnpm typecheck`
- truthful diff-aware verification for the touched `apps/web` slice
Completed: 2026-04-13
