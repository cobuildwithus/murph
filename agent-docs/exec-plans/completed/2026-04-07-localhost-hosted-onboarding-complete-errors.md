# Localhost Hosted Onboarding Completion Errors

Status: completed
Created: 2026-04-07
Updated: 2026-04-07

## Goal

- Fix the localhost hosted onboarding completion failure so internal hosted config problems no longer surface as generic `INVALID_REQUEST` 400 responses.
- Preserve the existing hosted onboarding request contract, including the optional empty `{}` completion body.

## Success criteria

- `POST /api/hosted-onboarding/privy/complete` continues accepting an empty JSON object or no body.
- Missing hosted server-side config needed during member persistence surfaces as a server/config error instead of a client-request error.
- Focused hosted-web tests cover the completion route regression and the config-failure classification path.
- The fix stays scoped to hosted onboarding and does not widen into unrelated hosted runtime behavior.

## Scope

- `apps/web/src/lib/http.ts`
- `apps/web/src/lib/hosted-web/encryption.ts`
- `apps/web/src/lib/hosted-onboarding/**`
- focused hosted onboarding tests under `apps/web/test/**`

## Constraints

- Treat the Privy/onboarding boundary as high-risk.
- Preserve unrelated dirty worktree edits, especially the active Cloudflare test lane and other hosted refactors already in flight.
- Do not change the browser request shape unless the regression proves the client is also at fault.

## Key decisions

- Start by fixing localhost server-side error classification before widening into any browser-side request changes.
- Keep the route body optional; the observed `{}` payload is a valid input and not the primary localhost fault.

## Verification

- Focused hosted-web Vitest runs for the touched onboarding route/client tests during iteration.
- Repo-required verification and review flow after the implementation stabilizes.

## Notes

- Current hypothesis: localhost reaches the completion route, then raw hosted private-field encryption config failures throw `TypeError`, which the shared JSON error helper currently serializes as `INVALID_REQUEST`.
- Implemented:
  - `apps/web/src/lib/hosted-web/encryption.ts` now throws `HostedWebConfigurationError` for missing hosted-web private-field encryption keys and wraps malformed hosted-web encryption config into `HOSTED_WEB_ENCRYPTION_CONFIG_INVALID`.
  - `apps/web/src/lib/hosted-onboarding/http.ts` maps hosted-web config errors through the hosted onboarding JSON error helpers.
  - `apps/web/test/hosted-onboarding-routes.test.ts` now covers the Privy completion route returning the hosted-web config error payload.
  - `apps/web/test/crypto.test.ts` now exercises the hosted-web encryption helper directly in non-test mode for both missing-key and malformed-keyring config paths.
- Verification:
  - `pnpm --dir ../.. exec vitest run --config apps/web/vitest.workspace.ts apps/web/test/hosted-onboarding-routes.test.ts --no-coverage`
  - `pnpm --dir ../.. exec vitest run --config apps/web/vitest.workspace.ts apps/web/test/crypto.test.ts --no-coverage`
  - `pnpm typecheck`
  - `pnpm --dir apps/web lint` (warnings only, no errors)
  - `pnpm test:coverage`
- Direct scenario proof:
  - `pnpm --dir apps/web exec tsx -e "(async () => { ... encryptHostedWebNullableString(...) ... })();"` with non-test env and `HOSTED_WEB_ENCRYPTION_KEY` unset now emits `HostedWebConfigurationError` with code `HOSTED_WEB_ENCRYPTION_KEY_REQUIRED`.
Completed: 2026-04-07
