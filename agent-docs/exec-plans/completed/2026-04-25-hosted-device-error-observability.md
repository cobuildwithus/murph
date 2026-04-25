# Add privacy-safe operational error classification for hosted device-sync routes

Status: completed
Created: 2026-04-25
Updated: 2026-04-25

## Goal

- Add reusable, privacy-safe route error logging for matched domain errors so backend setup/configuration failures are classified in logs without exposing secrets or raw env values.
- Capture the WHOOP-specific env diagnosis from presence-only checks.

## Success criteria

- Shared JSON route helpers can log matched/domain errors with response status/code and caller-provided safe classification details.
- Hosted device-sync settings/internal routes opt into classified domain-error logs.
- Hosted connect-link backend setup failures include a safe failure phase in logs while keeping user responses generic.
- Tests prove the logging shape and redaction behavior.

## Scope

- In scope:
- `apps/web/src/lib/http.ts`
- `apps/web/src/lib/device-sync/settings-http.ts`
- `apps/web/app/api/internal/device-sync/providers/[provider]/connect-link/route.ts`
- Direct tests under `apps/web/test/**`
- Presence-only env checks for Vercel web, GitHub deploy env, and Cloudflare Worker secret names.
- Out of scope:
- Printing or changing secret values.
- Changing production env configuration from code.
- Public hosted run-log persistence changes already owned by active hosted observability lanes.

## Constraints

- Technical constraints:
- Preserve existing JSON response shapes unless a route already opted into the previous error contract.
- Do not log raw env values, local paths, user identifiers, authorization headers, or provider credentials.
- Product/process constraints:
- Keep the observability mechanism reusable rather than WHOOP-only.
- Preserve unrelated dirty-tree work and active ledger rows.

## Risks and mitigations

1. Risk:
   Domain error logging could leak public error `details`.
   Mitigation:
   Do not automatically log response details; require safe explicit log details from the matcher.
2. Risk:
   Logging all expected domain validation errors could create noise.
   Mitigation:
   Add opt-in matched-error logging and enable it only for hosted device-sync settings/internal routes in this slice.
3. Risk:
   WHOOP env diagnosis could expose secrets.
   Mitigation:
   Report only presence/target booleans and mismatch classes.

## Tasks

1. Add matched-domain-error log support to shared JSON helpers.
2. Add hosted device-sync domain-error classification details.
3. Annotate hosted connect-link setup failures with a safe phase.
4. Add focused tests for shared logging and connect-link classifications.
5. Done: run focused tests, app/repo typecheck, scoped verification, diff hygiene, and scoped privacy scan.

## Decisions

- Use `errorObservabilityClass` / `errorPhase` fields on safe wrapper causes for route-specific backend setup classification.
- Presence-only env diagnosis found production Vercel web missing `WHOOP_CLIENT_ID` while `WHOOP_CLIENT_SECRET` is present; the GitHub production deploy environment has both WHOOP secrets for Cloudflare.

## Verification

- Commands to run:
- `pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/test/http.test.ts apps/web/test/device-sync-internal-connect-route.test.ts --no-coverage --maxWorkers 1`
- `pnpm --dir apps/web typecheck`
- `pnpm typecheck`
- `bash scripts/workspace-verify.sh test:diff apps/web/src/lib/http.ts apps/web/src/lib/device-sync/settings-http.ts apps/web/app/api/internal/device-sync/providers/[provider]/connect-link/route.ts apps/web/test/http.test.ts apps/web/test/device-sync-internal-connect-route.test.ts`
- `git diff --check -- <touched files>`
- Expected outcomes:
- Passed. Scoped app verify completed with existing lint/build warnings only and no errors.
- Env diagnosis was presence-only: production Vercel web has `WHOOP_CLIENT_SECRET` but lacks `WHOOP_CLIENT_ID`; the GitHub production deploy env has both Cloudflare WHOOP secrets, making web/runner credential drift the likely cause of the failed WHOOP connect link.
Completed: 2026-04-25
