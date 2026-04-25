# Map WHOOP hosted connect-link backend configuration failures away from malformed request responses

Status: completed
Created: 2026-04-25
Updated: 2026-04-25

## Goal

- Prevent hosted wearable connection-link backend/configuration failures from surfacing to the assistant as generic `HTTP 400 INVALID_REQUEST`, starting with the WHOOP connect-link path.

## Success criteria

- Internal hosted device connect-link route keeps unauthorized callback requests as 401.
- Backend configuration/setup failures in callback verification or the device-sync control plane return a retryable unavailable response instead of `INVALID_REQUEST`.
- Focused route tests cover the regression path without leaking env names, secrets, or user identifiers.

## Scope

- In scope:
- `apps/web/app/api/internal/device-sync/providers/[provider]/connect-link/route.ts`
- `apps/web/test/device-sync-internal-connect-route.test.ts`
- Out of scope:
- Changing WHOOP OAuth provider parameters or production environment values.
- Cloudflare runner observability/log-forwarding changes already owned by other active rows.

## Constraints

- Technical constraints:
- Preserve existing typed `hostedOnboardingError` and `deviceSyncError` behavior.
- Do not remap malformed route parameters as backend unavailability.
- Product/process constraints:
- Keep error responses user-safe and free of raw env/config details.
- Preserve unrelated dirty-tree work.

## Risks and mitigations

1. Risk:
   Over-broad error mapping could hide malformed client requests.
   Mitigation:
   Limit the remap to internal callback verification and control-plane setup/start failures, not route param decoding.
2. Risk:
   Error response could expose deployment configuration details.
   Mitigation:
   Use a generic retryable unavailable message and assert the response shape in tests.

## Tasks

1. Done: add a route-local mapper for backend setup failures.
2. Done: cover malformed route params, callback verification config failure, and control-plane config failure in focused tests.
3. Done: run focused tests, app typecheck, repo typecheck, diff-aware app verify, and diff hygiene checks.

## Decisions

- Treat TypeError/RangeError from backend setup seams as service-unavailable for this internal route. Route parameter URI errors continue through the shared `INVALID_REQUEST` handler.

## Verification

- Commands to run:
- `pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/test/device-sync-internal-connect-route.test.ts --no-coverage --maxWorkers 1`
- `pnpm --dir apps/web typecheck`
- `pnpm typecheck`
- `bash scripts/workspace-verify.sh test:diff apps/web/app/api/internal/device-sync/providers/[provider]/connect-link/route.ts apps/web/test/device-sync-internal-connect-route.test.ts`
- `git diff --check -- apps/web/app/api/internal/device-sync/providers/[provider]/connect-link/route.ts apps/web/test/device-sync-internal-connect-route.test.ts agent-docs/exec-plans/active/2026-04-25-whoop-connect-link-invalid-request.md`
- Scoped diff privacy scan for local paths, auth headers, secrets, and provider credential names.
- Expected outcomes:
- Passed. Diff-aware app verify completed with existing lint/build warnings only and no errors.
Completed: 2026-04-25
